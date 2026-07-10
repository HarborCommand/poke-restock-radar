import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rewardEligibleSubtotalCents, rewardPointsForEligibleSubtotalCents } from "@/lib/customer-rewards";
import { normalizeCustomerAccountEmail } from "@/lib/customer-account-auth";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import type {
  AdminCustomerAttachOrderCandidateDTO,
  AdminCustomerAttachOrderResultDTO,
  AdminCustomerAttachOrderSearchResponseDTO,
  AdminCustomerRewardsDetailDTO,
  SessionUser
} from "@/types/radar";

type AttachType = "storefront_order" | "pos_sale";

type AttachInput = {
  type: AttachType;
  orderId?: string;
  saleReference?: string;
  reason: string;
  note?: string;
  confirmEmailMismatch: boolean;
  applyRewards: boolean;
};

type BackfillRewardResult = {
  status: "not_requested" | "disabled" | "already_awarded" | "not_eligible" | "awarded";
  points: number;
};

type CustomerLinkSource = "email_match" | "admin_manual" | "pos_match";

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
      lineTotal: true
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

function orderRewardCandidate(order: CandidateOrder, customerEmail: string, emailMatchesCustomer: boolean) {
  const alreadyAwarded = hasPositiveRewardLedger(order);
  const refunded = order.refundedAmount > 0 || order.status === "refunded" || order.paymentStatus === "refunded" || order.paymentStatus === "partially_refunded";
  const eligibleSubtotalCents = rewardEligibleSubtotalCents({
    subtotal: order.subtotal,
    items: order.items.map((item) => ({ lineTotal: item.lineTotal }))
  });
  const points = rewardPointsForEligibleSubtotalCents(eligibleSubtotalCents);
  const ineligibleReason =
    order.isTestOrder ? "Test/smoke orders do not earn rewards."
      : order.status === "canceled" || refunded ? "Canceled or refunded orders do not earn rewards."
      : order.paymentStatus !== "paid" ? "Only paid orders can earn rewards."
      : alreadyAwarded ? "Rewards were already recorded for this order."
      : points <= 0 ? "No eligible product subtotal points are available."
      : !emailMatchesCustomer ? "Order email does not match this customer; rewards stay off unless manually reviewed."
      : null;
  return {
    eligible: !ineligibleReason,
    alreadyAwarded,
    defaultApply: !ineligibleReason && emailMatchesCustomer && normalizeEmail(order.customerEmail) === customerEmail,
    disabledReason: ineligibleReason
  };
}

function mapOrderCandidate(order: CandidateOrder, customer: { id: string; email: string }): AdminCustomerAttachOrderCandidateDTO {
  const customerEmail = normalizeEmail(customer.email) ?? customer.email.toLowerCase();
  const orderEmail = normalizeEmail(order.customerEmail);
  const emailMatchesCustomer = Boolean(orderEmail && orderEmail === customerEmail);
  return {
    id: order.id,
    type: "storefront_order",
    reference: order.orderNumber,
    date: order.createdAt.toISOString(),
    source: orderSource(order),
    maskedCustomerEmail: maskEmail(order.customerEmail),
    maskedCustomerPhone: maskPhone(order.customerPhone),
    total: order.total,
    status: orderStatusLabel(order),
    currentLinkedCustomer: customerSummary(order.customerAccount),
    emailMatchesCustomer,
    rewards: orderRewardCandidate(order, customerEmail, emailMatchesCustomer)
  };
}

function saleStatusLabel(sales: CandidateSale[]) {
  if (sales.some((sale) => sale.refundStatus === "canceled")) return "Canceled";
  if (sales.every((sale) => sale.refundStatus === "refunded")) return "Refunded";
  if (sales.some((sale) => sale.refundedAmount > 0 || sale.refundStatus === "partially_refunded")) return "Partially refunded";
  return "Completed";
}

function saleAlreadyAwarded(saleReference: string, ledger: Array<{ idempotencyKey: string | null; points: number; source: string | null; metadataJson: string | null }>) {
  return ledger.some((entry) => {
    if (entry.points <= 0) return false;
    if (entry.idempotencyKey === `rewards:pos:earn:${saleReference}` || entry.idempotencyKey === `rewards:backfill:pos:${saleReference}`) return true;
    if (entry.source === "pos" || entry.source === "admin_pos_link_backfill") {
      return typeof entry.metadataJson === "string" && entry.metadataJson.includes(`"saleReference":"${saleReference}"`);
    }
    return false;
  });
}

