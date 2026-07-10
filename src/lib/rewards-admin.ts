import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import type { SessionUser } from "@/types/radar";
import type {
  AdminCustomerRewardsCustomerDTO,
  AdminCustomerRewardsDetailDTO,
  AdminCustomerRewardsLedgerEntryDTO,
  AdminCustomerRewardsLedgerResponseDTO,
  AdminCustomerRewardsResponseDTO,
  AdminCustomerRewardsSummaryDTO,
  AdminCustomerProfileUpdateResultDTO,
  AdminRewardAdjustmentResultDTO
} from "@/types/radar";

type RewardAdminAdjustmentInput = {
  customerAccountId: string;
  action: "add" | "deduct";
  points: number;
  reason: string;
  note?: string;
  idempotencyKey: string;
};

type AdminCustomerProfileUpdateInput = {
  displayName: string | null;
  phone: string | null;
  status: "active" | "disabled";
  adminNote: string | null;
};

type CustomerListFilters = {
  search?: string | null;
  status?: string | null;
  sort?: string | null;
  page?: number | null;
  pageSize?: number | null;
};

type LedgerListFilters = {
  search?: string | null;
  status?: string | null;
  source?: string | null;
  page?: number | null;
  pageSize?: number | null;
};

const defaultPageSize = 25;
const maxPageSize = 100;

const customerListInclude = {
  rewardBalance: true,
  orders: {
    select: {
      id: true,
      orderNumber: true,
      total: true,
      refundedAmount: true,
      paymentStatus: true,
      status: true,
      fulfillmentStatus: true,
      isTestOrder: true,
      createdAt: true
    }
  },
  posSales: {
    select: {
      id: true,
      saleReference: true,
      grossSale: true,
      refundedAmount: true,
      refundStatus: true,
      soldAt: true
    }
  }
} satisfies Prisma.CustomerAccountInclude;

const ledgerInclude = {
  customerAccount: {
    select: {
      id: true,
      email: true,
      displayName: true
    }
  },
  order: {
    select: {
      orderNumber: true
    }
  }
} satisfies Prisma.RewardLedgerEntryInclude;

