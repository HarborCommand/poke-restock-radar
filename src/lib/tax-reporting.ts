import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/types/radar";

export const TAX_REPORT_TIME_ZONE = "America/New_York";
export const TAX_REPORT_MAX_DAYS = 366;
export const TAX_REPORT_MAX_PAGE_SIZE = 200;
export const TAX_REPORT_MAX_TRANSACTIONS = 5_000;
const TAX_REPORT_MAX_SOURCE_ROWS = 10_000;
const TAX_REPORT_MAX_ADJUSTMENTS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type TaxReportStatusFilter = "active" | "refunded" | "exempt" | "not_recorded";

export type TaxReportFilters = {
  from: Date;
  toExclusive: Date;
  fromDate: string;
  toDate: string;
  channel?: "online" | "pos";
  country?: string;
  state?: string;
  county?: string;
  status?: TaxReportStatusFilter;
  exempt?: boolean;
  refunded?: boolean;
  fulfillment?: "shipping" | "local_pickup";
  export?: boolean;
  page: number;
  pageSize: number;
};

export type TaxReportOnlineSnapshot = {
  orderNumber: string;
  createdAt: Date;
  paidAt: Date | null;
  taxJurisdictionCountry: string | null;
  taxJurisdictionState: string | null;
  taxJurisdictionCounty: string | null;
  taxStatus: string | null;
  subtotalCents: number | null;
  discountCents: number | null;
  shippingCents: number | null;
  taxableSubtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  refundedTaxCents: number | null;
  taxCalculationId: string | null;
  shippingMethodLabel: string | null;
  shippingPackageProfile: string | null;
};

export type TaxReportPosLineSnapshot = {
  id: string;
  saleReference: string | null;
  soldAt: Date;
  taxJurisdictionCountry: string | null;
  taxJurisdictionState: string | null;
  taxJurisdictionCounty: string | null;
  taxStatus: string | null;
  taxExempt: boolean | null;
  subtotalCents: number | null;
  discountCents: number | null;
  taxableSubtotalCents: number | null;
  taxCents: number | null;
  stateTaxCents: number | null;
  countySurtaxCents: number | null;
  totalCents: number | null;
  refundedTaxCents: number | null;
};

export type TaxReportAdjustmentSnapshot = {
  channel: string;
  storefrontOrderReference: string | null;
  inventorySaleId: string | null;
  saleReference: string | null;
  providerReference: string | null;
  refundedTaxCents: number;
};

export type TaxReportRow = {
  channel: "online" | "pos";
  reference: string;
  occurredAt: string;
  jurisdictionCountry: string | null;
  jurisdictionState: string | null;
  jurisdictionCounty: string | null;
  jurisdiction: string;
  status: string;
  exempt: boolean;
  fulfillment: "shipping" | "local_pickup" | "in_store";
  subtotalCents: number | null;
  discountCents: number | null;
  netMerchandiseSalesCents: number | null;
  taxableSubtotalCents: number | null;
  shippingCents: number | null;
  taxCents: number | null;
  stateTaxCents: number | null;
  countySurtaxCents: number | null;
  totalCents: number | null;
  refundedTaxCents: number | null;
  netTaxCents: number | null;
  anomalies: string[];
};

export type TaxReportSummary = {
  sourceRecordCount: number;
  transactionCount: number;
  deduplicatedTransactionCount: number;
  grossMerchandiseSalesCents: number;
  discountCents: number;
  netMerchandiseSalesCents: number;
  taxableSalesCents: number;
  exemptSalesCents: number;
  nonTaxableSalesCents: number;
  shippingCents: number;
  floridaStateTaxCents: number;
  countySurtaxCents: number;
  totalTaxCents: number;
  refundedTaxCents: number;
  netTaxCents: number;
  totalChargedCents: number;
  unallocatedTaxCents: number;
  activeTransactionCount: number;
  refundedTransactionCount: number;
  exemptTransactionCount: number;
  notRecordedTransactionCount: number;
};

