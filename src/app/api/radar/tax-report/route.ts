import { requireAdmin, requireUser } from "@/lib/auth";
import { privateNoStoreHeaders, safeApiError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { taxFeatureConfig } from "@/lib/tax";
import {
  buildTaxReport,
  taxReportCsv,
  taxReportDateBounds,
  TaxReportInputError,
  TaxReportLimitError,
  TAX_REPORT_MAX_PAGE_SIZE,
  TAX_REPORT_MAX_TRANSACTIONS,
  type TaxReportStatusFilter
} from "@/lib/tax-reporting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function optionalChoice<T extends string>(value: string | null, allowed: readonly T[], label: string) {
  if (!value) return undefined;
  if (!allowed.includes(value as T)) throw new TaxReportInputError("TAX_REPORT_FILTER_INVALID", `Select a valid ${label}.`);
  return value as T;
}

function optionalBoolean(value: string | null, label: string) {
  if (value === null || value === "") return undefined;
  if (value !== "true" && value !== "false") throw new TaxReportInputError("TAX_REPORT_FILTER_INVALID", `Select a valid ${label}.`);
  return value === "true";
}

function boundedInteger(value: string | null, fallback: number, maximum: number, label: string) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new TaxReportInputError("TAX_REPORT_PAGE_INVALID", `${label} must be a whole number.`);
  const parsed = Number(value);
  if (parsed < 1 || parsed > maximum) {
    throw new TaxReportInputError("TAX_REPORT_PAGE_INVALID", `${label} must be between 1 and ${maximum.toLocaleString("en-US")}.`);
  }
  return parsed;
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const adminResponse = requireAdmin(user);
  if (adminResponse) return withPrivateNoStore(withRequestId(adminResponse, requestId));
  if (!taxFeatureConfig().taxReportingEnabled) {
    return safeApiError("TAX_REPORTING_DISABLED", "Tax reporting is disabled.", 404, requestId);
  }

  try {
    const query = new URL(request.url).searchParams;
    const fromDate = query.get("from");
    const toDate = query.get("to");
    if (!fromDate || !toDate) {
      throw new TaxReportInputError("TAX_REPORT_DATES_REQUIRED", "Start date and end date are required.");
    }
    const bounds = taxReportDateBounds(fromDate, toDate);
    const format = optionalChoice(query.get("format"), ["csv"] as const, "export format");
    const channel = optionalChoice(query.get("channel"), ["online", "pos"] as const, "channel");
    const fulfillment = optionalChoice(query.get("fulfillment"), ["shipping", "local_pickup"] as const, "fulfillment method");
    const status = optionalChoice(query.get("status"), ["active", "refunded", "exempt", "not_recorded"] as const, "tax status") as TaxReportStatusFilter | undefined;
    const country = query.get("country")?.trim().toUpperCase() || undefined;
    const state = query.get("state")?.trim().toUpperCase() || undefined;
    const county = query.get("county")?.trim() || undefined;
    if (country && !/^[A-Z]{2}$/.test(country)) throw new TaxReportInputError("TAX_REPORT_FILTER_INVALID", "Select a valid country code.");
    if (state && !/^[A-Z]{2}$/.test(state)) throw new TaxReportInputError("TAX_REPORT_FILTER_INVALID", "Select a valid state code.");
    if (county && county.length > 80) throw new TaxReportInputError("TAX_REPORT_FILTER_INVALID", "County filter is too long.");
    const report = await buildTaxReport(user, {
      ...bounds,
      channel,
      fulfillment,
      country,
      state,
      county,
      status,
      exempt: optionalBoolean(query.get("exempt"), "exemption filter"),
      refunded: optionalBoolean(query.get("refunded"), "refund filter"),
      page: format === "csv" ? 1 : boundedInteger(query.get("page"), 1, TAX_REPORT_MAX_TRANSACTIONS, "Page"),
      pageSize: format === "csv" ? TAX_REPORT_MAX_TRANSACTIONS : boundedInteger(query.get("pageSize"), 50, TAX_REPORT_MAX_PAGE_SIZE, "Page size"),
      export: format === "csv"
    });
    if (format === "csv") {
      return new Response(taxReportCsv(report), {
        headers: {
          ...privateNoStoreHeaders,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="sales-tax-report-${fromDate}-through-${toDate}.csv"`,
          "X-Content-Type-Options": "nosniff",
          "X-Request-Id": requestId
        }
      });
    }
    return Response.json(report, { headers: { ...privateNoStoreHeaders, "X-Request-Id": requestId } });
  } catch (error) {
    if (error instanceof TaxReportInputError) return safeApiError(error.code, error.message, 400, requestId);
    if (error instanceof TaxReportLimitError) return safeApiError("TAX_REPORT_LIMIT", error.message, 413, requestId);
    console.error("Tax report request failed", { requestId, errorType: error instanceof Error ? error.name : "UnknownError" });
    return safeApiError("TAX_REPORT_FAILED", "Unable to build the tax report.", 500, requestId);
  }
}