function clampPage(value: number | null | undefined) {
  if (!value || !Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

function clampPageSize(value: number | null | undefined) {
  if (!value || !Number.isFinite(value) || value < 1) return defaultPageSize;
  return Math.min(maxPageSize, Math.floor(value));
}

function maskEmail(value: string | null | undefined) {
  const email = value?.trim();
  if (!email || !email.includes("@")) return "Email not set";
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${local.length > 2 ? "***" : "*"}@${domain}`;
}

function maskPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length < 4) return value ? "Phone saved" : null;
  return `***-***-${digits.slice(-4)}`;
}

function displayNameForCustomer(customer: { displayName: string | null; email: string }) {
  return customer.displayName?.trim() || customer.email.split("@")[0] || "Customer";
}

function safeDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function paidOrderNet(order: { total: number; refundedAmount: number; paymentStatus: string; status: string; isTestOrder: boolean }) {
  if (order.isTestOrder) return 0;
  if (order.status === "canceled") return 0;
  if (!["paid", "partially_refunded", "refunded"].includes(order.paymentStatus)) return 0;
  return Math.max(0, order.total - order.refundedAmount);
}

function posSaleNet(sale: { grossSale: number; refundedAmount: number; refundStatus: string | null }) {
  if (sale.refundStatus === "canceled") return 0;
  return Math.max(0, sale.grossSale - sale.refundedAmount);
}

function latestDate(...values: Array<Date | null | undefined>) {
  const latest = values.filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0];
  return latest ?? null;
}

type CustomerWithActivity = Prisma.CustomerAccountGetPayload<{ include: typeof customerListInclude }>;

function mapCustomerListItem(customer: CustomerWithActivity): AdminCustomerRewardsCustomerDTO {
  const balance = customer.rewardBalance;
  const paidOrders = customer.orders.filter((order) => paidOrderNet(order) > 0);
  const posSales = customer.posSales.filter((sale) => posSaleNet(sale) > 0);
  const lastOrderAt = latestDate(...customer.orders.map((order) => order.createdAt));
  const lastPosAt = latestDate(...customer.posSales.map((sale) => sale.soldAt));
  const lastActivityAt = latestDate(lastOrderAt, lastPosAt, customer.lastLoginAt, customer.updatedAt);

  return {
    id: customer.id,
    displayName: displayNameForCustomer(customer),
    maskedEmail: maskEmail(customer.email),
    maskedPhone: maskPhone(customer.phone),
    status: customer.status,
    joinedAt: customer.createdAt.toISOString(),
    emailVerified: Boolean(customer.emailVerifiedAt),
    lastLoginAt: safeDate(customer.lastLoginAt),
    lastActivityAt: safeDate(lastActivityAt),
    totalOrders: paidOrders.length,
    totalSpent: paidOrders.reduce((sum, order) => sum + paidOrderNet(order), 0),
    posSales: posSales.length,
    posSpent: posSales.reduce((sum, sale) => sum + posSaleNet(sale), 0),
    availablePoints: balance?.availablePoints ?? 0,
    pendingPoints: balance?.pendingPoints ?? 0,
    lifetimeEarnedPoints: balance?.lifetimeEarnedPoints ?? 0
  };
}

function normalizedStatus(status: string | null | undefined, points: number, type: string) {
  if (status) return status;
  if (points < 0 || type === "reverse") return "reversed";
  if (points > 0) return "available";
  return "canceled";
}

function parseMetadata(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

type LedgerWithCustomer = Prisma.RewardLedgerEntryGetPayload<{ include: typeof ledgerInclude }>;

function mapLedgerEntry(entry: LedgerWithCustomer): AdminCustomerRewardsLedgerEntryDTO {
  const metadata = parseMetadata(entry.metadataJson);
  const saleReference = typeof metadata.saleReference === "string" ? metadata.saleReference : null;
  const reference = entry.order?.orderNumber ?? saleReference ?? null;
  return {
    id: entry.id,
    customerAccountId: entry.customerAccountId,
    customerName: displayNameForCustomer(entry.customerAccount),
    customerMaskedEmail: maskEmail(entry.customerAccount.email),
    points: entry.points,
    type: entry.type,
    status: normalizedStatus(entry.status, entry.points, entry.type),
    source: entry.source ?? "legacy",
    reason: entry.reason,
    reference,
    hasAdminNote: typeof metadata.adminNote === "string" && metadata.adminNote.trim().length > 0,
    createdBy: metadata.createdBy === "admin" ? "Admin" : null,
    availableAt: safeDate(entry.availableAt),
    settledAt: safeDate(entry.settledAt),
    createdAt: entry.createdAt.toISOString()
  };
}

function buildCustomerWhere(filters: CustomerListFilters): Prisma.CustomerAccountWhereInput {
  const where: Prisma.CustomerAccountWhereInput = {};
  if (filters.status && filters.status !== "all") where.status = filters.status;
  return where;
}

function normalizedSearch(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function phoneDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

function customerMatchesSearch(customer: CustomerWithActivity, rawSearch: string | null | undefined) {
  const search = normalizedSearch(rawSearch);
  if (!search) return true;
  const searchDigits = phoneDigits(search);
  const haystacks = [
    customer.email,
    customer.normalizedEmail,
    customer.displayName,
    displayNameForCustomer(customer)
  ].map(normalizedSearch);
  if (haystacks.some((value) => value.includes(search))) return true;
  const tokens = search.split(/\s+/).filter(Boolean);
  const displayName = normalizedSearch(customer.displayName);
  if (tokens.length > 1 && tokens.every((token) => displayName.includes(token))) return true;
  return Boolean(searchDigits && phoneDigits(customer.phone).includes(searchDigits));
}

function sortCustomers(customers: AdminCustomerRewardsCustomerDTO[], sort: string | null | undefined) {
  const next = [...customers];
  if (sort === "points") return next.sort((a, b) => b.lifetimeEarnedPoints - a.lifetimeEarnedPoints);
  if (sort === "spent") return next.sort((a, b) => b.totalSpent + b.posSpent - (a.totalSpent + a.posSpent));
  if (sort === "name") return next.sort((a, b) => a.displayName.localeCompare(b.displayName));
  if (sort === "activity") {
    return next.sort((a, b) => new Date(b.lastActivityAt ?? b.joinedAt).getTime() - new Date(a.lastActivityAt ?? a.joinedAt).getTime());
  }
  return next.sort((a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime());
}

export async function customerRewardsAdminSummary(): Promise<AdminCustomerRewardsSummaryDTO> {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [totalCustomers, activeCustomers, newCustomersThisMonth, balances, reversals, topBalance] = await Promise.all([
    prisma.customerAccount.count(),
    prisma.customerAccount.count({ where: { status: "active" } }),
    prisma.customerAccount.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.rewardBalance.findMany({
      select: {
        availablePoints: true,
        pendingPoints: true,
        lifetimeEarnedPoints: true
      }
    }),
    prisma.rewardLedgerEntry.findMany({
      where: { points: { lt: 0 } },
      select: { points: true }
    }),
    prisma.rewardBalance.findFirst({
      orderBy: { lifetimeEarnedPoints: "desc" },
      include: {
        customerAccount: {
          select: {
            id: true,
            email: true,
            displayName: true
          }
        }
      }
    })
  ]);

  const config = customerAccountFeatureConfig();
  return {
    totalCustomers,
    activeCustomers,
    newCustomersThisMonth,
    totalAvailablePoints: balances.reduce((sum, balance) => sum + balance.availablePoints, 0),
    totalPendingPoints: balances.reduce((sum, balance) => sum + balance.pendingPoints, 0),
    lifetimeIssuedPoints: balances.reduce((sum, balance) => sum + balance.lifetimeEarnedPoints, 0),
    totalReversedPoints: Math.abs(reversals.reduce((sum, entry) => sum + entry.points, 0)),
    adjustmentsEnabled:
      config.customerAccountsEnabled &&
      config.customerRewardsEnabled &&
      config.customerRewardAdminAdjustmentsEnabled,
    redemptionEnabled: false,
    topCustomer: topBalance && topBalance.lifetimeEarnedPoints > 0
      ? {
          customerAccountId: topBalance.customerAccountId,
          displayName: displayNameForCustomer(topBalance.customerAccount),
          maskedEmail: maskEmail(topBalance.customerAccount.email),
          lifetimeEarnedPoints: topBalance.lifetimeEarnedPoints
        }
      : null
  };
}

export async function listAdminCustomerRewards(filters: CustomerListFilters = {}): Promise<AdminCustomerRewardsResponseDTO> {
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize);
  const where = buildCustomerWhere(filters);
  const [summary, rows] = await Promise.all([
    customerRewardsAdminSummary(),
    prisma.customerAccount.findMany({
      where,
      include: customerListInclude
    })
  ]);

  const customers = sortCustomers(rows.filter((customer) => customerMatchesSearch(customer, filters.search)).map(mapCustomerListItem), filters.sort);
  const total = customers.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    summary,
    customers: customers.slice(start, start + pageSize),
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages
    }
  };
}

function buildLedgerWhere(filters: LedgerListFilters): Prisma.RewardLedgerEntryWhereInput {
  const where: Prisma.RewardLedgerEntryWhereInput = {};
  if (filters.status && filters.status !== "all") where.status = filters.status;
  if (filters.source && filters.source !== "all") where.source = filters.source;
  const search = filters.search?.trim();
  if (search) {
    where.OR = [
      { reason: { contains: search } },
      { source: { contains: search } },
      { customerAccount: { email: { contains: search } } },
      { customerAccount: { displayName: { contains: search } } },
      { order: { orderNumber: { contains: search } } }
    ];
  }
  return where;
}

export async function listAdminRewardLedger(filters: LedgerListFilters = {}): Promise<AdminCustomerRewardsLedgerResponseDTO> {
  const page = clampPage(filters.page);
  const pageSize = clampPageSize(filters.pageSize);
  const where = buildLedgerWhere(filters);
  const [total, ledger] = await Promise.all([
    prisma.rewardLedgerEntry.count({ where }),
    prisma.rewardLedgerEntry.findMany({
      where,
      include: ledgerInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return {
    ledger: ledger.map(mapLedgerEntry),
    pagination: {
      page,
      pageSize,
      total,
      totalPages
    }
  };
}

export async function getAdminCustomerRewardDetail(customerAccountId: string): Promise<AdminCustomerRewardsDetailDTO | null> {
  const customer = await prisma.customerAccount.findUnique({
    where: { id: customerAccountId },
    include: {
      ...customerListInclude,
      savedAddresses: {
        select: {
          city: true,
          state: true,
          zip: true,
          isDefault: true
        },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }]
      },
      rewardLedgerEntries: {
        include: ledgerInclude,
        orderBy: { createdAt: "desc" },
        take: 8
      }
    }
  });
  if (!customer) return null;

  const base = mapCustomerListItem(customer);
  const defaultAddress = customer.savedAddresses[0];
  return {
    ...base,
    savedAddressCount: customer.savedAddresses.length,
    defaultAddressSummary: defaultAddress
      ? [defaultAddress.city, defaultAddress.state, defaultAddress.zip].filter(Boolean).join(", ")
      : null,
    profile: {
      displayName: customer.displayName?.trim() || "",
      phone: customer.phone,
      status: customer.status,
      adminNote: customer.adminNote
    },
    recentOrders: customer.orders
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 8)
      .map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        total: order.total,
        refundedAmount: order.refundedAmount,
        createdAt: order.createdAt.toISOString()
      })),
    recentPosSales: customer.posSales
      .slice()
      .sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime())
      .slice(0, 8)
      .map((sale) => ({
        id: sale.id,
        saleReference: sale.saleReference,
        total: posSaleNet(sale),
        refundStatus: sale.refundStatus,
        soldAt: sale.soldAt.toISOString()
      })),
    recentLedgerEntries: customer.rewardLedgerEntries.map(mapLedgerEntry)
  };
}

export async function updateAdminCustomerProfile(
  customerAccountId: string,
  input: AdminCustomerProfileUpdateInput
): Promise<AdminCustomerProfileUpdateResultDTO> {
  const existing = await prisma.customerAccount.findUnique({
    where: { id: customerAccountId },
    select: { id: true }
  });
  if (!existing) throw new Error("Customer account was not found.");

  await prisma.customerAccount.update({
    where: { id: customerAccountId },
    data: {
      displayName: input.displayName,
      phone: input.phone,
      status: input.status,
      adminNote: input.adminNote
    }
  });

  const customer = await getAdminCustomerRewardDetail(customerAccountId);
  if (!customer) throw new Error("Customer account was not found after update.");
  return { customer };
}

export async function createAdminRewardAdjustment(
  adminUser: SessionUser,
  input: RewardAdminAdjustmentInput
): Promise<AdminRewardAdjustmentResultDTO> {
  const config = customerAccountFeatureConfig();
  const adjustmentsEnabled =
    config.customerAccountsEnabled &&
    config.customerRewardsEnabled &&
    config.customerRewardAdminAdjustmentsEnabled;
  if (!adjustmentsEnabled) {
    throw new Error("Admin reward adjustments are disabled.");
  }

  const idempotencyKey = `rewards:admin:${input.action}:${input.idempotencyKey}`;
  const now = new Date();
  const ledger = await prisma.$transaction(async (tx) => {
    const existing = await tx.rewardLedgerEntry.findUnique({
      where: { idempotencyKey },
      include: ledgerInclude
    });
    if (existing) return { entry: existing, duplicate: true };

    const customer = await tx.customerAccount.findUnique({
      where: { id: input.customerAccountId },
      select: { id: true }
    });
    if (!customer) throw new Error("Customer account was not found.");

    const balance = await tx.rewardBalance.findUnique({ where: { customerAccountId: input.customerAccountId } });
    if (input.action === "deduct" && (balance?.availablePoints ?? 0) < input.points) {
      throw new Error("Cannot deduct more than the customer's available points.");
    }

    const points = input.action === "add" ? input.points : -input.points;
    const entry = await tx.rewardLedgerEntry.create({
      data: {
        customerAccountId: input.customerAccountId,
        idempotencyKey,
        points,
        type: "adjustment",
        reason: input.reason,
        status: "available",
        source: "admin_adjustment",
        availableAt: now,
        settledAt: now,
        metadataJson: JSON.stringify({
          createdBy: "admin",
          adminUserId: adminUser.id,
          action: input.action,
          adminNote: input.note ?? null
        })
      },
      include: ledgerInclude
    });

    if (input.action === "add") {
      await tx.rewardBalance.upsert({
        where: { customerAccountId: input.customerAccountId },
        create: {
          customerAccountId: input.customerAccountId,
          availablePoints: input.points,
          pendingPoints: 0,
          lifetimeEarnedPoints: input.points
        },
        update: {
          availablePoints: { increment: input.points },
          lifetimeEarnedPoints: { increment: input.points }
        }
      });
    } else {
      await tx.rewardBalance.update({
        where: { customerAccountId: input.customerAccountId },
        data: {
          availablePoints: { decrement: input.points }
        }
      });
    }

    return { entry, duplicate: false };
  });

  const detail = await getAdminCustomerRewardDetail(input.customerAccountId);
  if (!detail) throw new Error("Customer account was not found after adjustment.");
  return {
    adjustment: mapLedgerEntry(ledger.entry),
    customer: detail,
    duplicate: ledger.duplicate
  };
}
