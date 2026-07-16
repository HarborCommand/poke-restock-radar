import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildTaxReportFromSnapshots,
  csvCell,
  taxReportCsv,
  taxReportDateBounds,
  TaxReportInputError,
  TaxReportLimitError,
  TAX_REPORT_MAX_TRANSACTIONS,
  type TaxReportAdjustmentSnapshot,
  type TaxReportFilters,
  type TaxReportOnlineSnapshot,
  type TaxReportPosLineSnapshot
} from "../src/lib/tax-reporting";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

function filters(overrides: Partial<TaxReportFilters> = {}): TaxReportFilters {
  return {
    from: new Date("2026-01-01T05:00:00.000Z"),
    toExclusive: new Date("2027-01-01T05:00:00.000Z"),
    fromDate: "2026-01-01",
    toDate: "2026-12-31",
    page: 1,
    pageSize: 50,
    ...overrides
  };
}

function online(overrides: Partial<TaxReportOnlineSnapshot> = {}): TaxReportOnlineSnapshot {
  return {
    orderNumber: "ONLINE-1",
    createdAt: new Date("2026-07-01T16:00:00.000Z"),
    paidAt: new Date("2026-07-01T16:05:00.000Z"),
    taxJurisdictionCountry: "US",
    taxJurisdictionState: "FL",
    taxJurisdictionCounty: null,
    taxStatus: "collected",
    subtotalCents: 10_000,
    discountCents: 1_000,
    shippingCents: 500,
    taxableSubtotalCents: 9_000,
    taxCents: 630,
    totalCents: 10_130,
    refundedTaxCents: 0,
    taxCalculationId: "cs_tax_1",
    shippingMethodLabel: "USPS Ground Advantage",
    shippingPackageProfile: "standard",
    ...overrides
  };
}

function pos(overrides: Partial<TaxReportPosLineSnapshot> = {}): TaxReportPosLineSnapshot {
  return {
    id: "internal-sale-id-1",
    saleReference: "POS-1",
    soldAt: new Date("2026-07-02T16:00:00.000Z"),
    taxJurisdictionCountry: "US",
    taxJurisdictionState: "FL",
    taxJurisdictionCounty: "Orange",
    taxStatus: "collected",
    taxExempt: false,
    subtotalCents: 3_000,
    discountCents: 0,
    taxableSubtotalCents: 3_000,
    taxCents: 210,
    stateTaxCents: 180,
    countySurtaxCents: 30,
    totalCents: 3_210,
    refundedTaxCents: 0,
    ...overrides
  };
}

function adjustment(overrides: Partial<TaxReportAdjustmentSnapshot> = {}): TaxReportAdjustmentSnapshot {
  return {
    channel: "online",
    storefrontOrderReference: "ONLINE-1",
    inventorySaleId: null,
    saleReference: null,
    providerReference: "re_safe_1",
    refundedTaxCents: 0,
    ...overrides
  };
}

