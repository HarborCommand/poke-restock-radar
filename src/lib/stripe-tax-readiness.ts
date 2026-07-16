import { prisma } from "@/lib/db";
import { taxFeatureConfig } from "@/lib/tax";
import { checkStripeTaxProviderReadiness, type StripeTaxProviderReadiness } from "@/lib/stripe-tax";

type StripeMode = "test" | "live" | "missing";

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function enabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function stripeMode(): StripeMode {
  const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
  if (secret.startsWith("sk_test_") && publishable.startsWith("pk_test_")) return "test";
  if (secret.startsWith("sk_live_") && publishable.startsWith("pk_live_")) return "live";
  return "missing";
}

function validTaxCode(value: string | null | undefined) {
  return /^txcd_\d{8}$/.test(value?.trim() ?? "");
}

function safeLocationReady(settings: {
  storeAddressLine1: string | null;
  storeCity: string | null;
  storeState: string;
  storePostalCode: string | null;
  storeCountry: string;
} | null) {
  return Boolean(
    settings?.storeAddressLine1?.trim() &&
    settings.storeCity?.trim() &&
    /^[A-Z]{2}$/.test(settings.storeState.trim().toUpperCase()) &&
    /^\d{5}(?:-\d{4})?$/.test(settings.storePostalCode?.trim() ?? "") &&
    /^[A-Z]{2}$/.test(settings.storeCountry.trim().toUpperCase())
  );
}

export type StripeTaxReadiness = Awaited<ReturnType<typeof getStripeTaxReadiness>>;

export async function getStripeTaxReadiness(userId: string, providerCheck?: StripeTaxProviderReadiness | null) {
  const [settings, fallbackProductCount, overrideProductCount] = await Promise.all([
    prisma.storefrontSettings.findUnique({ where: { userId } }),
    prisma.inventoryItem.count({ where: { userId, stripeTaxCode: null } }),
    prisma.inventoryItem.count({ where: { userId, stripeTaxCode: { not: null } } })
  ]);
  const mode = stripeMode();
  const features = taxFeatureConfig();
  const secretConfigured = configured("STRIPE_SECRET_KEY");
  const publishableConfigured = configured("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  const webhookConfigured = configured("STRIPE_WEBHOOK_SECRET");
  const defaultProductTaxCode = settings?.defaultStripeTaxCode ?? "txcd_99999999";
  const shippingTaxCode = settings?.shippingStripeTaxCode ?? "txcd_92010001";
  const locationReady = safeLocationReady(settings);
  const providerConfigured = mode !== "missing" && secretConfigured;
  const registrationStatus = providerCheck?.registrationStatus ?? "unknown";
  const signedWebhookReady = webhookConfigured && mode !== "missing";

  const blockers = [
    mode !== "test" ? "Stripe test credentials missing" : null,
    registrationStatus !== "active" ? "Florida registration missing or unverified" : null,
    !locationReady ? "Store and Local Pickup location missing" : null,
    !settings?.taxPreviewPickupPassed ? "Local Pickup test missing" : null,
    !signedWebhookReady || !settings?.taxReceiptVerified ? "Signed webhook test missing" : null,
    !settings?.taxRefundVerified ? "Full and partial refund tests missing" : null,
    !settings?.taxOwnerApprovedAt ? "Owner approval missing" : null,
    "Accountant approval missing"
  ].filter((value): value is string => Boolean(value));

  return {
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    connection: {
      apiMode: mode,
      secretKeyConfigured: secretConfigured,
      publishableKeyConfigured: publishableConfigured,
      webhookConfigured,
      webhookSignatureReady: signedWebhookReady,
      providerReachable: providerCheck?.reachable ?? null,
      lastSafeConnectivityCheck: providerCheck?.checkedAt ?? null,
      requestId: providerCheck?.requestId ?? null
    },
    registration: {
      status: registrationStatus,
      effectiveDate: providerCheck?.registrationEffectiveDate ?? null,
      warning: registrationStatus === "active"
        ? null
        : "Without an active Stripe Tax registration, Stripe may calculate zero tax because collection is not authorized."
    },
    product: {
      defaultProductTaxCode,
      shippingTaxCode,
      defaultCodeReady: validTaxCode(defaultProductTaxCode),
      shippingCodeReady: validTaxCode(shippingTaxCode),
      fallbackProductCount,
      overrideProductCount
    },
    online: {
      automaticTaxConfigured: providerConfigured && enabled("STRIPE_CHECKOUT_ENABLED"),
      runtimeEnabled: features.onlineStripeTaxEnabled,
      checkoutLocationCollectionReady: providerConfigured,
      shippingTaxReady: validTaxCode(shippingTaxCode),
      localPickupLocationReady: locationReady && settings?.localPickupTaxTreatment !== "pending_review",
      signedWebhookReady,
      testCheckoutStatus: settings?.taxPreviewOnlinePassed ? "passed" : mode === "test" ? "not_run" : "blocked"
    },
    pos: {
      runtimeEnabled: features.posSalesTaxEnabled,
      calculationsApiReady: providerConfigured,
      transactionsApiReady: providerConfigured,
      storePickupLocationReady: locationReady,
      deliveryAddressPathReady: providerConfigured && validTaxCode(shippingTaxCode),
      offStripePaymentRecordingReady: providerConfigured,
      reversalRefundPathReady: providerConfigured && Boolean(settings?.taxRefundVerified)
    },
    blockers
  };
}

export async function runStripeTaxConnectivityCheck(userId: string) {
  const settings = await prisma.storefrontSettings.findUnique({
    where: { userId },
    select: { storeCountry: true, storeState: true }
  });
  const provider = await checkStripeTaxProviderReadiness(settings?.storeCountry ?? "US", settings?.storeState ?? "FL");
  return getStripeTaxReadiness(userId, provider);
}
