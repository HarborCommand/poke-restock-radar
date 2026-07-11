import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rewardEligibleSubtotalCents, rewardPointsForEligibleSubtotalCents } from "@/lib/customer-rewards";
import { normalizeCustomerAccountEmail } from "@/lib/customer-account-auth";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import type {
  AdminCustomerAttachOrderCandidateDTO,
  AdminCustomerAttachRewardStatus,
  AdminCustomerAttachOrderResultDTO,
  AdminCustomerAttachOrderSearchResponseDTO,
  AdminCustomerRewardsDetailDTO,
  AdminCustomerPurchaseMatchStatus,
  SessionUser
} from "@/types/radar";

type AttachType = "storefront_order" | "pos_sale";

type AttachInput = {
  type: AttachType;
  orderId?: string;
  saleId?: string;
  saleReference?: string;
  reason: string;
  note?: string;
  confirmEmailMismatch: boolean;
  confirmRewardApplication?: boolean;
  applyRewards: boolean;
};

type BackfillRewardResult = {
  status: AdminCustomerAttachRewardStatus;
  points: number;
  message: string;
};

type RewardCandidate = {
  eligible: boolean;
  alreadyAwarded: boolean;
  defaultApply: boolean;
  status: AdminCustomerAttachRewardStatus;
  points: number;
  message: string;
  disabledReason: string | null;
};

type CustomerLinkSource = "email_match" | "admin_manual" | "pos_match";
type OwnershipAuditStatus = "email_match" | "email_mismatch_manual" | "no_email_manual_review";

type OwnershipMatch = {
  status: AdminCustomerPurchaseMatchStatus;
  message: string;
  requiresManualConfirmation: boolean;
  requiresInternalNote: boolean;
  ownershipReviewCompleted: boolean;
};

const candidateLimit = 10;

const candidateOrderInclude = {
  customerAccount: {
    select: {
      id: true,
      email: true,
      displayName: true
    }
  },
  items: {
    select: {
      publicTitle: true,
      lineTotal: true,
      quantity: true
    }
  },
  rewardLedgerEntries: {
    select: {
      points: true,
      type: true,
      status: true,
      source: true,
      idempotencyKey: true
    }
  }
} satisfies Prisma.StorefrontOrderInclude;

type CandidateOrder = Prisma.StorefrontOrderGetPayload<{ include: typeof candidateOrderInclude }>;

const candidateSaleInclude = {
  customerAccount: {
    select: {
      id: true,
      email: true,
      displayName: true
    }
  },
  inventoryItem: {
    select: {
      itemName: true
    }
  }
} satisfies Prisma.InventorySaleInclude;

type CandidateSale = Prisma.InventorySaleGetPayload<{ include: typeof candidateSaleInclude }>;