export type TaxReport = {
  generatedAt: string;
  disclaimer: string;
  definitions: {
    businessTimeZone: string;
    dateBoundary: string;
    accountingBasis: string;
  };
  filters: Omit<TaxReportFilters, "from" | "toExclusive">;
  summary: TaxReportSummary;
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  reconciliation: { clean: boolean; findingCount: number; scannedTransactions: number; truncated: false };
  rows: TaxReportRow[];
};

export class TaxReportInputError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "TaxReportInputError";
  }
}

export class TaxReportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxReportLimitError";
  }
}

function parseLocalDate(value: string, label: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TaxReportInputError("TAX_REPORT_DATE_INVALID", `${label} must use YYYY-MM-DD.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new TaxReportInputError("TAX_REPORT_DATE_INVALID", `${label} is not a valid calendar date.`);
  }
  return { year, month, day, utcDay: check };
}

function addCalendarDays(value: string, days: number) {
  const parsed = parseLocalDate(value, "Date");
  const next = new Date(parsed.utcDay.getTime() + days * DAY_MS);
  return next.toISOString().slice(0, 10);
}

function zonedMidnight(value: string) {
  const parsed = parseLocalDate(value, "Date");
  const target = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TAX_REPORT_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const correction = target - represented;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}

export function taxReportDateBounds(fromDate: string, toDate: string) {
  const from = parseLocalDate(fromDate, "Start date");
  const to = parseLocalDate(toDate, "End date");
  const inclusiveDays = Math.floor((to.utcDay.getTime() - from.utcDay.getTime()) / DAY_MS) + 1;
  if (inclusiveDays <= 0) throw new TaxReportInputError("TAX_REPORT_DATE_ORDER", "Start date must be on or before end date.");
  if (inclusiveDays > TAX_REPORT_MAX_DAYS) {
    throw new TaxReportInputError("TAX_REPORT_RANGE_LIMIT", `Tax report date range cannot exceed ${TAX_REPORT_MAX_DAYS} days.`);
  }
  return {
    from: zonedMidnight(fromDate),
    toExclusive: zonedMidnight(addCalendarDays(toDate, 1)),
    fromDate,
    toDate,
    inclusiveDays
  };
}

function canonicalReference(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

function nullableSum(values: Array<number | null>) {
  if (!values.length || values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function oneSnapshotValue(values: Array<string | null>, anomalies: Set<string>) {
  const distinct = [...new Set(values.map((value) => value?.trim() || null))];
  if (distinct.length > 1) anomalies.add("inconsistent_snapshot_values");
  return distinct[0] ?? null;
}

type InternalReportRow = TaxReportRow & {
  canonicalKey: string;
  adjustmentKey: string | null;
  providerCalculationId: string | null;
};

function addCoreAnomalies(row: InternalReportRow, anomalies: Set<string>) {
  const knownStatuses = new Set(["calculated", "collected", "exempt", "partially_refunded", "refunded", "not_recorded"]);
  if (!knownStatuses.has(row.status)) anomalies.add("invalid_tax_status_transition");
  if (row.taxCents === null) {
    anomalies.add(row.status === "not_recorded" ? "unknown_historical_tax" : "missing_tax_snapshot");
    if (row.status !== "not_recorded") anomalies.add("invalid_tax_status_transition");
  } else if (row.status === "not_recorded") {
    anomalies.add("invalid_tax_status_transition");
  }
  if (row.exempt && (row.taxCents ?? 0) !== 0) anomalies.add("exempt_transaction_has_tax");
  if ((row.taxCents ?? 0) > 0 && (!row.jurisdictionCountry || !row.jurisdictionState)) anomalies.add("missing_tax_jurisdiction");
  if (row.taxCents !== null && row.refundedTaxCents !== null && row.refundedTaxCents > row.taxCents) {
    anomalies.add("refund_tax_exceeds_original_tax");
  }
  if (row.status === "refunded" && row.taxCents !== null && (row.refundedTaxCents ?? 0) < row.taxCents) {
    anomalies.add("invalid_tax_status_transition");
  }
  if (row.subtotalCents !== null && row.discountCents !== null && row.shippingCents !== null && row.taxCents !== null && row.totalCents !== null) {
    const expected = row.subtotalCents - row.discountCents + row.shippingCents + row.taxCents;
    if (expected !== row.totalCents) anomalies.add("total_mismatch");
  }
  if (row.taxCents !== null && row.stateTaxCents !== null && row.countySurtaxCents !== null && row.stateTaxCents + row.countySurtaxCents !== row.taxCents) {
    anomalies.add("tax_component_mismatch");
  }
}

function posTransactionRows(lines: TaxReportPosLineSnapshot[]) {
  const groups = new Map<string, TaxReportPosLineSnapshot[]>();
  for (const line of lines) {
    const reference = canonicalReference(line.saleReference);
    const key = reference ? `pos:reference:${reference}` : `pos:legacy:${line.id}`;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  return [...groups.entries()].map(([canonicalKey, group]): InternalReportRow => {
    const anomalies = new Set<string>();
    const first = group[0]!;
    const subtotalCents = nullableSum(group.map((line) => line.subtotalCents));
    const discountCents = nullableSum(group.map((line) => line.discountCents));
    const taxableSubtotalCents = nullableSum(group.map((line) => line.taxableSubtotalCents));
    const taxCents = nullableSum(group.map((line) => line.taxCents));
    const stateTaxCents = nullableSum(group.map((line) => line.stateTaxCents));
    const countySurtaxCents = nullableSum(group.map((line) => line.countySurtaxCents));
    const totalCents = nullableSum(group.map((line) => line.totalCents));
    const refundedTaxCents = nullableSum(group.map((line) => line.refundedTaxCents));
    for (const field of ["subtotalCents", "discountCents", "taxableSubtotalCents", "taxCents", "stateTaxCents", "countySurtaxCents", "totalCents", "refundedTaxCents"] as const) {
      const values = group.map((line) => line[field]);
      if (values.some((value) => value === null) && values.some((value) => value !== null)) anomalies.add("inconsistent_snapshot_values");
    }
    const statuses = [...new Set(group.map((line) => line.taxStatus ?? "not_recorded"))];
    if (statuses.length > 1) anomalies.add("invalid_tax_status_transition");
    const status = statuses.includes("partially_refunded")
      ? "partially_refunded"
      : statuses.every((value) => value === "refunded")
        ? "refunded"
        : statuses[0] ?? "not_recorded";
    const country = oneSnapshotValue(group.map((line) => line.taxJurisdictionCountry), anomalies);
    const state = oneSnapshotValue(group.map((line) => line.taxJurisdictionState), anomalies);
    const county = oneSnapshotValue(group.map((line) => line.taxJurisdictionCounty), anomalies);
    const exemptValues = [...new Set(group.map((line) => Boolean(line.taxExempt)))];
    if (exemptValues.length > 1) anomalies.add("inconsistent_snapshot_values");
    const row: InternalReportRow = {
      channel: "pos",
      reference: first.saleReference?.trim() || "POS reference not recorded",
      occurredAt: group.map((line) => line.soldAt).sort((left, right) => left.getTime() - right.getTime())[0]!.toISOString(),
      jurisdictionCountry: country,
      jurisdictionState: state,
      jurisdictionCounty: county,
      jurisdiction: [country, state, county].filter(Boolean).join(" / ") || "Not recorded",
      status,
      exempt: exemptValues[0] ?? false,
      fulfillment: "in_store",
      subtotalCents,
      discountCents,
      netMerchandiseSalesCents: subtotalCents === null || discountCents === null ? null : Math.max(0, subtotalCents - discountCents),
      taxableSubtotalCents,
      shippingCents: 0,
      taxCents,
      stateTaxCents,
      countySurtaxCents,
      totalCents,
      refundedTaxCents,
      netTaxCents: taxCents === null ? null : Math.max(0, taxCents - (refundedTaxCents ?? 0)),
      anomalies: [],
      canonicalKey,
      adjustmentKey: first.saleReference ? `pos:${canonicalReference(first.saleReference)}` : `pos-id:${first.id}`,
      providerCalculationId: null
    };
    addCoreAnomalies(row, anomalies);
    row.anomalies = [...anomalies].sort();
    return row;
  });
}

function onlineTransactionRows(orders: TaxReportOnlineSnapshot[]) {
  return orders.map((order): InternalReportRow => {
    const anomalies = new Set<string>();
    const country = order.taxJurisdictionCountry?.trim() || null;
    const state = order.taxJurisdictionState?.trim() || null;
    const county = order.taxJurisdictionCounty?.trim() || null;
    const status = order.taxStatus ?? "not_recorded";
    const row: InternalReportRow = {
      channel: "online",
      reference: order.orderNumber,
      occurredAt: (order.paidAt ?? order.createdAt).toISOString(),
      jurisdictionCountry: country,
      jurisdictionState: state,
      jurisdictionCounty: county,
      jurisdiction: [country, state, county].filter(Boolean).join(" / ") || "Not recorded",
      status,
      exempt: status === "exempt",
      fulfillment: order.shippingMethodLabel === "Local Pickup" || order.shippingPackageProfile === "local_pickup" ? "local_pickup" : "shipping",
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      netMerchandiseSalesCents: order.subtotalCents === null || order.discountCents === null ? null : Math.max(0, order.subtotalCents - order.discountCents),
      taxableSubtotalCents: order.taxableSubtotalCents,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      stateTaxCents: null,
      countySurtaxCents: null,
      totalCents: order.totalCents,
      refundedTaxCents: order.refundedTaxCents,
      netTaxCents: order.taxCents === null ? null : Math.max(0, order.taxCents - (order.refundedTaxCents ?? 0)),
      anomalies: [],
      canonicalKey: `online:${canonicalReference(order.orderNumber)}`,
      adjustmentKey: `online:${canonicalReference(order.orderNumber)}`,
      providerCalculationId: order.taxCalculationId
    };
    addCoreAnomalies(row, anomalies);
    row.anomalies = [...anomalies].sort();
    return row;
  });
}

function adjustmentKey(adjustment: TaxReportAdjustmentSnapshot) {
  if (adjustment.channel === "online" && adjustment.storefrontOrderReference) {
    return `online:${canonicalReference(adjustment.storefrontOrderReference)}`;
  }
  if (adjustment.channel === "pos" && adjustment.saleReference) return `pos:${canonicalReference(adjustment.saleReference)}`;
  if (adjustment.channel === "pos" && adjustment.inventorySaleId) return `pos-id:${adjustment.inventorySaleId}`;
  return null;
}

function sumRows(rows: InternalReportRow[], field: keyof Pick<TaxReportRow, "subtotalCents" | "discountCents" | "taxableSubtotalCents" | "shippingCents" | "taxCents" | "totalCents">) {
  return rows.reduce((sum, row) => sum + (typeof row[field] === "number" ? row[field] : 0), 0);
}

function publicReportRow(row: InternalReportRow): TaxReportRow {
  return {
    channel: row.channel,
    reference: row.reference,
    occurredAt: row.occurredAt,
    jurisdictionCountry: row.jurisdictionCountry,
    jurisdictionState: row.jurisdictionState,
    jurisdictionCounty: row.jurisdictionCounty,
    jurisdiction: row.jurisdiction,
    status: row.status,
    exempt: row.exempt,
    fulfillment: row.fulfillment,
    subtotalCents: row.subtotalCents,
    discountCents: row.discountCents,
    netMerchandiseSalesCents: row.netMerchandiseSalesCents,
    taxableSubtotalCents: row.taxableSubtotalCents,
    shippingCents: row.shippingCents,
    taxCents: row.taxCents,
    stateTaxCents: row.stateTaxCents,
    countySurtaxCents: row.countySurtaxCents,
    totalCents: row.totalCents,
    refundedTaxCents: row.refundedTaxCents,
    netTaxCents: row.netTaxCents,
    anomalies: row.anomalies
  };
}

export function buildTaxReportFromSnapshots(
  sources: { online: TaxReportOnlineSnapshot[]; pos: TaxReportPosLineSnapshot[]; adjustments: TaxReportAdjustmentSnapshot[] },
  filters: TaxReportFilters,
  generatedAt = new Date()
): TaxReport {
  const onlineRows = onlineTransactionRows(sources.online);
  const onlineReferences = new Set(onlineRows.map((row) => canonicalReference(row.reference)).filter(Boolean));
  let deduplicatedTransactionCount = 0;
  const posRows = posTransactionRows(sources.pos).filter((row) => {
    const reference = row.reference === "POS reference not recorded" ? null : canonicalReference(row.reference);
    if (!reference || !onlineReferences.has(reference)) return true;
    deduplicatedTransactionCount += 1;
    const online = onlineRows.find((candidate) => canonicalReference(candidate.reference) === reference);
    if (online) online.anomalies = [...new Set([...online.anomalies, "mirrored_channel_transaction"])].sort();
    return false;
  });
  const rows = [...onlineRows, ...posRows];
  if (rows.length > TAX_REPORT_MAX_TRANSACTIONS) {
    throw new TaxReportLimitError(`Tax report exceeds the ${TAX_REPORT_MAX_TRANSACTIONS.toLocaleString("en-US")} transaction limit. Narrow the reporting period or filters.`);
  }

  const calculationCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.providerCalculationId) calculationCounts.set(row.providerCalculationId, (calculationCounts.get(row.providerCalculationId) ?? 0) + 1);
  }
  const providerAdjustmentCounts = new Map<string, number>();
  const adjustmentsByTransaction = new Map<string, TaxReportAdjustmentSnapshot[]>();
  for (const adjustment of sources.adjustments) {
    const key = adjustmentKey(adjustment);
    if (key) adjustmentsByTransaction.set(key, [...(adjustmentsByTransaction.get(key) ?? []), adjustment]);
    if (adjustment.providerReference) {
      providerAdjustmentCounts.set(adjustment.providerReference, (providerAdjustmentCounts.get(adjustment.providerReference) ?? 0) + 1);
    }
  }
  for (const row of rows) {
    const anomalies = new Set(row.anomalies);
    if (row.providerCalculationId && (calculationCounts.get(row.providerCalculationId) ?? 0) > 1) anomalies.add("duplicate_provider_calculation_id");
    const adjustments = row.adjustmentKey ? adjustmentsByTransaction.get(row.adjustmentKey) ?? [] : [];
    const adjustedTax = adjustments.reduce((sum, adjustment) => sum + Math.max(0, adjustment.refundedTaxCents), 0);
    if (adjustments.length && row.refundedTaxCents !== null && adjustedTax !== row.refundedTaxCents) anomalies.add("refund_adjustment_mismatch");
    if (!adjustments.length && (row.refundedTaxCents ?? 0) > 0) anomalies.add("missing_refund_adjustment");
    if (adjustments.some((adjustment) => adjustment.providerReference && (providerAdjustmentCounts.get(adjustment.providerReference) ?? 0) > 1)) {
      anomalies.add("duplicate_refund_provider_reference");
    }
    row.anomalies = [...anomalies].sort();
  }

  rows.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.channel.localeCompare(right.channel) || left.reference.localeCompare(right.reference));
  const grossMerchandiseSalesCents = sumRows(rows, "subtotalCents");
  const discountCents = sumRows(rows, "discountCents");
  const netMerchandiseSalesCents = rows.reduce((sum, row) => sum + (row.netMerchandiseSalesCents ?? 0), 0);
  const taxableSalesCents = sumRows(rows, "taxableSubtotalCents");
  const exemptSalesCents = rows.reduce((sum, row) => sum + (row.exempt ? row.netMerchandiseSalesCents ?? 0 : 0), 0);
  const nonTaxableSalesCents = rows.reduce((sum, row) => {
    if (row.exempt || row.taxCents === null || row.netMerchandiseSalesCents === null || row.taxableSubtotalCents === null) return sum;
    return sum + Math.max(0, row.netMerchandiseSalesCents - row.taxableSubtotalCents);
  }, 0);
  const totalTaxCents = sumRows(rows, "taxCents");
  const refundedTaxCents = rows.reduce((sum, row) => {
    if (row.taxCents === null) return sum;
    return sum + Math.min(Math.max(0, row.refundedTaxCents ?? 0), Math.max(0, row.taxCents));
  }, 0);
  const unallocatedTaxCents = rows.reduce((sum, row) => {
    if (row.taxCents === null) return sum;
    const allocated = (row.stateTaxCents ?? 0) + (row.countySurtaxCents ?? 0);
    return sum + Math.max(0, row.taxCents - allocated);
  }, 0);
  const page = filters.export ? 1 : Math.max(1, Math.min(TAX_REPORT_MAX_TRANSACTIONS, Math.floor(filters.page)));
  const pageSize = filters.export ? TAX_REPORT_MAX_TRANSACTIONS : Math.max(1, Math.min(200, Math.floor(filters.pageSize)));
  const offset = (page - 1) * pageSize;
  const publicRows = rows.slice(offset, offset + pageSize).map(publicReportRow);
  return {
    generatedAt: generatedAt.toISOString(),
    disclaimer: "Accounting support report. Confirm filing treatment with your tax professional or Florida Department of Revenue account.",
    definitions: {
      businessTimeZone: TAX_REPORT_TIME_ZONE,
      dateBoundary: "Inclusive local start date; exclusive midnight after the selected local end date.",
      accountingBasis: "Persisted finalized transaction and refund snapshots only; no current-rate recalculation or automatic repair."
    },
    filters: {
      fromDate: filters.fromDate,
      toDate: filters.toDate,
      channel: filters.channel,
      country: filters.country,
      state: filters.state,
      county: filters.county,
      status: filters.status,
      exempt: filters.exempt,
      refunded: filters.refunded,
      fulfillment: filters.fulfillment,
      export: filters.export,
      page,
      pageSize
    },
    summary: {
      sourceRecordCount: sources.online.length + sources.pos.length,
      transactionCount: rows.length,
      deduplicatedTransactionCount,
      grossMerchandiseSalesCents,
      discountCents,
      netMerchandiseSalesCents,
      taxableSalesCents,
      exemptSalesCents,
      nonTaxableSalesCents,
      shippingCents: sumRows(rows, "shippingCents"),
      floridaStateTaxCents: rows.reduce((sum, row) => sum + (row.jurisdictionState === "FL" ? row.stateTaxCents ?? 0 : 0), 0),
      countySurtaxCents: rows.reduce((sum, row) => sum + (row.jurisdictionState === "FL" ? row.countySurtaxCents ?? 0 : 0), 0),
      totalTaxCents,
      refundedTaxCents,
      netTaxCents: Math.max(0, totalTaxCents - refundedTaxCents),
      totalChargedCents: sumRows(rows, "totalCents"),
      unallocatedTaxCents,
      activeTransactionCount: rows.filter((row) => row.status !== "refunded").length,
      refundedTransactionCount: rows.filter((row) => (row.refundedTaxCents ?? 0) > 0 || row.status === "partially_refunded" || row.status === "refunded").length,
      exemptTransactionCount: rows.filter((row) => row.exempt).length,
      notRecordedTransactionCount: rows.filter((row) => row.taxCents === null || row.status === "not_recorded").length
    },
    pagination: { page, pageSize, total: rows.length, pageCount: Math.ceil(rows.length / pageSize) },
    reconciliation: {
      clean: rows.every((row) => row.anomalies.length === 0),
      findingCount: rows.reduce((count, row) => count + row.anomalies.length, 0),
      scannedTransactions: rows.length,
      truncated: false
    },
    rows: publicRows
  };
}

function dateRange(filters: TaxReportFilters) {
  return { gte: filters.from, lt: filters.toExclusive };
}

function statusWhere(status: TaxReportStatusFilter | undefined) {
  if (status === "not_recorded") return { OR: [{ taxCents: null }, { taxStatus: "not_recorded" }] };
  if (status === "refunded") return { OR: [{ refundedTaxCents: { gt: 0 } }, { taxStatus: { in: ["partially_refunded", "refunded"] } }] };
  if (status === "exempt") return { taxStatus: "exempt" };
  if (status === "active") return { taxCents: { not: null }, taxStatus: { notIn: ["refunded", "canceled"] } };
  return {};
}

function nullableZeroFilter(field: "refundedTaxCents") {
  return { OR: [{ [field]: null }, { [field]: 0 }] };
}

export async function buildTaxReport(currentUser: SessionUser, filters: TaxReportFilters) {
  const common = {
    ...(filters.country ? { taxJurisdictionCountry: filters.country } : {}),
    ...(filters.state ? { taxJurisdictionState: filters.state } : {}),
    ...(filters.county ? { taxJurisdictionCounty: filters.county } : {})
  };
  const pickupWhere: Prisma.StorefrontOrderWhereInput = {
    OR: [{ shippingMethodLabel: "Local Pickup" }, { shippingPackageProfile: "local_pickup" }]
  };
  const onlineWhere: Prisma.StorefrontOrderWhereInput = {
    AND: [
      { userId: currentUser.id },
      { paymentStatus: { in: ["paid", "partially_refunded", "refunded"] } },
      { isTestOrder: false },
      common,
      statusWhere(filters.status),
      filters.exempt === true ? { taxStatus: "exempt" } : filters.exempt === false ? { NOT: { taxStatus: "exempt" } } : {},
      filters.refunded === true ? { refundedTaxCents: { gt: 0 } } : filters.refunded === false ? nullableZeroFilter("refundedTaxCents") : {},
      filters.fulfillment === "local_pickup" ? pickupWhere : filters.fulfillment === "shipping" ? { NOT: pickupWhere } : {},
      { OR: [{ paidAt: dateRange(filters) }, { AND: [{ paidAt: null }, { createdAt: dateRange(filters) }] }] }
    ]
  };
  const posWhere: Prisma.InventorySaleWhereInput = {
    AND: [
      { userId: currentUser.id },
      { platform: "pos" },
      { OR: [{ refundStatus: null }, { refundStatus: { not: "canceled" } }] },
      common,
      statusWhere(filters.status),
      filters.exempt === true ? { taxExempt: true } : filters.exempt === false ? { OR: [{ taxExempt: false }, { taxExempt: null }] } : {},
      filters.refunded === true ? { refundedTaxCents: { gt: 0 } } : filters.refunded === false ? nullableZeroFilter("refundedTaxCents") : {},
      { soldAt: dateRange(filters) }
    ]
  };
  const includeOnline = filters.channel !== "pos";
  const includePos = filters.channel !== "online" && !filters.fulfillment;
  const [onlineCount, posLineCount] = await Promise.all([
    includeOnline ? prisma.storefrontOrder.count({ where: onlineWhere }) : Promise.resolve(0),
    includePos ? prisma.inventorySale.count({ where: posWhere }) : Promise.resolve(0)
  ]);
  if (onlineCount + posLineCount > TAX_REPORT_MAX_SOURCE_ROWS) {
    throw new TaxReportLimitError(`Tax report exceeds the ${TAX_REPORT_MAX_SOURCE_ROWS.toLocaleString("en-US")} source-row limit. Narrow the reporting period or filters.`);
  }

  const adjustmentOr: Prisma.TaxAdjustmentWhereInput[] = [];
  if (includeOnline) adjustmentOr.push({ storefrontOrder: { is: onlineWhere } });
  if (includePos) adjustmentOr.push({ inventorySale: { is: posWhere } });
  const [online, pos, rawAdjustments] = await Promise.all([
    includeOnline ? prisma.storefrontOrder.findMany({
      where: onlineWhere,
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }, { orderNumber: "asc" }],
      take: TAX_REPORT_MAX_SOURCE_ROWS + 1,
      select: {
        orderNumber: true, createdAt: true, paidAt: true, taxJurisdictionCountry: true, taxJurisdictionState: true, taxJurisdictionCounty: true,
        taxStatus: true, subtotalCents: true, discountCents: true, shippingCents: true, taxableSubtotalCents: true,
        taxCents: true, totalCents: true, refundedTaxCents: true, taxCalculationId: true, shippingMethodLabel: true, shippingPackageProfile: true
      }
    }) : Promise.resolve([]),
    includePos ? prisma.inventorySale.findMany({
      where: posWhere,
      orderBy: [{ soldAt: "desc" }, { saleReference: "asc" }, { id: "asc" }],
      take: TAX_REPORT_MAX_SOURCE_ROWS + 1,
      select: {
        id: true, saleReference: true, soldAt: true, taxJurisdictionCountry: true, taxJurisdictionState: true, taxJurisdictionCounty: true,
        taxStatus: true, taxExempt: true, subtotalCents: true, discountCents: true, taxableSubtotalCents: true,
        taxCents: true, stateTaxCents: true, countySurtaxCents: true, totalCents: true, refundedTaxCents: true
      }
    }) : Promise.resolve([]),
    adjustmentOr.length ? prisma.taxAdjustment.findMany({
      where: { OR: adjustmentOr },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TAX_REPORT_MAX_ADJUSTMENTS + 1,
      select: {
        channel: true, saleReference: true, providerReference: true, refundedTaxCents: true,
        storefrontOrder: { select: { orderNumber: true } },
        inventorySale: { select: { id: true, saleReference: true } }
      }
    }) : Promise.resolve([])
  ]);
  if (online.length + pos.length > TAX_REPORT_MAX_SOURCE_ROWS || rawAdjustments.length > TAX_REPORT_MAX_ADJUSTMENTS) {
    throw new TaxReportLimitError("Tax report reconciliation exceeded its bounded scan limit. Narrow the reporting period or filters.");
  }
  const adjustments: TaxReportAdjustmentSnapshot[] = rawAdjustments.map((adjustment) => ({
    channel: adjustment.channel,
    storefrontOrderReference: adjustment.storefrontOrder?.orderNumber ?? null,
    inventorySaleId: adjustment.inventorySale?.id ?? null,
    saleReference: adjustment.saleReference ?? adjustment.inventorySale?.saleReference ?? null,
    providerReference: adjustment.providerReference,
    refundedTaxCents: adjustment.refundedTaxCents
  }));
  return buildTaxReportFromSnapshots({ online, pos, adjustments }, filters);
}

export function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const injectionRisk = /^[\u0000-\u0020]*[=+\-@]/.test(raw) || /^[\t\r\n]/.test(raw);
  const normalized = raw.replace(/[\t\r\n]+/g, " ");
  const safe = injectionRisk ? `'${normalized}` : normalized;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function taxReportCsv(report: TaxReport) {
  const money = (value: number | null) => value === null ? "" : (value / 100).toFixed(2);
  const headers = [
    "transaction_date", "transaction_reference", "channel", "fulfillment", "tax_status", "jurisdiction_country", "jurisdiction_state",
    "jurisdiction_county", "merchandise_subtotal", "discount", "net_merchandise_sales", "taxable_subtotal", "shipping", "state_tax",
    "county_surtax", "total_tax", "refunded_tax", "net_tax", "total_charged", "exemption_status", "reconciliation_findings"
  ];
  const lines = report.rows.map((row) => [
    row.occurredAt, row.reference, row.channel, row.fulfillment, row.status, row.jurisdictionCountry, row.jurisdictionState, row.jurisdictionCounty,
    money(row.subtotalCents), money(row.discountCents), money(row.netMerchandiseSalesCents), money(row.taxableSubtotalCents), money(row.shippingCents),
    money(row.stateTaxCents), money(row.countySurtaxCents), money(row.taxCents), money(row.refundedTaxCents), money(row.netTaxCents), money(row.totalCents),
    row.exempt ? "exempt" : "not_exempt", row.anomalies.join("; ")
  ].map(csvCell).join(","));
  return `\uFEFF${[
    [csvCell("Sales tax accounting-support export"), csvCell(`Period: ${report.filters.fromDate} through ${report.filters.toDate}`), csvCell(`Business timezone: ${report.definitions.businessTimeZone}`), csvCell(`Generated: ${report.generatedAt}`)].join(","),
    csvCell(report.disclaimer),
    csvCell(report.definitions.accountingBasis),
    "",
    headers.map(csvCell).join(","),
    ...lines
  ].join("\r\n")}`;
}
