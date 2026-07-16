import { getBuildInfo } from "@/lib/build-info";
import { prisma } from "@/lib/db";
import { getAppHealth } from "@/lib/health";
import { getStripeTaxRegistrationStatus } from "@/lib/stripe-tax";
import { taxFeatureConfig } from "@/lib/tax";
import { TAX_CERTIFICATION_SCENARIOS } from "@/lib/tax-certification";
import type { SessionUser } from "@/types/radar";

type Blocker = { code: string; label: string; critical: true };

export type TaxGoLivePreflightInput = {
  stripeMode: "live" | "test" | "missing" | "mixed";
  registrationActive: boolean;
  verifiedPos: boolean;
  verifiedPickup: boolean;
  productCodeReady: boolean;
  shippingCodeReady: boolean;
  webhookConfigured: boolean;
  certificationComplete: boolean;
  certificationPassed: number;
  certificationRequired: number;
  reconciliationClean: boolean;
  ownerApproved: boolean;
  accountantReviewed: boolean;
  onlineFlag: boolean;
  posFlag: boolean;
};

export function evaluateTaxGoLivePreflight(input: TaxGoLivePreflightInput) {
  const blockers: Blocker[] = [];
  const block = (condition: boolean, code: string, label: string) => { if (condition) blockers.push({ code, label, critical: true }); };
  block(input.stripeMode === "missing" || input.stripeMode === "mixed", "live_stripe_key_missing", "A complete live Stripe key pair is required.");
  block(input.stripeMode === "test", "stripe_test_mode", "Stripe test mode cannot be treated as live.");
  block(!input.registrationActive, "florida_registration_missing", "Stripe must report an active Florida registration.");
  block(!input.verifiedPos, "pos_location_missing", "A verified default POS location is required.");
  block(!input.verifiedPickup, "pickup_location_missing", "A verified default Local Pickup location is required.");
  block(!input.productCodeReady, "product_tax_code_missing", "A valid default product tax code is required.");
  block(!input.shippingCodeReady, "shipping_tax_code_missing", "A valid shipping tax code is required.");
  block(!input.webhookConfigured, "webhook_missing", "The signed Stripe webhook secret is required.");
  block(!input.certificationComplete, "certification_incomplete", `Stripe test certification is incomplete (${input.certificationPassed}/${input.certificationRequired}).`);
  block(!input.reconciliationClean, "reconciliation_not_clean", "Tax reconciliation must be confirmed with no critical provider transaction errors.");
  block(!input.ownerApproved, "owner_approval_missing", "Owner readiness approval is required.");
  block(!input.accountantReviewed, "accountant_review_missing", "Accountant review confirmation is required.");
  return { blockers, status: blockers.length ? "blocked" as const : (input.onlineFlag || input.posFlag ? "live" as const : "ready_flags_off" as const) };
}

function stripeMode() {
  const secret = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const publishable = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ?? "";
  if (secret.startsWith("sk_live_") && publishable.startsWith("pk_live_")) return "live" as const;
  if (secret.startsWith("sk_test_") && publishable.startsWith("pk_test_")) return "test" as const;
  if (!secret && !publishable) return "missing" as const;
  return "mixed" as const;
}