function maskEmail(value: string | null | undefined) {
  const email = value?.trim();
  if (!email || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${local.length > 2 ? "***" : "*"}@${domain}`;
}

function maskPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  if (digits.length < 4) return "Phone saved";
  return `***-***-${digits.slice(-4)}`;
}

function displayNameForCustomer(customer: { displayName: string | null; email: string }) {
  return customer.displayName?.trim() || customer.email.split("@")[0] || "Customer";
}

function customerSummary(customer: { id: string; email: string; displayName: string | null } | null) {
  return customer
    ? {
        id: customer.id,
        displayName: displayNameForCustomer(customer),
        maskedEmail: maskEmail(customer.email) ?? "Email saved"
      }
    : null;
}

function normalizeEmail(value: string | null | undefined) {
  return normalizeCustomerAccountEmail(value);
}

function hasRecordedOwnershipReview(record: {
  customerAccountId: string | null;
  customerLinkSource: string | null;
  customerLinkReason: string | null;
  customerLinkNote: string | null;
}) {
  return Boolean(
    record.customerAccountId &&
    record.customerLinkSource === "admin_manual" &&
    record.customerLinkReason?.trim() &&
    record.customerLinkNote?.trim()
  );
}

function ownershipMatch(
  recordEmail: string | null | undefined,
  customer: { email: string; status: string; emailVerifiedAt: Date | null },
  ownershipReviewCompleted = false
): OwnershipMatch {
  if (customer.status !== "active" || !customer.emailVerifiedAt) {
    return {
      status: "customer_unverified",
      message: "The selected customer account must be active with a verified email.",
      requiresManualConfirmation: false,
      requiresInternalNote: false,
      ownershipReviewCompleted
    };
  }
  const purchaseEmail = normalizeEmail(recordEmail);
  if (!purchaseEmail) {
    return {
      status: "no_email_recorded",
      message: "No customer email was saved on this historical sale.",
      requiresManualConfirmation: !ownershipReviewCompleted,
      requiresInternalNote: !ownershipReviewCompleted,
      ownershipReviewCompleted
    };
  }
  const customerEmail = normalizeEmail(customer.email) ?? customer.email.toLowerCase();
  if (purchaseEmail === customerEmail) {
    return {
      status: "email_match",
      message: "Verified email match.",
      requiresManualConfirmation: false,
      requiresInternalNote: false,
      ownershipReviewCompleted
    };
  }
  return {
    status: "email_mismatch",
    message: "Sale email does not match the verified customer email.",
    requiresManualConfirmation: !ownershipReviewCompleted,
    requiresInternalNote: !ownershipReviewCompleted,
    ownershipReviewCompleted
  };
}

function ownershipAuditStatus(matchStatus: AdminCustomerPurchaseMatchStatus): OwnershipAuditStatus {
  if (matchStatus === "email_match") return "email_match";
  return matchStatus === "no_email_recorded" ? "no_email_manual_review" : "email_mismatch_manual";
}

function orderSource(order: CandidateOrder): AdminCustomerAttachOrderCandidateDTO["source"] {
  return order.stripeCheckoutSessionId || order.stripePaymentIntentId ? "website" : "manual";
}

function orderStatusLabel(order: CandidateOrder) {
  if (order.isTestOrder) return "Test/smoke";
  if (order.status === "canceled") return "Canceled";
  if (order.paymentStatus === "refunded" || order.status === "refunded") return "Refunded";
  if (order.paymentStatus === "partially_refunded") return "Partially refunded";
  if (order.paymentStatus === "paid") return order.fulfillmentStatus === "shipped" || order.fulfillmentStatus === "picked_up" ? "Paid / fulfilled" : "Paid";
  return order.paymentStatus;
}

function hasPositiveRewardLedger(order: CandidateOrder) {
  return order.rewardLedgerEntries.some((entry) => entry.points > 0 && entry.type === "earn");
}

function rewardMessage(status: AdminCustomerAttachRewardStatus, points = 0, matchStatus?: AdminCustomerPurchaseMatchStatus) {
  switch (status) {
    case "eligible":
      return "Rewards can be applied for this linked purchase.";
    case "applied":
      return matchStatus === "no_email_recorded"
        ? `${points.toLocaleString()} reward point${points === 1 ? "" : "s"} awarded after admin ownership review.`
        : `${points.toLocaleString()} reward point${points === 1 ? "" : "s"} awarded.`;
    case "checkbox_not_selected":
      return "Rewards not applied because Apply Rewards was not selected.";
    case "blocked_email_mismatch":
      return "Rewards cannot be applied because the recorded sale email belongs to a different email address.";
    case "canceled_or_refunded":
      return "Rewards not applied because canceled, refunded, or partially refunded purchases do not earn points.";
    case "no_eligible_subtotal":
      return "Rewards not applied because there is no eligible product subtotal.";
    case "rewards_disabled":
      return "Rewards not applied because customer rewards are disabled.";
    case "already_awarded":
      return "Rewards already awarded for this purchase.";
    case "unpaid":
      return "Rewards not applied because only paid purchases can earn points.";
    case "test_or_smoke":
      return "Rewards not applied because test or smoke orders do not earn points.";
    case "customer_not_verified":
      return "Rewards not applied because the customer account must be active with a verified email.";
    case "ineligible":
    default:
      return "Rewards are not eligible for this purchase.";
  }
}

function rewardCandidate(status: AdminCustomerAttachRewardStatus, points = 0, alreadyAwarded = false, defaultApply = status === "eligible"): RewardCandidate {
  return {
    eligible: status === "eligible",
    alreadyAwarded,
    defaultApply,
    status,
    points,
    message: rewardMessage(status, points),
    disabledReason: status === "eligible" ? null : rewardMessage(status, points)
  };
}

function orderEligibleSubtotalCents(order: CandidateOrder) {
  return rewardEligibleSubtotalCents({
    subtotal: order.subtotal,
    items: order.items.map((item) => ({ lineTotal: item.lineTotal }))
  });
}

function orderRewardCandidate(order: CandidateOrder, match: OwnershipMatch): RewardCandidate {
  if (!rewardsFeatureEnabledForBackfill()) return rewardCandidate("rewards_disabled");
  const alreadyAwarded = hasPositiveRewardLedger(order);
  const refunded = order.refundedAmount > 0 || order.status === "refunded" || order.paymentStatus === "refunded" || order.paymentStatus === "partially_refunded";
  const eligibleSubtotalCents = orderEligibleSubtotalCents(order);
  const points = rewardPointsForEligibleSubtotalCents(eligibleSubtotalCents);
  if (order.isTestOrder) return rewardCandidate("test_or_smoke");
  if (order.status === "canceled" || refunded) return rewardCandidate("canceled_or_refunded");
  if (order.paymentStatus !== "paid") return rewardCandidate("unpaid");
  if (alreadyAwarded) return rewardCandidate("already_awarded", 0, true);
  if (points <= 0) return rewardCandidate("no_eligible_subtotal");
  if (match.status === "customer_unverified") return rewardCandidate("customer_not_verified");
  if (match.status === "email_mismatch") return rewardCandidate("blocked_email_mismatch");
  return rewardCandidate("eligible", points, false, match.status === "email_match");
}

function mapOrderCandidate(
  order: CandidateOrder,
  customer: { id: string; email: string; status: string; emailVerifiedAt: Date | null }
): AdminCustomerAttachOrderCandidateDTO {
  const match = ownershipMatch(order.customerEmail, customer, hasRecordedOwnershipReview(order));
  const rewards = orderRewardCandidate(order, match);
  return {
    id: order.id,
    type: "storefront_order",
    reference: order.orderNumber,
    saleId: null,
    saleReference: null,
    date: order.createdAt.toISOString(),
    source: orderSource(order),
    maskedCustomerEmail: maskEmail(order.customerEmail),
    maskedCustomerPhone: maskPhone(order.customerPhone),
    total: order.total,
    eligibleSubtotal: orderEligibleSubtotalCents(order) / 100,
    status: orderStatusLabel(order),
    currentLinkedCustomer: customerSummary(order.customerAccount),
    itemSummary: order.items.map((item) => item.publicTitle).filter(Boolean).join(", ") || "Order items",
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    matchStatus: match.status,
    matchMessage: match.message,
    requiresManualConfirmation: match.requiresManualConfirmation,
    requiresInternalNote: match.requiresInternalNote,
    ownershipReviewCompleted: match.ownershipReviewCompleted,
    rewardsEligible: rewards.eligible,
    rewardsBlockedReason: rewards.disabledReason,
    emailMatchesCustomer: match.status === "email_match",
    rewards
  };
}

function saleStatusLabel(sales: CandidateSale[]) {
  if (sales.some((sale) => sale.refundStatus === "canceled")) return "Canceled";
  if (sales.every((sale) => sale.refundStatus === "refunded")) return "Refunded";
  if (sales.some((sale) => sale.refundedAmount > 0 || sale.refundStatus === "partially_refunded")) return "Partially refunded";
  return "Completed";
}

function saleAlreadyAwarded(saleKey: string, ledger: Array<{ idempotencyKey: string | null; points: number; source: string | null; metadataJson: string | null }>) {
  return ledger.some((entry) => {
    if (entry.points <= 0) return false;
    if (entry.idempotencyKey === `rewards:pos:earn:${saleKey}` || entry.idempotencyKey === `rewards:backfill:pos:${saleKey}`) return true;
    if (entry.source === "pos" || entry.source === "admin_pos_link_backfill" || entry.source === "admin_legacy_sale_backfill") {
      return typeof entry.metadataJson === "string" && (entry.metadataJson.includes(`"saleReference":"${saleKey}"`) || entry.metadataJson.includes(`"saleId":"${saleKey}"`) || entry.metadataJson.includes(`"saleKey":"${saleKey}"`));
    }
    return false;
  });
}

function saleEligibleSubtotalCents(sales: CandidateSale[]) {
  return sales.reduce((sum, sale) => sum + Math.max(0, Math.round(sale.grossSale * 100)), 0);
}

function saleRewardCandidate(sales: CandidateSale[], alreadyAwarded: boolean, match: OwnershipMatch): RewardCandidate {
  if (!rewardsFeatureEnabledForBackfill()) return rewardCandidate("rewards_disabled");
  const refunded = sales.some((sale) => sale.refundStatus || sale.refundedAmount > 0);
  const eligibleSubtotalCents = saleEligibleSubtotalCents(sales);
  const points = rewardPointsForEligibleSubtotalCents(eligibleSubtotalCents);
  if (refunded) return rewardCandidate("canceled_or_refunded");
  if (alreadyAwarded) return rewardCandidate("already_awarded", 0, true);
  if (points <= 0) return rewardCandidate("no_eligible_subtotal");
  if (match.status === "customer_unverified") return rewardCandidate("customer_not_verified");
  if (match.status === "email_mismatch") return rewardCandidate("blocked_email_mismatch");
  return rewardCandidate("eligible", points, false, match.status === "email_match");
}

function saleAttachKey(sale: Pick<CandidateSale, "id" | "saleReference">) {
  return sale.saleReference?.trim() || sale.id;
}

async function mapSaleCandidates(
  groupedSales: CandidateSale[][],
  customer: { id: string; email: string; status: string; emailVerifiedAt: Date | null },
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<AdminCustomerAttachOrderCandidateDTO[]> {
  const keys = groupedSales.map((sales) => sales[0] ? saleAttachKey(sales[0]) : null).filter((value): value is string => Boolean(value));
  const ledger = keys.length
    ? await client.rewardLedgerEntry.findMany({
        where: {
          OR: [
            { idempotencyKey: { in: keys.flatMap((ref) => [`rewards:pos:earn:${ref}`, `rewards:backfill:pos:${ref}`]) } },
            { source: { in: ["pos", "admin_pos_link_backfill", "admin_legacy_sale_backfill"] } }
          ]
        },
        select: { idempotencyKey: true, points: true, source: true, metadataJson: true }
      })
    : [];
  return groupedSales.map((sales) => {
    const first = sales[0]!;
    const key = saleAttachKey(first);
    const saleReference = first.saleReference?.trim() || null;
    const reviewCompleted = sales.every((sale) => hasRecordedOwnershipReview(sale));
    const match = ownershipMatch(first.customerEmail, customer, reviewCompleted);
    const alreadyAwarded = saleAlreadyAwarded(key, ledger);
    const total = sales.reduce((sum, sale) => sum + Math.max(0, sale.grossSale - sale.refundedAmount), 0);
    const rewards = saleRewardCandidate(sales, alreadyAwarded, match);
    return {
      id: key,
      type: "pos_sale",
      reference: saleReference ?? first.id,
      saleId: saleReference ? null : first.id,
      saleReference,
      date: first.soldAt.toISOString(),
      source: first.platform === "pos" ? "pos" : "manual",
      maskedCustomerEmail: maskEmail(first.customerEmail),
      maskedCustomerPhone: maskPhone(first.customerPhone),
      total,
      eligibleSubtotal: saleEligibleSubtotalCents(sales) / 100,
      status: saleStatusLabel(sales),
      currentLinkedCustomer: customerSummary(first.customerAccount),
      itemSummary: sales.map((sale) => sale.inventoryItem.itemName).filter(Boolean).join(", "),
      itemCount: sales.reduce((sum, sale) => sum + sale.quantitySold, 0),
      matchStatus: match.status,
      matchMessage: match.message,
      requiresManualConfirmation: match.requiresManualConfirmation,
      requiresInternalNote: match.requiresInternalNote,
      ownershipReviewCompleted: match.ownershipReviewCompleted,
      rewardsEligible: rewards.eligible,
      rewardsBlockedReason: rewards.disabledReason,
      emailMatchesCustomer: match.status === "email_match",
      rewards
    };
  });
}

function groupSalesByReference(sales: CandidateSale[]) {
  const groups = new Map<string, CandidateSale[]>();
  for (const sale of sales) {
    const reference = saleAttachKey(sale);
    groups.set(reference, [...(groups.get(reference) ?? []), sale]);
  }
  return [...groups.values()].sort((left, right) => right[0]!.soldAt.getTime() - left[0]!.soldAt.getTime());
}

async function loadAttachCustomer(customerAccountId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const customer = await client.customerAccount.findUnique({
    where: { id: customerAccountId },
    select: {
      id: true,
      email: true,
      normalizedEmail: true,
      displayName: true,
      status: true,
      emailVerifiedAt: true
    }
  });
  if (!customer) throw new Error("Customer account was not found.");
  return customer;
}

export async function searchAdminCustomerAttachCandidates(
  customerAccountId: string,
  query?: string | null
): Promise<AdminCustomerAttachOrderSearchResponseDTO> {
  const customer = await loadAttachCustomer(customerAccountId);
  const search = query?.trim();
  const orderWhere: Prisma.StorefrontOrderWhereInput = search
    ? {
        OR: [
          { orderNumber: { contains: search } },
          { customerEmail: { contains: search } },
          { customerName: { contains: search } },
          { customerPhone: { contains: search } },
          { items: { some: { publicTitle: { contains: search } } } }
        ]
      }
    : {};
  const saleWhere: Prisma.InventorySaleWhereInput = search
    ? {
        OR: [
          { id: { contains: search } },
          { saleReference: { contains: search } },
          { customerEmail: { contains: search } },
          { customerPhone: { contains: search } },
          { inventoryItem: { is: { itemName: { contains: search } } } }
        ]
      }
    : {};

  const [orders, saleRefs] = await Promise.all([
    prisma.storefrontOrder.findMany({
      where: orderWhere,
      include: candidateOrderInclude,
      orderBy: { createdAt: "desc" },
      take: candidateLimit
    }),
    prisma.inventorySale.findMany({
      where: saleWhere,
      select: { id: true, saleReference: true, soldAt: true },
      orderBy: { soldAt: "desc" },
      take: candidateLimit * 3
    })
  ]);

  const keys = [...new Set(saleRefs.map((sale) => sale.saleReference?.trim() || sale.id).filter(Boolean))].slice(0, candidateLimit);
  const saleReferences = keys.filter((key) => saleRefs.some((sale) => sale.saleReference?.trim() === key));
  const saleIds = keys.filter((key) => !saleReferences.includes(key));
  const sales = keys.length
    ? await prisma.inventorySale.findMany({
        where: {
          OR: [
            ...(saleReferences.length ? [{ saleReference: { in: saleReferences } }] : []),
            ...(saleIds.length ? [{ id: { in: saleIds } }] : [])
          ]
        },
        include: candidateSaleInclude,
        orderBy: { soldAt: "desc" }
      })
    : [];
  const saleCandidates = await mapSaleCandidates(groupSalesByReference(sales), customer);
  return {
    customer: {
      id: customer.id,
      displayName: displayNameForCustomer(customer),
      maskedEmail: maskEmail(customer.email) ?? "Email saved",
      status: customer.status,
      emailVerified: Boolean(customer.emailVerifiedAt)
    },
    candidates: [
      ...orders.map((order) => mapOrderCandidate(order, customer)),
      ...saleCandidates
    ]
      .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
      .slice(0, candidateLimit)
  };
}

function assertAttachCustomerIsEligible(customer: Awaited<ReturnType<typeof loadAttachCustomer>>) {
  if (customer.status !== "active") throw new Error("Only active customer accounts can be linked.");
  if (!customer.emailVerifiedAt) throw new Error("Customer account email must be verified before attaching orders.");
}

function linkSourceFor(matchStatus: AdminCustomerPurchaseMatchStatus, existingPosMatch = false): CustomerLinkSource {
  if (matchStatus === "email_match" && existingPosMatch) return "pos_match";
  return matchStatus === "email_match" ? "email_match" : "admin_manual";
}

function assertOwnershipReview(input: AttachInput, match: OwnershipMatch, label: string) {
  if (match.status === "email_match" || match.ownershipReviewCompleted) return;
  if (match.status === "customer_unverified") throw new Error("The selected customer account must be active with a verified email.");
  if (!input.confirmEmailMismatch) {
    throw new Error(
      match.status === "no_email_recorded"
        ? `${label} has no historical customer email. Confirm the ownership review before attaching.`
        : `${label} email does not match this customer. Confirm the manual override to attach anyway.`
    );
  }
  if (!input.note?.trim()) {
    throw new Error(match.status === "no_email_recorded" ? "Legacy ownership reviews require an internal note." : "Manual mismatch overrides require an internal note.");
  }
}

function assertRewardApplicationConfirmed(input: AttachInput, match: OwnershipMatch, duplicate: boolean, label: string) {
  if (!input.applyRewards || !duplicate) return;
  if (!input.confirmRewardApplication) {
    throw new Error(`Confirm the ${label.toLowerCase()} reward application before adding points.`);
  }
  if (match.status !== "no_email_recorded") return;
  if (!input.confirmEmailMismatch) {
    throw new Error(`${label} has no historical customer email. Confirm the ownership review before applying rewards.`);
  }
  if (!input.note?.trim()) {
    throw new Error("Legacy reward applications require a private internal note.");
  }
}

function rewardsFeatureEnabledForBackfill() {
  const config = customerAccountFeatureConfig();
  return config.customerAccountsEnabled && config.customerRewardsEnabled;
}

async function awardOrderBackfillIfRequested(
  tx: Prisma.TransactionClient,
  input: {
    order: CandidateOrder;
    customerAccountId: string;
    applyRewards: boolean;
    match: OwnershipMatch;
    adminUser: SessionUser;
    reason: string;
  }
) : Promise<BackfillRewardResult> {
  if (!input.applyRewards) return { status: "checkbox_not_selected", points: 0, message: rewardMessage("checkbox_not_selected") };
  if (input.match.status === "email_mismatch") return { status: "blocked_email_mismatch", points: 0, message: rewardMessage("blocked_email_mismatch") };
  if (input.match.status === "customer_unverified") return { status: "customer_not_verified", points: 0, message: rewardMessage("customer_not_verified") };
  const candidate = orderRewardCandidate(input.order, input.match);
  if (!candidate.eligible) return { status: candidate.status, points: 0, message: candidate.message };

  const eligibleSubtotalCents = rewardEligibleSubtotalCents({
    subtotal: input.order.subtotal,
    items: input.order.items.map((item) => ({ lineTotal: item.lineTotal }))
  });
  const points = rewardPointsForEligibleSubtotalCents(eligibleSubtotalCents);
  if (points <= 0) return { status: "no_eligible_subtotal", points: 0, message: rewardMessage("no_eligible_subtotal") };

  const idempotencyKey = `rewards:backfill:order:${input.order.id}`;
  const existing = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey } });
  if (existing) return { status: "already_awarded", points: 0, message: rewardMessage("already_awarded") };

  const now = new Date();
  const available = input.order.fulfillmentStatus === "shipped" || input.order.fulfillmentStatus === "picked_up";
  await tx.rewardLedgerEntry.create({
    data: {
      customerAccountId: input.customerAccountId,
      orderId: input.order.id,
      idempotencyKey,
      points,
      type: "earn",
      reason: input.match.status === "no_email_recorded" ? "Admin-reviewed legacy order eligible item subtotal" : "Admin-linked past order eligible item subtotal",
      status: available ? "available" : "pending",
      source: input.match.status === "no_email_recorded" ? "admin_legacy_order_backfill" : "admin_order_link_backfill",
      availableAt: now,
      settledAt: available ? now : null,
      eligibleSubtotalCents,
      metadataJson: JSON.stringify({
        createdBy: "admin",
        adminUserId: input.adminUser.id,
        orderNumber: input.order.orderNumber,
        reason: input.reason,
        ownershipMatchStatus: ownershipAuditStatus(input.match.status),
        shippingCentsExcluded: Math.max(0, Math.round(input.order.shippingCharged * 100)),
        taxCentsExcluded: Math.max(0, Math.round(input.order.tax * 100)),
        rule: "1 point per eligible item subtotal dollar"
      })
    }
  });
  await tx.rewardBalance.upsert({
    where: { customerAccountId: input.customerAccountId },
    create: {
      customerAccountId: input.customerAccountId,
      availablePoints: available ? points : 0,
      pendingPoints: available ? 0 : points,
      lifetimeEarnedPoints: points
    },
    update: {
      availablePoints: available ? { increment: points } : undefined,
      pendingPoints: available ? undefined : { increment: points },
      lifetimeEarnedPoints: { increment: points }
    }
  });
  return { status: "applied", points, message: rewardMessage("applied", points, input.match.status) };
}

async function awardPosBackfillIfRequested(
  tx: Prisma.TransactionClient,
  input: {
    sales: CandidateSale[];
    customerAccountId: string;
    saleKey: string;
    applyRewards: boolean;
    match: OwnershipMatch;
    adminUser: SessionUser;
    reason: string;
  }
) : Promise<BackfillRewardResult> {
  if (!input.applyRewards) return { status: "checkbox_not_selected", points: 0, message: rewardMessage("checkbox_not_selected") };
  if (input.match.status === "email_mismatch") return { status: "blocked_email_mismatch", points: 0, message: rewardMessage("blocked_email_mismatch") };
  if (input.match.status === "customer_unverified") return { status: "customer_not_verified", points: 0, message: rewardMessage("customer_not_verified") };
  const existing = await tx.rewardLedgerEntry.findMany({
    where: {
      OR: [
        { idempotencyKey: { in: [`rewards:pos:earn:${input.saleKey}`, `rewards:backfill:pos:${input.saleKey}`] } },
        { source: { in: ["pos", "admin_pos_link_backfill", "admin_legacy_sale_backfill"] }, metadataJson: { contains: input.saleKey } }
      ]
    },
    select: { idempotencyKey: true, points: true, source: true, metadataJson: true }
  });
  if (saleAlreadyAwarded(input.saleKey, existing)) return { status: "already_awarded", points: 0, message: rewardMessage("already_awarded") };
  const candidate = saleRewardCandidate(input.sales, false, input.match);
  if (!candidate.eligible) return { status: candidate.status, points: 0, message: candidate.message };
  const refunded = input.sales.some((sale) => sale.refundStatus || sale.refundedAmount > 0);
  if (refunded) return { status: "canceled_or_refunded", points: 0, message: rewardMessage("canceled_or_refunded") };
  const eligibleSubtotalCents = input.sales.reduce((sum, sale) => sum + Math.max(0, Math.round(sale.grossSale * 100)), 0);
  const points = rewardPointsForEligibleSubtotalCents(eligibleSubtotalCents);
  if (points <= 0) return { status: "no_eligible_subtotal", points: 0, message: rewardMessage("no_eligible_subtotal") };

  const now = new Date();
  const firstSale = input.sales[0]!;
  await tx.rewardLedgerEntry.create({
    data: {
      customerAccountId: input.customerAccountId,
      orderId: null,
      idempotencyKey: `rewards:backfill:pos:${input.saleKey}`,
      points,
      type: "earn",
      reason: input.match.status === "no_email_recorded" ? "Admin-reviewed legacy sale eligible subtotal" : "Admin-linked POS sale eligible subtotal",
      status: "available",
      source: input.match.status === "no_email_recorded" ? "admin_legacy_sale_backfill" : "admin_pos_link_backfill",
      availableAt: now,
      settledAt: now,
      eligibleSubtotalCents,
      metadataJson: JSON.stringify({
        createdBy: "admin",
        adminUserId: input.adminUser.id,
        saleKey: input.saleKey,
        saleReference: firstSale.saleReference,
        saleId: firstSale.saleReference ? null : firstSale.id,
        reason: input.reason,
        ownershipMatchStatus: ownershipAuditStatus(input.match.status),
        itemCount: input.sales.reduce((sum, sale) => sum + sale.quantitySold, 0),
        rule: "1 point per eligible adjusted POS subtotal dollar"
      })
    }
  });
  await tx.rewardBalance.upsert({
    where: { customerAccountId: input.customerAccountId },
    create: {
      customerAccountId: input.customerAccountId,
      availablePoints: points,
      pendingPoints: 0,
      lifetimeEarnedPoints: points
    },
    update: {
      availablePoints: { increment: points },
      lifetimeEarnedPoints: { increment: points }
    }
  });
  return { status: "applied", points, message: rewardMessage("applied", points, input.match.status) };
}

async function attachStorefrontOrder(
  tx: Prisma.TransactionClient,
  customer: Awaited<ReturnType<typeof loadAttachCustomer>>,
  adminUser: SessionUser,
  input: AttachInput
) {
  const order = await tx.storefrontOrder.findUnique({
    where: { id: input.orderId },
    include: candidateOrderInclude
  });
  if (!order) throw new Error("Order was not found.");
  if (order.customerAccountId && order.customerAccountId !== customer.id) {
    throw new Error("This order is already linked to another customer.");
  }
  const duplicate = order.customerAccountId === customer.id;
  const initialMatch = ownershipMatch(order.customerEmail, customer, hasRecordedOwnershipReview(order));
  assertOwnershipReview(input, initialMatch, "Order");
  assertRewardApplicationConfirmed(input, initialMatch, duplicate, "Order");
  const rewardReviewRecordedNow = input.applyRewards && duplicate && initialMatch.status === "no_email_recorded" && input.confirmRewardApplication && Boolean(input.confirmEmailMismatch && input.note?.trim());
  const reviewRecordedNow = (!initialMatch.ownershipReviewCompleted && initialMatch.requiresManualConfirmation && Boolean(input.confirmEmailMismatch && input.note?.trim())) || rewardReviewRecordedNow;
  const match: OwnershipMatch = reviewRecordedNow
    ? { ...initialMatch, requiresManualConfirmation: false, requiresInternalNote: false, ownershipReviewCompleted: true }
    : initialMatch;

  const linkSource = linkSourceFor(match.status);
  if (!duplicate) {
    await tx.storefrontOrder.update({
      where: { id: order.id },
      data: {
        customerAccountId: customer.id,
        customerLinkSource: linkSource,
        customerLinkedAt: new Date(),
        customerLinkedByUserId: adminUser.id,
        customerLinkReason: input.reason,
        customerLinkNote: input.note ?? null
      }
    });
    if (order.customerId && match.status === "email_match") {
      await tx.storefrontCustomer.updateMany({
        where: {
          id: order.customerId,
          OR: [{ customerAccountId: null }, { customerAccountId: customer.id }]
        },
        data: { customerAccountId: customer.id }
      });
    }
  } else if (reviewRecordedNow) {
    await tx.storefrontOrder.update({
      where: { id: order.id },
      data: {
        customerLinkSource: "admin_manual",
        customerLinkedByUserId: adminUser.id,
        customerLinkReason: input.reason,
        customerLinkNote: input.note?.trim() ?? null
      }
    });
  }

  const reward = await awardOrderBackfillIfRequested(tx, {
    order,
    customerAccountId: customer.id,
    applyRewards: input.applyRewards,
    match,
    adminUser,
    reason: input.reason
  });
  if (!duplicate || reviewRecordedNow) {
    await tx.auditLog.create({
      data: {
        userId: adminUser.id,
        actorEmail: adminUser.email,
        action: duplicate ? "customer.order.ownership_reviewed" : "customer.order.attached",
        entityType: "STOREFRONT_ORDER",
        entityId: order.id,
        summary: `${adminUser.email} linked order ${order.orderNumber} to a customer account.`,
        metadata: JSON.stringify({
          customerAccountId: customer.id,
          orderNumber: order.orderNumber,
          linkSource,
          ownershipMatchStatus: ownershipAuditStatus(match.status),
          reason: input.reason,
          hasInternalNote: Boolean(input.note),
          rewardsApplied: reward.status === "applied",
          rewardStatus: reward.status
        })
      }
    });
  }
  const refreshed = await tx.storefrontOrder.findUnique({
    where: { id: order.id },
    include: candidateOrderInclude
  });
  if (!refreshed) throw new Error("Order was not found after attach.");
  return { duplicate, reward, candidate: mapOrderCandidate(refreshed, customer) };
}

async function attachPosSale(
  tx: Prisma.TransactionClient,
  customer: Awaited<ReturnType<typeof loadAttachCustomer>>,
  adminUser: SessionUser,
  input: AttachInput
) {
  const saleReference = input.saleReference?.trim();
  const saleId = input.saleId?.trim();
  if (!saleReference && !saleId) throw new Error("Sale reference or sale ID is required.");
  const saleWhere: Prisma.InventorySaleWhereInput = saleReference ? { saleReference } : { id: saleId };
  const sales = await tx.inventorySale.findMany({
    where: saleWhere,
    include: candidateSaleInclude,
    orderBy: { soldAt: "desc" }
  });
  if (!sales.length) throw new Error("Sale was not found.");
  const otherLinked = sales.find((sale) => sale.customerAccountId && sale.customerAccountId !== customer.id);
  if (otherLinked) throw new Error("This sale is already linked to another customer.");
  const duplicate = sales.every((sale) => sale.customerAccountId === customer.id);
  const firstSale = sales[0]!;
  const saleKey = saleAttachKey(firstSale);
  const initialMatch = ownershipMatch(firstSale.customerEmail, customer, sales.every((sale) => hasRecordedOwnershipReview(sale)));
  assertOwnershipReview(input, initialMatch, "Sale");
  assertRewardApplicationConfirmed(input, initialMatch, duplicate, "Sale");
  const rewardReviewRecordedNow = input.applyRewards && duplicate && initialMatch.status === "no_email_recorded" && input.confirmRewardApplication && Boolean(input.confirmEmailMismatch && input.note?.trim());
  const reviewRecordedNow = (!initialMatch.ownershipReviewCompleted && initialMatch.requiresManualConfirmation && Boolean(input.confirmEmailMismatch && input.note?.trim())) || rewardReviewRecordedNow;
  const match: OwnershipMatch = reviewRecordedNow
    ? { ...initialMatch, requiresManualConfirmation: false, requiresInternalNote: false, ownershipReviewCompleted: true }
    : initialMatch;

  const linkSource = linkSourceFor(match.status, sales.some((sale) => sale.customerMatchMethod === "email"));
  if (!duplicate) {
    await tx.inventorySale.updateMany({
      where: saleWhere,
      data: {
        customerAccountId: customer.id,
        customerLinkSource: linkSource,
        customerLinkedAt: new Date(),
        customerLinkedByUserId: adminUser.id,
        customerLinkReason: input.reason,
        customerLinkNote: input.note ?? null,
        customerEmail: match.status === "email_match" ? customer.email : undefined,
        customerMatchMethod: match.status === "email_match" ? "email" : "admin_manual",
        rewardsEligible: false
      }
    });
  } else if (reviewRecordedNow) {
    await tx.inventorySale.updateMany({
      where: saleWhere,
      data: {
        customerLinkSource: "admin_manual",
        customerLinkedByUserId: adminUser.id,
        customerLinkReason: input.reason,
        customerLinkNote: input.note?.trim() ?? null,
        customerMatchMethod: "admin_manual"
      }
    });
  }

  const reward = await awardPosBackfillIfRequested(tx, {
    sales,
    customerAccountId: customer.id,
    saleKey,
    applyRewards: input.applyRewards,
    match,
    adminUser,
    reason: input.reason
  });
  if (reward.status === "applied") {
    await tx.inventorySale.updateMany({
      where: saleWhere,
      data: { rewardsEligible: true }
    });
  }
  if (!duplicate || reviewRecordedNow) {
    await tx.auditLog.create({
      data: {
        userId: adminUser.id,
        actorEmail: adminUser.email,
        action: duplicate ? "customer.pos_sale.ownership_reviewed" : "customer.pos_sale.attached",
        entityType: "INVENTORY_SALE",
        entityId: saleKey,
        summary: `${adminUser.email} linked sale ${saleKey} to a customer account.`,
        metadata: JSON.stringify({
          customerAccountId: customer.id,
          saleKey,
          saleReference: saleReference ?? null,
          saleId: saleReference ? null : saleId,
          linkSource,
          ownershipMatchStatus: ownershipAuditStatus(match.status),
          reason: input.reason,
          hasInternalNote: Boolean(input.note),
          rewardsApplied: reward.status === "applied",
          rewardStatus: reward.status
        })
      }
    });
  }

  const refreshed = await tx.inventorySale.findMany({
    where: saleWhere,
    include: candidateSaleInclude,
    orderBy: { soldAt: "desc" }
  });
  const [candidate] = await mapSaleCandidates(groupSalesByReference(refreshed), customer, tx);
  return { duplicate, reward, candidate };
}

export async function attachAdminCustomerOrder(
  adminUser: SessionUser,
  customerAccountId: string,
  input: AttachInput,
  getDetail: (customerAccountId: string) => Promise<AdminCustomerRewardsDetailDTO | null>
): Promise<AdminCustomerAttachOrderResultDTO> {
  const result = await prisma.$transaction(async (tx) => {
    const customer = await loadAttachCustomer(customerAccountId, tx);
    assertAttachCustomerIsEligible(customer);
    if (input.type === "storefront_order") {
      return attachStorefrontOrder(tx, customer, adminUser, input);
    }
    return attachPosSale(tx, customer, adminUser, input);
  });

  const customer = await getDetail(customerAccountId);
  if (!customer) throw new Error("Customer account was not found after attach.");
  const linked = result.candidate.currentLinkedCustomer?.id === customerAccountId;
  return {
    customer,
    candidate: result.candidate,
    duplicate: result.duplicate,
    linked,
    rewardsApplied: result.reward.status === "applied",
    rewardStatus: result.reward.status,
    rewardPoints: result.reward.points,
    rewardPointsAwarded: result.reward.status === "applied" ? result.reward.points : 0,
    rewardMessage: result.reward.message
  };
}
