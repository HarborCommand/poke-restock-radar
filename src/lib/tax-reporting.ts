import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/types/radar";

export type TaxReportFilters = {
  from?: Date;
  to?: Date;
  channel?: "online" | "pos";
  country?: string;
  state?: string;
  county?: string;
  status?: string;
  exempt?: boolean;
  refunded?: boolean;
  page: number;
  pageSize: number;
};

type TaxReportRow = {
  channel: "online" | "pos";
  reference: string;
  occurredAt: string;
  jurisdiction: string;
  status: string;
  exempt: boolean;
  subtotalCents: number | null;
  discountCents: number | null;
  taxableSubtotalCents: number | null;
  taxCents: number | null;
  stateTaxCents: number | null;
  countySurtaxCents: number | null;
  totalCents: number | null;
  refundedTaxCents: number | null;
};

function dateRange(from?: Date, to?: Date) {
  return from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
}

export async function buildTaxReport(currentUser: SessionUser, filters: TaxReportFilters) {
  const common = {
    ...(filters.country ? { taxJurisdictionCountry: filters.country } : {}),
    ...(filters.state ? { taxJurisdictionState: filters.state } : {}),
    ...(filters.county ? { taxJurisdictionCounty: filters.county } : {}),
    ...(filters.status ? { taxStatus: filters.status } : {}),
    ...(filters.refunded !== undefined ? { refundedTaxCents: filters.refunded ? { gt: 0 } : { equals: 0 } } : {})
  };
  const onlineWhere: Prisma.StorefrontOrderWhereInput = {
    userId: currentUser.id,
    ...common,
    ...(filters.exempt !== undefined ? { taxStatus: filters.exempt ? "exempt" : { not: "exempt" } } : {}),
    ...(dateRange(filters.from, filters.to) ? { createdAt: dateRange(filters.from, filters.to) } : {})
  };
  const posWhere: Prisma.InventorySaleWhereInput = {
    userId: currentUser.id,
    platform: "pos",
    ...common,
    ...(filters.exempt !== undefined ? { taxExempt: filters.exempt } : {}),
    ...(dateRange(filters.from, filters.to) ? { soldAt: dateRange(filters.from, filters.to) } : {})
  };
  const includeOnline = filters.channel !== "pos";
  const includePos = filters.channel !== "online";
  const page = Number.isFinite(filters.page) ? Math.max(1, Math.min(100, Math.floor(filters.page))) : 1;
  const pageSize = Number.isFinite(filters.pageSize) ? Math.max(1, Math.min(200, Math.floor(filters.pageSize))) : 100;
  const scanTake = page * pageSize;

  const [onlineRows, posRows, onlineTotals, posTotals, onlineCount, posCount, posTransactions, onlineExempt, posExempt] = await Promise.all([
    includeOnline ? prisma.storefrontOrder.findMany({
      where: onlineWhere,
      orderBy: { createdAt: "desc" },
      take: scanTake,
      select: {
        orderNumber: true, createdAt: true, taxJurisdictionCountry: true, taxJurisdictionState: true, taxJurisdictionCounty: true,
        taxStatus: true, taxExemptReason: true, subtotalCents: true, discountCents: true, taxableSubtotalCents: true,
        taxCents: true, totalCents: true, refundedTaxCents: true, shippingCents: true
      }
    }) : Promise.resolve([]),
    includePos ? prisma.inventorySale.findMany({
      where: posWhere,
      orderBy: { soldAt: "desc" },
      take: scanTake,
      select: {
        id: true, saleReference: true, soldAt: true, taxJurisdictionCountry: true, taxJurisdictionState: true, taxJurisdictionCounty: true,
        taxStatus: true, taxExempt: true, subtotalCents: true, discountCents: true, taxableSubtotalCents: true,
        taxCents: true, stateTaxCents: true, countySurtaxCents: true, totalCents: true, refundedTaxCents: true
      }
    }) : Promise.resolve([]),
    includeOnline ? prisma.storefrontOrder.aggregate({ where: onlineWhere, _sum: { subtotalCents: true, discountCents: true, shippingCents: true, taxableSubtotalCents: true, taxCents: true, totalCents: true, refundedTaxCents: true } }) : Promise.resolve(null),
    includePos ? prisma.inventorySale.aggregate({ where: posWhere, _sum: { subtotalCents: true, discountCents: true, taxableSubtotalCents: true, stateTaxCents: true, countySurtaxCents: true, taxCents: true, totalCents: true, refundedTaxCents: true } }) : Promise.resolve(null),
    includeOnline ? prisma.storefrontOrder.count({ where: onlineWhere }) : Promise.resolve(0),
    includePos ? prisma.inventorySale.count({ where: posWhere }) : Promise.resolve(0),
    includePos ? prisma.inventorySale.groupBy({ by: ["saleReference"], where: posWhere, _count: { _all: true } }) : Promise.resolve([]),
    includeOnline ? prisma.storefrontOrder.aggregate({ where: { ...onlineWhere, taxStatus: "exempt" }, _sum: { taxableSubtotalCents: true } }) : Promise.resolve(null),
    includePos ? prisma.inventorySale.aggregate({ where: { ...posWhere, taxExempt: true }, _sum: { taxableSubtotalCents: true } }) : Promise.resolve(null)
  ]);

  const rows: TaxReportRow[] = [
    ...onlineRows.map((row): TaxReportRow => ({
      channel: "online", reference: row.orderNumber, occurredAt: row.createdAt.toISOString(),
      jurisdiction: [row.taxJurisdictionCountry, row.taxJurisdictionState, row.taxJurisdictionCounty].filter(Boolean).join(" / ") || "Not recorded",
      status: row.taxStatus ?? "not_recorded", exempt: Boolean(row.taxExemptReason), subtotalCents: row.subtotalCents,
      discountCents: row.discountCents, taxableSubtotalCents: row.taxableSubtotalCents, taxCents: row.taxCents,
      stateTaxCents: null, countySurtaxCents: null, totalCents: row.totalCents, refundedTaxCents: row.refundedTaxCents
    })),
    ...posRows.map((row): TaxReportRow => ({
      channel: "pos", reference: row.saleReference ?? row.id, occurredAt: row.soldAt.toISOString(),
      jurisdiction: [row.taxJurisdictionCountry, row.taxJurisdictionState, row.taxJurisdictionCounty].filter(Boolean).join(" / ") || "Not recorded",
      status: row.taxStatus ?? "not_recorded", exempt: Boolean(row.taxExempt), subtotalCents: row.subtotalCents,
      discountCents: row.discountCents, taxableSubtotalCents: row.taxableSubtotalCents, taxCents: row.taxCents,
      stateTaxCents: row.stateTaxCents, countySurtaxCents: row.countySurtaxCents, totalCents: row.totalCents, refundedTaxCents: row.refundedTaxCents
    }))
  ].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  const offset = (page - 1) * pageSize;
  const sum = (field: "subtotalCents" | "discountCents" | "taxableSubtotalCents" | "taxCents" | "totalCents" | "refundedTaxCents") =>
    (onlineTotals?._sum[field] ?? 0) + (posTotals?._sum[field] ?? 0);
  const taxCents = sum("taxCents");
  const refundedTaxCents = sum("refundedTaxCents");
  return {
    generatedAt: new Date().toISOString(),
    disclaimer: "Accounting support report. Confirm filing treatment with your tax professional or Florida Department of Revenue account.",
    filters: { ...filters, from: filters.from?.toISOString(), to: filters.to?.toISOString(), page, pageSize },
    summary: {
      recordCount: onlineCount + posCount,
      transactionCount: onlineCount + posTransactions.length,
      subtotalCents: sum("subtotalCents"), discountCents: sum("discountCents"), taxableSubtotalCents: sum("taxableSubtotalCents"),
      grossSalesExcludingTaxCents: Math.max(0, sum("totalCents") - taxCents),
      exemptSalesCents: (onlineExempt?._sum.taxableSubtotalCents ?? 0) + (posExempt?._sum.taxableSubtotalCents ?? 0),
      nonTaxableSalesCents: Math.max(0, sum("subtotalCents") - sum("discountCents") - sum("taxableSubtotalCents")),
      shippingCents: onlineTotals?._sum.shippingCents ?? 0,
      stateTaxCents: posTotals?._sum.stateTaxCents ?? 0,
      countySurtaxCents: posTotals?._sum.countySurtaxCents ?? 0,
      taxCents, totalCents: sum("totalCents"), refundedTaxCents, netTaxCents: Math.max(0, taxCents - refundedTaxCents)
    },
    pagination: { page, pageSize, total: onlineCount + posCount, pageCount: Math.ceil((onlineCount + posCount) / pageSize) },
    rows: rows.slice(offset, offset + pageSize)
  };
}

function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function taxReportCsv(report: Awaited<ReturnType<typeof buildTaxReport>>) {
  const columns = ["channel", "reference", "occurredAt", "jurisdiction", "status", "exempt", "subtotalCents", "discountCents", "taxableSubtotalCents", "stateTaxCents", "countySurtaxCents", "taxCents", "totalCents", "refundedTaxCents"] as const;
  return [[csvCell(report.disclaimer)].join(","), "", columns.join(","), ...report.rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n");
}