test("report route is admin-only, runtime-gated, private, bounded, correlated, and GET-only", () => {
  const route = read("src/app/api/radar/tax-report/route.ts");
  assert.match(route, /requireUser/);
  assert.match(route, /requireAdmin/);
  assert.match(route, /taxReportingEnabled/);
  assert.match(route, /privateNoStoreHeaders/);
  assert.equal((route.match(/withPrivateNoStore\(withRequestId/g) ?? []).length, 2);
  assert.match(route, /crypto\.randomUUID\(\)/);
  assert.match(route, /X-Request-Id/);
  assert.match(route, /TAX_REPORT_MAX_PAGE_SIZE/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
});

test("legacy admin page is server-gated, noindex, and redirects into the Radar tax workspace", () => {
  const page = read("src/app/admin/tax-reports/page.tsx");
  assert.match(page, /currentUser/);
  assert.match(page, /user\.role !== "ADMIN"/);
  assert.match(page, /redirect\("\/app\?tab=tax&section=reports"\)/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
});

test("business-date bounds are local, inclusive, DST-safe, and bounded", () => {
  const spring = taxReportDateBounds("2026-03-08", "2026-03-08");
  assert.equal(spring.from.toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(spring.toExclusive.toISOString(), "2026-03-09T04:00:00.000Z");
  const fall = taxReportDateBounds("2026-11-01", "2026-11-01");
  assert.equal(fall.from.toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(fall.toExclusive.toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(taxReportDateBounds("2026-12-31", "2027-01-01").inclusiveDays, 2);
  assert.throws(() => taxReportDateBounds("2026-02-30", "2026-03-01"), TaxReportInputError);
  assert.throws(() => taxReportDateBounds("2026-03-02", "2026-03-01"), /Start date/);
  assert.throws(() => taxReportDateBounds("2025-01-01", "2026-01-02"), /366 days/);
});

test("mixed online and POS summaries use persisted snapshots and distinguish zero from unknown", () => {
  const report = buildTaxReportFromSnapshots({
    online: [
      online(),
      online({ orderNumber: "ZERO-TAX", subtotalCents: 2_500, discountCents: 0, shippingCents: 0, taxableSubtotalCents: 0, taxCents: 0, totalCents: 2_500, taxCalculationId: "cs_zero" }),
      online({ orderNumber: "UNKNOWN", subtotalCents: 3_000, discountCents: 0, shippingCents: 0, taxableSubtotalCents: null, taxCents: null, totalCents: 3_000, refundedTaxCents: null, taxStatus: "not_recorded", taxCalculationId: null })
    ],
    pos: [
      pos(),
      pos({ id: "internal-sale-id-2", saleReference: "POS-1", subtotalCents: 2_000, taxableSubtotalCents: 2_000, taxCents: 140, stateTaxCents: 120, countySurtaxCents: 20, totalCents: 2_140 }),
      pos({ id: "exempt-line", saleReference: "POS-EXEMPT", subtotalCents: 4_000, taxableSubtotalCents: 0, taxCents: 0, stateTaxCents: 0, countySurtaxCents: 0, totalCents: 4_000, taxStatus: "exempt", taxExempt: true })
    ],
    adjustments: []
  }, filters());
  assert.equal(report.summary.sourceRecordCount, 6);
  assert.equal(report.summary.transactionCount, 5);
  assert.equal(report.summary.grossMerchandiseSalesCents, 24_500);
  assert.equal(report.summary.discountCents, 1_000);
  assert.equal(report.summary.netMerchandiseSalesCents, 23_500);
  assert.equal(report.summary.taxableSalesCents, 14_000);
  assert.equal(report.summary.exemptSalesCents, 4_000);
  assert.equal(report.summary.nonTaxableSalesCents, 2_500);
  assert.equal(report.summary.shippingCents, 500);
  assert.equal(report.summary.floridaStateTaxCents, 300);
  assert.equal(report.summary.countySurtaxCents, 50);
  assert.equal(report.summary.totalTaxCents, 980);
  assert.equal(report.summary.unallocatedTaxCents, 630);
  assert.equal(report.summary.notRecordedTransactionCount, 1);
  assert.equal(report.rows.find((row) => row.reference === "ZERO-TAX")?.taxCents, 0);
  assert.equal(report.rows.find((row) => row.reference === "UNKNOWN")?.taxCents, null);
  assert.deepEqual(report.rows.find((row) => row.reference === "UNKNOWN")?.anomalies, ["unknown_historical_tax"]);
});

test("partial and full refunds use cumulative persisted tax snapshots without going negative", () => {
  const report = buildTaxReportFromSnapshots({
    online: [
      online({ orderNumber: "PARTIAL", taxCents: 700, refundedTaxCents: 200, taxStatus: "partially_refunded", totalCents: 10_200, taxCalculationId: "cs_partial" }),
      online({ orderNumber: "FULL", subtotalCents: 4_000, discountCents: 0, shippingCents: 0, taxableSubtotalCents: 4_000, taxCents: 300, totalCents: 4_300, refundedTaxCents: 300, taxStatus: "refunded", taxCalculationId: "cs_full" })
    ],
    pos: [],
    adjustments: [
      adjustment({ storefrontOrderReference: "PARTIAL", providerReference: "re_partial", refundedTaxCents: 200 }),
      adjustment({ storefrontOrderReference: "FULL", providerReference: "re_full", refundedTaxCents: 300 })
    ]
  }, filters());
  assert.equal(report.summary.totalTaxCents, 1_000);
  assert.equal(report.summary.refundedTaxCents, 500);
  assert.equal(report.summary.netTaxCents, 500);
  assert.equal(report.summary.refundedTransactionCount, 2);
  assert.equal(report.summary.activeTransactionCount, 1);
  assert.equal(report.rows.find((row) => row.reference === "PARTIAL")?.netTaxCents, 500);
  assert.equal(report.rows.find((row) => row.reference === "FULL")?.netTaxCents, 0);
});

test("mirrored online and POS transactions are excluded once and reported safely", () => {
  const report = buildTaxReportFromSnapshots({
    online: [online({ orderNumber: "SHARED-REFERENCE" })],
    pos: [pos({ saleReference: "shared-reference" })],
    adjustments: []
  }, filters());
  assert.equal(report.summary.transactionCount, 1);
  assert.equal(report.summary.deduplicatedTransactionCount, 1);
  assert.equal(report.summary.totalTaxCents, 630);
  assert.deepEqual(report.rows[0]?.anomalies, ["mirrored_channel_transaction"]);
  assert.doesNotMatch(JSON.stringify(report), /internal-sale-id/);
});

test("duplicate provider references and adjustment mismatches are findings, not duplicate totals", () => {
  const report = buildTaxReportFromSnapshots({
    online: [
      online({ orderNumber: "DUP-A", taxCalculationId: "cs_duplicate", refundedTaxCents: 100, taxStatus: "partially_refunded" }),
      online({ orderNumber: "DUP-B", taxCalculationId: "cs_duplicate", refundedTaxCents: 50, taxStatus: "partially_refunded" })
    ],
    pos: [],
    adjustments: [
      adjustment({ storefrontOrderReference: "DUP-A", providerReference: "re_duplicate", refundedTaxCents: 90 }),
      adjustment({ storefrontOrderReference: "DUP-B", providerReference: "re_duplicate", refundedTaxCents: 50 })
    ]
  }, filters());
  assert.equal(report.summary.transactionCount, 2);
  assert.equal(report.summary.totalTaxCents, 1_260);
  assert.ok(report.rows.every((row) => row.anomalies.includes("duplicate_provider_calculation_id")));
  assert.ok(report.rows.every((row) => row.anomalies.includes("duplicate_refund_provider_reference")));
  assert.ok(report.rows.find((row) => row.reference === "DUP-A")?.anomalies.includes("refund_adjustment_mismatch"));
});

test("reconciliation detects persisted mismatches and leaves valid snapshots clean", () => {
  const report = buildTaxReportFromSnapshots({
    online: [
      online({ orderNumber: "VALID" }),
      online({ orderNumber: "BAD-TOTAL", totalCents: 99, taxCalculationId: "cs_bad_total" }),
      online({ orderNumber: "NO-JURISDICTION", taxJurisdictionCountry: null, taxJurisdictionState: null, taxCalculationId: "cs_no_jurisdiction" })
    ],
    pos: [pos({ saleReference: "BAD-COMPONENTS", countySurtaxCents: 999 })],
    adjustments: []
  }, filters());
  assert.deepEqual(report.rows.find((row) => row.reference === "VALID")?.anomalies, []);
  assert.ok(report.rows.find((row) => row.reference === "BAD-TOTAL")?.anomalies.includes("total_mismatch"));
  assert.ok(report.rows.find((row) => row.reference === "NO-JURISDICTION")?.anomalies.includes("missing_tax_jurisdiction"));
  assert.ok(report.rows.find((row) => row.reference === "BAD-COMPONENTS")?.anomalies.includes("tax_component_mismatch"));
});

test("pagination is deterministic and excessive canonical transaction counts fail safely", () => {
  const rows = [
    online({ orderNumber: "EARLY", paidAt: new Date("2026-01-01T10:00:00.000Z") }),
    online({ orderNumber: "MIDDLE", paidAt: new Date("2026-02-01T10:00:00.000Z"), taxCalculationId: "cs_2" }),
    online({ orderNumber: "LATE", paidAt: new Date("2026-03-01T10:00:00.000Z"), taxCalculationId: "cs_3" })
  ];
  const report = buildTaxReportFromSnapshots({ online: rows, pos: [], adjustments: [] }, filters({ page: 2, pageSize: 1 }));
  assert.equal(report.rows[0]?.reference, "MIDDLE");
  assert.deepEqual(report.pagination, { page: 2, pageSize: 1, total: 3, pageCount: 3 });
  const excessive = Array.from({ length: TAX_REPORT_MAX_TRANSACTIONS + 1 }, (_, index) => online({ orderNumber: `ORDER-${index}`, taxCalculationId: `cs_${index}` }));
  assert.throws(() => buildTaxReportFromSnapshots({ online: excessive, pos: [], adjustments: [] }, filters()), TaxReportLimitError);
});

test("CSV is UTF-8, invariant, complete, quoted, and spreadsheet-injection safe", () => {
  const dangerous = ["=CMD()", "+SUM(1,1)", "-10", "@IMPORT", "\t=TAB", "\r=CR", "\n=LF", "  =SPACE"];
  for (const value of dangerous) assert.match(csvCell(value), /^"'/);
  assert.equal(csvCell('comma, quote " and\nline'), '"comma, quote "" and line"');
  const report = buildTaxReportFromSnapshots({
    online: [online({ orderNumber: "=CMD()" })],
    pos: [],
    adjustments: []
  }, filters({ export: true }));
  const csv = taxReportCsv(report);
  assert.ok(csv.startsWith("\uFEFF"));
  for (const header of ["transaction_date", "transaction_reference", "jurisdiction_country", "jurisdiction_state", "jurisdiction_county", "shipping", "total_tax", "refunded_tax", "net_tax", "exemption_status"]) {
    assert.match(csv, new RegExp(`"${header}"`));
  }
  assert.match(csv, /"'=CMD\(\)"/);
  assert.match(csv, /"10\.00"/);
  assert.match(csv, /Accounting support report\. Confirm filing treatment/);
  assert.doesNotMatch(csv, /customer|email|phone|address|providerReference|internal-sale-id/i);
});

test("service selects persisted snapshots only and contains no reporting writes or customer PII", () => {
  const service = read("src/lib/tax-reporting.ts");
  assert.match(service, /isTestOrder: false/);
  assert.match(service, /paidAt: dateRange/);
  assert.match(service, /platform: "pos"/);
  assert.match(service, /taxAdjustment\.findMany/);
  assert.match(service, /findMany|count/);
  assert.doesNotMatch(service, /prisma\.[a-zA-Z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/);
  assert.doesNotMatch(service, /customerEmail|customerPhone|customerName|shippingLine1|paymentReference|metadataJson|refundNote|notes:/);
  assert.doesNotMatch(service, /stateTaxRateBasisPoints|countyTaxRateBasisPoints|stripeClient|taxRateSnapshot/);
});

test("workspace exposes accounting definitions, filters, safe errors, responsive summaries, and explicit export", () => {
  const workspace = read("src/components/TaxReportsWorkspace.tsx");
  const css = read("src/app/globals.css");
  const documentation = read("docs/sales-tax-reporting.md");
  for (const copy of ["Start date", "End date", "All channels", "Local Pickup", "Tax status", "Gross merchandise", "Taxable sales", "Florida state tax", "County surtax", "Tax refunded", "Net tax collected", "Read-only reconciliation", "Export accountant CSV", "America/New_York"]) {
    assert.match(workspace, new RegExp(copy));
  }
  assert.match(workspace, /payload\.requestId/);
  assert.match(css, /\.tax-report-workspace/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /overflow-x: auto/);
  assert.match(documentation, /Gross merchandise sales excluding tax/);
  assert.match(documentation, /not including, local midnight/);
  assert.doesNotMatch(workspace, /customerEmail|customerPhone|shippingAddress|taxCalculationId|providerReference/);
});