function saleRewardCandidate(sales: CandidateSale[], alreadyAwarded: boolean, emailMatchesCustomer: boolean) {
  const refunded = sales.some((sale) => sale.refundStatus || sale.refundedAmount > 0);
  const eligibleSubtotalCents = sales.reduce((sum, sale) => sum + Math.max(0, Math.round(sale.grossSale * 100)), 0);
  const points = rewardPointsForEligibleSubtotalCents(eligibleSubtotalCents);
  const ineligibleReason =
    refunded ? "Refunded or canceled POS sales do not earn backfill rewards."
      : alreadyAwarded ? "Rewards were already recorded for this POS sale."
      : points <= 0 ? "No eligible POS subtotal points are available."
      : !emailMatchesCustomer ? "POS customer email does not match this customer; rewards stay off unless manually reviewed."
      : null;
  return {
    eligible: !ineligibleReason,
    alreadyAwarded,
    defaultApply: !ineligibleReason && emailMatchesCustomer,
    disabledReason: ineligibleReason
  };
}

async function mapSaleCandidates(
  groupedSales: CandidateSale[][],
  customer: { id: string; email: string },
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<AdminCustomerAttachOrderCandidateDTO[]> {
  const refs = groupedSales.map((sales) => sales[0]?.saleReference).filter((value): value is string => Boolean(value));
  const ledger = refs.length
    ? await client.rewardLedgerEntry.findMany({
        where: {
          OR: [
            { idempotencyKey: { in: refs.flatMap((ref) => [`rewards:pos:earn:${ref}`, `rewards:backfill:pos:${ref}`]) } },
            { source: { in: ["pos", "admin_pos_link_backfill"] } }
          ]
        },
        select: { idempotencyKey: true, points: true, source: true, metadataJson: true }
      })
    : [];
  const customerEmail = normalizeEmail(customer.email) ?? customer.email.toLowerCase();
  return groupedSales.map((sales) => {
    const first = sales[0]!;
    const saleReference = first.saleReference!;
    const saleEmail = normalizeEmail(first.customerEmail);
    const emailMatchesCustomer = Boolean(saleEmail && saleEmail === customerEmail);
    const alreadyAwarded = saleAlreadyAwarded(saleReference, ledger);
    const total = sales.reduce((sum, sale) => sum + Math.max(0, sale.grossSale - sale.refundedAmount), 0);
    return {
      id: saleReference,
      type: "pos_sale",
      reference: saleReference,
      date: first.soldAt.toISOString(),
      source: "pos",
      maskedCustomerEmail: maskEmail(first.customerEmail),
      maskedCustomerPhone: maskPhone(first.customerPhone),
      total,
      status: saleStatusLabel(sales),
      currentLinkedCustomer: customerSummary(first.customerAccount),
      emailMatchesCustomer,
      rewards: saleRewardCandidate(sales, alreadyAwarded, emailMatchesCustomer)
    };
  });
}

function groupSalesByReference(sales: CandidateSale[]) {
  const groups = new Map<string, CandidateSale[]>();
  for (const sale of sales) {
    const reference = sale.saleReference?.trim();
    if (!reference) continue;
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
  const saleWhere: Prisma.InventorySaleWhereInput = {
    saleReference: { not: null },
    ...(search
      ? {
          OR: [
            { saleReference: { contains: search } },
            { customerEmail: { contains: search } },
            { customerPhone: { contains: search } },
            { inventoryItem: { is: { itemName: { contains: search } } } }
          ]
        }
      : {})
  };

  const [orders, saleRefs] = await Promise.all([
    prisma.storefrontOrder.findMany({
      where: orderWhere,
      include: candidateOrderInclude,
      orderBy: { createdAt: "desc" },
      take: candidateLimit
    }),
    prisma.inventorySale.findMany({
      where: saleWhere,
      select: { saleReference: true, soldAt: true },
      orderBy: { soldAt: "desc" },
      take: candidateLimit * 3
    })
  ]);

  const references = [...new Set(saleRefs.map((sale) => sale.saleReference).filter((value): value is string => Boolean(value)))].slice(0, candidateLimit);
  const sales = references.length
    ? await prisma.inventorySale.findMany({
        where: { saleReference: { in: references } },
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

function linkSourceFor(emailMatchesCustomer: boolean, existingPosMatch = false): CustomerLinkSource {
  if (existingPosMatch) return "pos_match";
  return emailMatchesCustomer ? "email_match" : "admin_manual";
}

function assertManualMismatchConfirmation(input: AttachInput, emailMatchesCustomer: boolean, label: string) {
  if (emailMatchesCustomer) return;
  if (!input.confirmEmailMismatch) throw new Error(`${label} email does not match this customer. Confirm the manual override to attach anyway.`);
  if (!input.note?.trim()) throw new Error("Manual mismatch overrides require an internal note.");
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
    adminUser: SessionUser;
    reason: string;
  }
) {
  if (!input.applyRewards) return { status: "not_requested" as const, points: 0 };
  if (!rewardsFeatureEnabledForBackfill()) return { status: "disabled" as const, points: 0 };
  if (hasPositiveRewardLedger(input.order)) return { status: "already_awarded" as const, points: 0 };
  const candidate = orderRewardCandidate(input.order, normalizeEmail(input.order.customerEmail) ?? "", true);
  if (!candidate.eligible) return { status: "not_eligible" as const, points: 0 };

  const eligibleSubtotalCents = rewardEligibleSubtotalCents({
    subtotal: input.order.subtotal,
    items: input.order.items.map((item) => ({ lineTotal: item.lineTotal }))
  });
  const points = rewardPointsForEligibleSubtotalCents(eligibleSubtotalCents);
  if (points <= 0) return { status: "not_eligible" as const, points: 0 };

  const idempotencyKey = `rewards:backfill:order:${input.order.id}`;
  const existing = await tx.rewardLedgerEntry.findUnique({ where: { idempotencyKey } });
  if (existing) return { status: "already_awarded" as const, points: Math.max(0, existing.points) };

  const now = new Date();
  const available = input.order.fulfillmentStatus === "shipped" || input.order.fulfillmentStatus === "picked_up";
  await tx.rewardLedgerEntry.create({
    data: {
      customerAccountId: input.customerAccountId,
      orderId: input.order.id,
      idempotencyKey,
      points,
      type: "earn",
      reason: "Admin-linked past order eligible item subtotal",
      status: available ? "available" : "pending",
      source: "admin_order_link_backfill",
      availableAt: now,
      settledAt: available ? now : null,
      eligibleSubtotalCents,
      metadataJson: JSON.stringify({
        createdBy: "admin",
        adminUserId: input.adminUser.id,
        orderNumber: input.order.orderNumber,
        reason: input.reason,
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
  return { status: "awarded" as const, points };
}

async function awardPosBackfillIfRequested(
  tx: Prisma.TransactionClient,
  input: {
    sales: CandidateSale[];
    customerAccountId: string;
    saleReference: string;
    applyRewards: boolean;
    adminUser: SessionUser;
    reason: string;
  }
) {
  if (!input.applyRewards) return { status: "not_requested" as const, points: 0 };
  if (!rewardsFeatureEnabledForBackfill()) return { status: "disabled" as const, points: 0 };
  const existing = await tx.rewardLedgerEntry.findMany({
    where: {
      OR: [
        { idempotencyKey: { in: [`rewards:pos:earn:${input.saleReference}`, `rewards:backfill:pos:${input.saleReference}`] } },
        { source: { in: ["pos", "admin_pos_link_backfill"] }, metadataJson: { contains: input.saleReference } }
      ]
    },
    select: { idempotencyKey: true, points: true, source: true, metadataJson: true }
  });
  if (saleAlreadyAwarded(input.saleReference, existing)) return { status: "already_awarded" as const, points: 0 };
  const refunded = input.sales.some((sale) => sale.refundStatus || sale.refundedAmount > 0);
  if (refunded) return { status: "not_eligible" as const, points: 0 };
  const eligibleSubtotalCents = input.sales.reduce((sum, sale) => sum + Math.max(0, Math.round(sale.grossSale * 100)), 0);
  const points = rewardPointsForEligibleSubtotalCents(eligibleSubtotalCents);
  if (points <= 0) return { status: "not_eligible" as const, points: 0 };

  const now = new Date();
  await tx.rewardLedgerEntry.create({
    data: {
      customerAccountId: input.customerAccountId,
      orderId: null,
      idempotencyKey: `rewards:backfill:pos:${input.saleReference}`,
      points,
      type: "earn",
      reason: "Admin-linked POS sale eligible subtotal",
      status: "available",
      source: "admin_pos_link_backfill",
      availableAt: now,
      settledAt: now,
      eligibleSubtotalCents,
      metadataJson: JSON.stringify({
        createdBy: "admin",
        adminUserId: input.adminUser.id,
        saleReference: input.saleReference,
        reason: input.reason,
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
  return { status: "awarded" as const, points };
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
  const customerEmail = normalizeEmail(customer.email) ?? customer.email.toLowerCase();
  const emailMatchesCustomer = Boolean(normalizeEmail(order.customerEmail) && normalizeEmail(order.customerEmail) === customerEmail);
  assertManualMismatchConfirmation(input, emailMatchesCustomer, "Order");

  let reward: BackfillRewardResult = { status: "not_requested", points: 0 };
  if (!duplicate) {
    const source = linkSourceFor(emailMatchesCustomer);
    await tx.storefrontOrder.update({
      where: { id: order.id },
      data: {
        customerAccountId: customer.id,
        customerLinkSource: source,
        customerLinkedAt: new Date(),
        customerLinkedByUserId: adminUser.id,
        customerLinkReason: input.reason,
        customerLinkNote: input.note ?? null
      }
    });
    if (order.customerId && emailMatchesCustomer) {
      await tx.storefrontCustomer.updateMany({
        where: {
          id: order.customerId,
          OR: [{ customerAccountId: null }, { customerAccountId: customer.id }]
        },
        data: { customerAccountId: customer.id }
      });
    }
    reward = await awardOrderBackfillIfRequested(tx, {
      order,
      customerAccountId: customer.id,
      applyRewards: input.applyRewards && emailMatchesCustomer,
      adminUser,
      reason: input.reason
    });
    await tx.auditLog.create({
      data: {
        userId: adminUser.id,
        actorEmail: adminUser.email,
        action: "customer.order.attached",
        entityType: "STOREFRONT_ORDER",
        entityId: order.id,
        summary: `${adminUser.email} linked order ${order.orderNumber} to a customer account.`,
        metadata: JSON.stringify({
          customerAccountId: customer.id,
          orderNumber: order.orderNumber,
          linkSource: source,
          reason: input.reason,
          hasInternalNote: Boolean(input.note),
          rewardsApplied: reward.status === "awarded"
        })
      }
    });
  }

  return { duplicate, reward, candidate: mapOrderCandidate({ ...order, customerAccountId: customer.id, customerAccount: customer }, customer) };
}

async function attachPosSale(
  tx: Prisma.TransactionClient,
  customer: Awaited<ReturnType<typeof loadAttachCustomer>>,
  adminUser: SessionUser,
  input: AttachInput
) {
  const saleReference = input.saleReference?.trim();
  if (!saleReference) throw new Error("Sale reference is required.");
  const sales = await tx.inventorySale.findMany({
    where: { saleReference },
    include: candidateSaleInclude,
    orderBy: { soldAt: "desc" }
  });
  if (!sales.length) throw new Error("POS sale was not found.");
  const otherLinked = sales.find((sale) => sale.customerAccountId && sale.customerAccountId !== customer.id);
  if (otherLinked) throw new Error("This POS sale is already linked to another customer.");
  const duplicate = sales.every((sale) => sale.customerAccountId === customer.id);
  const customerEmail = normalizeEmail(customer.email) ?? customer.email.toLowerCase();
  const saleEmail = normalizeEmail(sales[0]?.customerEmail);
  const emailMatchesCustomer = Boolean(saleEmail && saleEmail === customerEmail);
  assertManualMismatchConfirmation(input, emailMatchesCustomer, "POS sale");

  let reward: BackfillRewardResult = { status: "not_requested", points: 0 };
  if (!duplicate) {
    const source = linkSourceFor(emailMatchesCustomer, sales.some((sale) => sale.customerMatchMethod === "email"));
    await tx.inventorySale.updateMany({
      where: { saleReference },
      data: {
        customerAccountId: customer.id,
        customerLinkSource: source,
        customerLinkedAt: new Date(),
        customerLinkedByUserId: adminUser.id,
        customerLinkReason: input.reason,
        customerLinkNote: input.note ?? null,
        customerEmail: emailMatchesCustomer ? customer.email : undefined,
        customerMatchMethod: emailMatchesCustomer ? "email" : "admin_manual",
        rewardsEligible: input.applyRewards && emailMatchesCustomer
      }
    });
    reward = await awardPosBackfillIfRequested(tx, {
      sales,
      customerAccountId: customer.id,
      saleReference,
      applyRewards: input.applyRewards && emailMatchesCustomer,
      adminUser,
      reason: input.reason
    });
    await tx.auditLog.create({
      data: {
        userId: adminUser.id,
        actorEmail: adminUser.email,
        action: "customer.pos_sale.attached",
        entityType: "INVENTORY_SALE",
        entityId: saleReference,
        summary: `${adminUser.email} linked POS sale ${saleReference} to a customer account.`,
        metadata: JSON.stringify({
          customerAccountId: customer.id,
          saleReference,
          linkSource: source,
          reason: input.reason,
          hasInternalNote: Boolean(input.note),
          rewardsApplied: reward.status === "awarded"
        })
      }
    });
  }

  const refreshed = await tx.inventorySale.findMany({
    where: { saleReference },
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
  return {
    customer,
    candidate: result.candidate,
    duplicate: result.duplicate,
    rewardsApplied: result.reward.status === "awarded",
    rewardStatus: result.reward.status,
    rewardPoints: result.reward.points
  };
}
