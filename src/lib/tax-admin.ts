import { prisma } from "@/lib/db";
import { taxFeatureConfig } from "@/lib/tax";
import { storefrontStripeReadiness } from "@/lib/storefront";
import type { SessionUser } from "@/types/radar";
import type { z } from "zod";
import type { taxAdminSettingsSchema } from "@/lib/validation";

type TaxAdminInput = z.infer<typeof taxAdminSettingsSchema>;

function envEnabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function keyMode(value: string | undefined, prefix: "pk" | "sk") {
  if (!value) return "missing" as const;
  if (value.startsWith(`${prefix}_test_`)) return "test" as const;
  if (value.startsWith(`${prefix}_live_`)) return "live" as const;
  return "unknown" as const;
}

function isoDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

export async function getTaxAdminSettings(userId: string) {
  const settings = await prisma.storefrontSettings.findUnique({ where: { userId } });
  const features = taxFeatureConfig();
  const stripe = storefrontStripeReadiness();
  const publishableMode = keyMode(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, "pk");
  const secretMode = keyMode(process.env.STRIPE_SECRET_KEY, "sk");
  const stripeMode = publishableMode === secretMode ? publishableMode : publishableMode === "missing" && secretMode === "missing" ? "missing" : "mixed";
  const onlineReady = features.onlineStripeTaxEnabled && stripe.configured && (stripeMode === "test" || stripeMode === "live");
  const localPickupStatus = !features.onlineStripeTaxEnabled
    ? "Inactive while online tax is disabled"
    : "Blocked until a provider-authoritative pickup-location calculation path is configured";
  const warnings = [
    !features.onlineStripeTaxEnabled ? "Online tax collection is disabled by the environment gate." : null,
    features.onlineStripeTaxEnabled && !stripe.configured ? "Stripe automatic tax is not ready. Complete Checkout and signed webhook configuration." : null,
    stripeMode === "live" && process.env.VERCEL_ENV === "preview" ? "Live-mode Stripe credentials are present in Preview. Keep Checkout disabled and replace them with branch-scoped test credentials." : null,
    !settings?.storeCounty ? "Confirm the physical store county before enabling POS tax." : null,
    !settings?.taxProfileSourceNote ? "Record the authoritative source used for the saved POS rate." : null
  ].filter((value): value is string => Boolean(value));

  return {
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    online: {
      enabled: features.onlineStripeTaxEnabled,
      stripeCheckoutEnabled: envEnabled("STRIPE_CHECKOUT_ENABLED"),
      stripeMode,
      automaticTaxReady: onlineReady,
      defaultProductTaxCode: settings?.defaultStripeTaxCode ?? "txcd_99999999",
      checkoutAddressRequirement: features.onlineStripeTaxEnabled ? "Complete billing and shipping address required" : "Inactive until online tax is enabled",
      localPickupStatus,
      warnings
    },
    pos: {
      storeCountry: settings?.storeCountry ?? "US",
      storeState: settings?.storeState ?? "FL",
      storeCounty: settings?.storeCounty ?? "",
      stateRateBasisPoints: settings?.stateTaxRateBasisPoints ?? 600,
      countyRateBasisPoints: settings?.countyTaxRateBasisPoints ?? 0,
      combinedRateBasisPoints: (settings?.stateTaxRateBasisPoints ?? 600) + (settings?.countyTaxRateBasisPoints ?? 0),
      effectiveDate: isoDate(settings?.taxProfileEffectiveAt),
      sourceNote: settings?.taxProfileSourceNote ?? "",
      profileEnabled: settings?.posTaxEnabled ?? false,
      runtimeEnabled: features.posSalesTaxEnabled,
      lastUpdated: settings?.updatedAt?.toISOString() ?? null
    },
    exemption: {
      enabled: settings?.taxExemptSalesEnabled ?? false,
      runtimeEnabled: features.taxExemptSalesEnabled,
      referenceRequired: settings?.taxExemptionReferenceRequired ?? true,
      reasonRequired: settings?.taxExemptionReasonRequired ?? true,
      adminOnly: true,
      documentStorageAvailable: Boolean(process.env.BLOB_READ_WRITE_TOKEN)
    },
    reporting: {
      enabled: features.taxReportingEnabled,
      defaultPeriod: settings?.taxDefaultReportingPeriod ?? "monthly",
      exportAvailable: features.taxReportingEnabled,
      disclaimer: "Filing-support data only. This workspace does not prepare or file a tax return."
    },
    product: {
      defaultTaxCategory: settings?.defaultTaxCategory ?? "general_tangible_goods",
      defaultStripeTaxCode: settings?.defaultStripeTaxCode ?? "txcd_99999999"
    },
    readiness: {
      registrationConfirmed: settings?.taxRegistrationConfirmed ?? false,
      stripeConfigured: onlineReady,
      storeAddressConfirmed: settings?.taxStoreAddressConfirmed ?? false,
      countyConfirmed: settings?.taxCountyConfirmed ?? false,
      defaultCodeConfirmed: settings?.taxDefaultCodeConfirmed ?? false,
      previewOnlinePassed: settings?.taxPreviewOnlinePassed ?? false,
      previewPickupPassed: settings?.taxPreviewPickupPassed ?? false,
      previewPosPassed: settings?.taxPreviewPosPassed ?? false,
      receiptVerified: settings?.taxReceiptVerified ?? false,
      refundVerified: settings?.taxRefundVerified ?? false,
      reportReconciled: settings?.taxReportReconciled ?? false,
      ownerApproved: Boolean(settings?.taxOwnerApprovedAt),
      ownerApprovedAt: settings?.taxOwnerApprovedAt?.toISOString() ?? null
    }
  };
}

