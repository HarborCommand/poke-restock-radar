import { prisma } from "@/lib/db";
import { taxFeatureConfig } from "@/lib/tax";
import { storefrontStripeReadiness } from "@/lib/storefront";
import { getStripeTaxRegistrationStatus } from "@/lib/stripe-tax";
import type { SessionUser } from "@/types/radar";
import type { z } from "zod";
import type { taxAdminSettingsSchema } from "@/lib/validation";

type TaxAdminInput = z.infer<typeof taxAdminSettingsSchema>;
type StripeMode = "test" | "live" | "missing" | "unknown" | "mixed";

function envEnabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function keyMode(value: string | undefined, prefix: "pk" | "sk") {
  if (!value) return "missing" as const;
  if (value.startsWith(`${prefix}_test_`)) return "test" as const;
  if (value.startsWith(`${prefix}_live_`)) return "live" as const;
  return "unknown" as const;
}

function stripeMode(): StripeMode {
  const publishableMode = keyMode(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, "pk");
  const secretMode = keyMode(process.env.STRIPE_SECRET_KEY, "sk");
  if (publishableMode === secretMode) return publishableMode;
  if (publishableMode === "missing" && secretMode === "missing") return "missing";
  return "mixed";
}

function isoDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function sameValue(current: unknown, next: unknown) {
  if (current instanceof Date && next instanceof Date) return current.getTime() === next.getTime();
  return current === next;
}

function serverReadiness() {
  const mode = stripeMode();
  const stripe = storefrontStripeReadiness();
  return {
    stripeMode: mode,
    stripeProviderConfigured: stripe.configured && (mode === "test" || mode === "live"),
    privateDocumentStorageConfigured: Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  };
}

function assertProfileEnablementReady(input: TaxAdminInput, providerRegistrationStatus: "active" | "inactive" | "unknown") {
  const readiness = serverReadiness();
  const commonReady =
    input.registrationConfirmed &&
    input.storeAddressConfirmed &&
    input.countyConfirmed &&
    input.defaultCodeConfirmed &&
    input.ownerApproved;
  if (!commonReady) {
    throw new Error("Registration, store address, county, product code, and owner approval must be confirmed before enabling a tax profile.");
  }
  const features = taxFeatureConfig();
  if (((input.onlineTaxProfileEnabled && features.onlineStripeTaxEnabled) || (input.posTaxEnabled && features.posSalesTaxEnabled)) && providerRegistrationStatus !== "active") {
    throw new Error("An active Florida registration reported by Stripe Tax is required before enabling collection.");
  }
  if (input.onlineTaxProfileEnabled && (
    !readiness.stripeProviderConfigured ||
    !input.previewOnlinePassed ||
    !input.previewPickupPassed ||
    !input.receiptVerified ||
    !input.refundVerified ||
    !input.reportReconciled ||
    input.localPickupTaxTreatment === "pending_review"
  )) {
    throw new Error("Online tax readiness is incomplete. Provider, Preview, Local Pickup, receipt, refund, and report checks are required.");
  }
  if (input.posTaxEnabled && (!input.previewPosPassed || !input.receiptVerified || !input.refundVerified || !input.reportReconciled)) {
    throw new Error("POS tax readiness is incomplete. Preview, receipt, refund, and report checks are required.");
  }
  if (input.taxExemptSalesEnabled && !readiness.privateDocumentStorageConfigured) {
    throw new Error("Private exemption document storage must be configured before enabling the exempt-sale profile.");
  }
  if (input.taxReportingProfileEnabled && !input.reportReconciled) {
    throw new Error("Tax reporting reconciliation must be confirmed before enabling the reporting profile.");
  }
}