export async function getTaxGoLiveSwitchboard(user: SessionUser) {
  const now = new Date();
  const build = getBuildInfo();
  const flags = taxFeatureConfig();
  const mode = stripeMode();
  const [settings, locations, certification, criticalReconciliationCount, health] = await Promise.all([
    prisma.storefrontSettings.findUnique({ where: { userId: user.id } }),
    prisma.taxLocation.findMany({ where: { userId: user.id, active: true }, select: { defaultForPos: true, defaultForLocalPickup: true, verificationStatus: true } }),
    prisma.taxCertificationEvidence.findMany({
      where: { userId: user.id, providerMode: "stripe_test", buildCommit: build.commitShort },
      select: { scenario: true, status: true, expiresAt: true }
    }),
    prisma.inventorySale.count({ where: { userId: user.id, platform: "pos", taxTransactionStatus: { in: ["failed", "mismatch"] } } }),
    getAppHealth(user).catch(() => null)
  ]);
  let registrationStatus: "active" | "inactive" | "unknown" = "unknown";
  if (mode === "live") {
    try {
      registrationStatus = (await getStripeTaxRegistrationStatus("US", "FL")).status;
    } catch {
      registrationStatus = "unknown";
    }
  }
  const certified = new Set(certification.filter((item) => item.status === "passed" && item.expiresAt && item.expiresAt > now).map((item) => item.scenario));
  const certificationComplete = TAX_CERTIFICATION_SCENARIOS.every((scenario) => certified.has(scenario));
  const verifiedPos = locations.some((location) => location.defaultForPos && location.verificationStatus === "verified");
  const verifiedPickup = locations.some((location) => location.defaultForLocalPickup && location.verificationStatus === "verified");
  const productCodeReady = /^txcd_\d{8}$/.test(settings?.defaultStripeTaxCode ?? "");
  const shippingCodeReady = /^txcd_\d{8}$/.test(settings?.shippingStripeTaxCode ?? "");
  const reconciliationClean = Boolean(settings?.taxReportReconciled) && criticalReconciliationCount === 0;
  const ownerApproved = Boolean(settings?.taxOwnerApprovedAt);
  const accountantReviewed = Boolean(settings?.taxAccountantReviewedAt);
  const preflight = evaluateTaxGoLivePreflight({
    stripeMode: mode, registrationActive: registrationStatus === "active", verifiedPos, verifiedPickup, productCodeReady, shippingCodeReady,
    webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()), certificationComplete, certificationPassed: certified.size,
    certificationRequired: TAX_CERTIFICATION_SCENARIOS.length, reconciliationClean, ownerApproved, accountantReviewed,
    onlineFlag: flags.onlineStripeTaxEnabled, posFlag: flags.posSalesTaxEnabled
  });

  return {
    generatedAt: now.toISOString(),
    status: preflight.status,
    flags: {
      online: flags.onlineStripeTaxEnabled,
      pos: flags.posSalesTaxEnabled,
      reporting: flags.taxReportingEnabled,
      exemption: flags.taxExemptSalesEnabled,
      manualFallback: flags.manualTaxFallbackEnabled,
      conflict: flags.posTaxModeConflict
    },
    stripe: { mode, registrationStatus, webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET?.trim()) },
    locations: { verifiedPos, verifiedPickup },
    codes: { product: productCodeReady, shipping: shippingCodeReady },
    certification: { complete: certificationComplete, passed: certified.size, required: TAX_CERTIFICATION_SCENARIOS.length, buildCommit: build.commitShort },
    reconciliation: { clean: reconciliationClean, criticalErrorCount: criticalReconciliationCount },
    approvals: {
      ownerApproved, ownerApprovedAt: settings?.taxOwnerApprovedAt?.toISOString() ?? null,
      accountantReviewed, accountantReviewedAt: settings?.taxAccountantReviewedAt?.toISOString() ?? null,
      accountantReviewNote: settings?.taxAccountantReviewNote ?? ""
    },
    blockers: preflight.blockers,
    build: { commit: build.commitShort, deployId: build.deployId },
    health: health ? { status: health.status, checkedAt: health.checkedAt, databaseOk: health.database.ok } : { status: "ERROR", checkedAt: now.toISOString(), databaseOk: false },
    launchInstructions: [
      "Have the owner and accountant review this preflight together.",
      "Enable ONLINE_STRIPE_TAX_ENABLED=true only for approved online launch scope.",
      "Enable POS_STRIPE_TAX_ENABLED=true only for approved POS launch scope.",
      "Keep MANUAL_TAX_FALLBACK_ENABLED=false during normal operation.",
      "Redeploy, run this preflight again, then monitor the first tax transactions and reconciliation."
    ],
    rollbackInstructions: [
      "Set ONLINE_STRIPE_TAX_ENABLED=false and POS_STRIPE_TAX_ENABLED=false, then redeploy.",
      "Preserve every completed tax snapshot and stop new tax calculations.",
      "Allow already-created Checkout Sessions to expire or verify their signed webhook before fulfillment.",
      "Keep reports and original-snapshot refunds available.",
      "Notify the owner and accountant, then reconcile the affected period before re-enabling."
    ]
  };
}

export async function saveTaxGoLiveApprovals(user: SessionUser, input: { ownerApproved: boolean; accountantReviewed: boolean; accountantReviewNote: string }, requestId: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const settings = await tx.storefrontSettings.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        taxOwnerApprovedAt: input.ownerApproved ? now : null,
        taxAccountantReviewedAt: input.accountantReviewed ? now : null,
        taxAccountantReviewedByUserId: input.accountantReviewed ? user.id : null,
        taxAccountantReviewNote: input.accountantReviewed ? input.accountantReviewNote : null
      },
      update: {
        taxOwnerApprovedAt: input.ownerApproved ? now : null,
        taxAccountantReviewedAt: input.accountantReviewed ? now : null,
        taxAccountantReviewedByUserId: input.accountantReviewed ? user.id : null,
        taxAccountantReviewNote: input.accountantReviewed ? input.accountantReviewNote : null
      }
    });
    await tx.auditLog.create({
      data: {
        userId: user.id, actorEmail: user.email, action: "tax.go_live.approvals_updated", entityType: "TAX_SETTINGS", entityId: settings.id,
        summary: "Tax go-live approvals updated.", metadata: JSON.stringify({ requestId, ownerApproved: input.ownerApproved, accountantReviewed: input.accountantReviewed })
      }
    });
  });
  return getTaxGoLiveSwitchboard(user);
}