export async function saveTaxAdminSettings(user: SessionUser, input: TaxAdminInput) {
  const existing = await prisma.storefrontSettings.findUnique({
    where: { userId: user.id },
    select: { id: true, posTaxEnabled: true, taxExemptSalesEnabled: true, taxOwnerApprovedAt: true }
  });
  const enablesCollection =
    (!existing?.posTaxEnabled && input.posTaxEnabled) ||
    (!existing?.taxExemptSalesEnabled && input.taxExemptSalesEnabled);
  if (enablesCollection && input.enableTaxCollectionConfirmed !== true) {
    throw new Error("Explicit confirmation is required before enabling a tax collection profile.");
  }

  const ownerApprovedAt = input.ownerApproved ? existing?.taxOwnerApprovedAt ?? new Date() : null;
  const data = {
    storeCountry: input.storeCountry,
    storeState: input.storeState,
    storeCounty: input.storeCounty,
    stateTaxRateBasisPoints: input.stateRateBasisPoints,
    countyTaxRateBasisPoints: input.countyRateBasisPoints,
    taxProfileEffectiveAt: new Date(`${input.effectiveDate}T00:00:00.000Z`),
    taxProfileSourceNote: input.sourceNote,
    posTaxEnabled: input.posTaxEnabled,
    taxExemptSalesEnabled: input.taxExemptSalesEnabled,
    taxExemptionReferenceRequired: input.exemptionReferenceRequired,
    taxExemptionReasonRequired: input.exemptionReasonRequired,
    taxDefaultReportingPeriod: input.defaultReportingPeriod,
    taxRegistrationConfirmed: input.registrationConfirmed,
    taxStoreAddressConfirmed: input.storeAddressConfirmed,
    taxCountyConfirmed: input.countyConfirmed,
    taxDefaultCodeConfirmed: input.defaultCodeConfirmed,
    taxPreviewOnlinePassed: input.previewOnlinePassed,
    taxPreviewPickupPassed: input.previewPickupPassed,
    taxPreviewPosPassed: input.previewPosPassed,
    taxReceiptVerified: input.receiptVerified,
    taxRefundVerified: input.refundVerified,
    taxReportReconciled: input.reportReconciled,
    taxOwnerApprovedAt: ownerApprovedAt,
    defaultTaxCategory: input.defaultTaxCategory,
    defaultStripeTaxCode: input.defaultStripeTaxCode
  };

  await prisma.$transaction(async (tx) => {
    const settings = await tx.storefrontSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data },
      update: data
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        actorEmail: user.email,
        action: "tax.settings.updated",
        entityType: "TAX_SETTINGS",
        entityId: settings.id,
        summary: `${user.email} updated the tax settings workspace.`,
        metadata: JSON.stringify({
          posProfileEnabled: input.posTaxEnabled,
          exemptionEnabled: input.taxExemptSalesEnabled,
          ownerApproved: input.ownerApproved
        })
      }
    });
  });

  return getTaxAdminSettings(user.id);
}