export async function getTaxAdminSettings(userId: string) {
  const settings = await prisma.storefrontSettings.findUnique({ where: { userId } });
  const features = taxFeatureConfig();
  const readiness = serverReadiness();
  const providerRegistration = readiness.stripeProviderConfigured
    ? await getStripeTaxRegistrationStatus(settings?.storeCountry ?? "US", settings?.storeState ?? "FL")
    : { status: "unknown" as const };
  const onlineConfigured = settings?.onlineTaxProfileEnabled ?? false;
  const onlineActive = features.onlineStripeTaxEnabled;
  const posActive = features.posSalesTaxEnabled && Boolean(settings?.posTaxEnabled);
  const exemptionActive = features.taxExemptSalesEnabled && Boolean(settings?.taxExemptSalesEnabled);
  const reportingActive = features.taxReportingEnabled;
  const legacyFallbackConfigured = settings?.legacyManualTaxFallbackEnabled ?? false;
  const legacyFallbackActive = features.manualTaxFallbackEnabled && !features.posSalesTaxEnabled && legacyFallbackConfigured;
  const localPickupTreatment = settings?.localPickupTaxTreatment ?? "pending_review";
  const localPickupStatus = localPickupTreatment === "provider_authoritative"
    ? "Provider-authoritative calculation configured"
    : localPickupTreatment === "taxable_at_store_location"
      ? "Configured to use the approved store-location treatment"
      : "Pending owner and accountant review";
  const warnings = [
    !features.onlineStripeTaxEnabled ? "Online tax collection is disabled by the environment gate." : null,
    features.onlineStripeTaxEnabled && !readiness.stripeProviderConfigured ? "Stripe automatic tax is not ready. Complete Checkout and signed webhook configuration." : null,
    readiness.stripeMode === "live" && process.env.VERCEL_ENV === "preview" ? "Live-mode Stripe credentials are present in Preview. Keep Checkout disabled and replace them with branch-scoped test credentials." : null,
    providerRegistration.status !== "active" ? "Stripe Tax does not report an active Florida registration." : null,
    !settings?.storeAddressLine1 || !settings?.storeCity || !settings?.storePostalCode ? "Complete the physical store and Local Pickup address." : null,
    localPickupTreatment === "pending_review" ? "Local Pickup tax treatment is still pending review." : null
  ].filter((value): value is string => Boolean(value));

  return {
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    collectionDisabled: !onlineActive && !posActive && !exemptionActive,
    online: {
      configurationEnabled: onlineConfigured,
      enabled: onlineActive,
      stripeCheckoutEnabled: envEnabled("STRIPE_CHECKOUT_ENABLED"),
      stripeMode: readiness.stripeMode,
      automaticTaxReady: readiness.stripeProviderConfigured,
      defaultProductTaxCode: settings?.defaultStripeTaxCode ?? "txcd_99999999",
      shippingTaxCode: settings?.shippingStripeTaxCode ?? "txcd_92010001",
      providerRegistrationStatus: providerRegistration.status,
      webhookReady: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()),
      checkoutAddressRequirement: features.onlineStripeTaxEnabled ? "Complete billing and shipping address required" : "Inactive until online tax is enabled",
      localPickupStatus,
      localPickupTreatment,
      warnings
    },
    pos: {
      storeCountry: settings?.storeCountry ?? "US",
      storeState: settings?.storeState ?? "FL",
      storeCounty: settings?.storeCounty ?? "",
      storeAddressLine1: settings?.storeAddressLine1 ?? "",
      storeAddressLine2: settings?.storeAddressLine2 ?? "",
      storeCity: settings?.storeCity ?? "",
      storePostalCode: settings?.storePostalCode ?? "",
      stateRateBasisPoints: settings?.stateTaxRateBasisPoints ?? 600,
      countyRateBasisPoints: settings?.countyTaxRateBasisPoints ?? 0,
      combinedRateBasisPoints: (settings?.stateTaxRateBasisPoints ?? 600) + (settings?.countyTaxRateBasisPoints ?? 0),
      effectiveDate: isoDate(settings?.taxProfileEffectiveAt),
      sourceNote: settings?.taxProfileSourceNote ?? "",
      profileEnabled: settings?.posTaxEnabled ?? false,
      runtimeEnabled: features.posSalesTaxEnabled,
      active: posActive,
      providerReady: readiness.stripeProviderConfigured,
      providerRegistrationStatus: providerRegistration.status,
      inPersonCalculationReady: readiness.stripeProviderConfigured && Boolean(settings?.storeAddressLine1 && settings?.storeCity && settings?.storePostalCode),
      deliveryCalculationReady: readiness.stripeProviderConfigured && Boolean(settings?.shippingStripeTaxCode),
      transactionRecordingReady: readiness.stripeProviderConfigured,
      reversalReady: readiness.stripeProviderConfigured,
      shippingTaxCode: settings?.shippingStripeTaxCode ?? "txcd_92010001",
      legacyFallbackConfigured,
      legacyFallbackRuntimeEnabled: features.manualTaxFallbackEnabled,
      legacyFallbackEnabled: legacyFallbackActive,
      lastUpdated: settings?.updatedAt?.toISOString() ?? null,
      lastUpdatedByAdmin: settings?.taxSettingsUpdatedByUserId ?? null
    },
    exemption: {
      enabled: settings?.taxExemptSalesEnabled ?? false,
      runtimeEnabled: features.taxExemptSalesEnabled,
      active: exemptionActive,
      referenceRequired: settings?.taxExemptionReferenceRequired ?? true,
      reasonRequired: settings?.taxExemptionReasonRequired ?? true,
      adminOnly: true,
      documentStorageAvailable: readiness.privateDocumentStorageConfigured
    },
    reporting: {
      configurationEnabled: settings?.taxReportingProfileEnabled ?? false,
      enabled: reportingActive,
      defaultPeriod: settings?.taxDefaultReportingPeriod ?? "monthly",
      exportAvailable: reportingActive,
      disclaimer: "Filing-support data only. This workspace does not prepare or file a tax return."
    },
    product: {
      defaultTaxCategory: settings?.defaultTaxCategory ?? "general_tangible_goods",
      defaultStripeTaxCode: settings?.defaultStripeTaxCode ?? "txcd_99999999",
      shippingStripeTaxCode: settings?.shippingStripeTaxCode ?? "txcd_92010001"
    },
    readiness: {
      registrationConfirmed: settings?.taxRegistrationConfirmed ?? false,
      stripeConfigured: readiness.stripeProviderConfigured,
      providerRegistrationStatus: providerRegistration.status,
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

export async function saveTaxAdminSettings(user: SessionUser, input: TaxAdminInput, requestId: string) {
  const features = taxFeatureConfig();
  if (input.legacyManualTaxFallbackEnabled && !features.manualTaxFallbackEnabled) {
    throw new Error("The legacy manual tax fallback runtime gate is disabled.");
  }
  if (input.legacyManualTaxFallbackEnabled && features.posSalesTaxEnabled) {
    throw new Error("Legacy manual fallback cannot be active while POS Stripe Tax is enabled.");
  }
  const readiness = serverReadiness();
  const providerRegistration = readiness.stripeProviderConfigured
    ? await getStripeTaxRegistrationStatus(input.storeCountry, input.storeState)
    : { status: "unknown" as const };
  await prisma.$transaction(async (tx) => {
    const existing = await tx.storefrontSettings.findUnique({ where: { userId: user.id } });
    const enablingFields = [
      !existing?.onlineTaxProfileEnabled && input.onlineTaxProfileEnabled ? "onlineTaxProfileEnabled" : null,
      !existing?.posTaxEnabled && input.posTaxEnabled ? "posTaxEnabled" : null,
      !existing?.taxExemptSalesEnabled && input.taxExemptSalesEnabled ? "taxExemptSalesEnabled" : null,
      !existing?.taxReportingProfileEnabled && input.taxReportingProfileEnabled ? "taxReportingProfileEnabled" : null
    ].filter((field): field is string => Boolean(field));
    if (enablingFields.length) {
      if (input.enableTaxCollectionConfirmed !== true) {
        throw new Error("Explicit confirmation is required before enabling a tax profile.");
      }
      if (!input.enablementReason) {
        throw new Error("An approved enablement reason is required.");
      }
      assertProfileEnablementReady(input, providerRegistration.status);
    }

    const ownerApprovedAt = input.ownerApproved ? existing?.taxOwnerApprovedAt ?? new Date() : null;
    const data = {
      storeCountry: input.storeCountry,
      storeState: input.storeState,
      storeCounty: input.storeCounty,
      storeAddressLine1: input.storeAddressLine1,
      storeAddressLine2: input.storeAddressLine2 ?? null,
      storeCity: input.storeCity,
      storePostalCode: input.storePostalCode,
      stateTaxRateBasisPoints: input.stateRateBasisPoints,
      countyTaxRateBasisPoints: input.countyRateBasisPoints,
      taxProfileEffectiveAt: input.effectiveDate ? new Date(`${input.effectiveDate}T00:00:00.000Z`) : null,
      taxProfileSourceNote: input.sourceNote || null,
      onlineTaxProfileEnabled: input.onlineTaxProfileEnabled,
      posTaxEnabled: input.posTaxEnabled,
      taxExemptSalesEnabled: input.taxExemptSalesEnabled,
      taxReportingProfileEnabled: input.taxReportingProfileEnabled,
      localPickupTaxTreatment: input.localPickupTaxTreatment,
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
      defaultStripeTaxCode: input.defaultStripeTaxCode,
      shippingStripeTaxCode: input.shippingStripeTaxCode,
      legacyManualTaxFallbackEnabled: input.legacyManualTaxFallbackEnabled
    };
    const changedFields = Object.entries(data)
      .filter(([key, value]) => !existing || !sameValue(existing[key as keyof typeof existing], value))
      .map(([key]) => key);
    if (existing && changedFields.length === 0) return;

    const settings = await tx.storefrontSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...data, taxSettingsUpdatedByUserId: user.id },
      update: { ...data, taxSettingsUpdatedByUserId: user.id }
    });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        actorEmail: user.email,
        action: "tax.settings.updated",
        entityType: "TAX_SETTINGS",
        entityId: settings.id,
        summary: "Tax settings workspace updated.",
        metadata: JSON.stringify({
          requestId,
          changedFields,
          enablementReason: enablingFields.length ? input.enablementReason : undefined
        })
      }
    });
  });

  return getTaxAdminSettings(user.id);
}
