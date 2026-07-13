import { requireAdmin, requireUser } from "@/lib/auth";
import { privateNoStoreHeaders } from "@/lib/http";
import { taxFeatureConfig } from "@/lib/tax";
import { buildTaxReport, taxReportCsv } from "@/lib/tax-reporting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function optionalDate(value: string | null, endOfDay = false) {
  if (!value) return undefined;
  const date = new Date(endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid report date.");
  return date;
}

export async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;
  if (!taxFeatureConfig().taxReportingEnabled) {
    return Response.json({ error: "Tax reporting is disabled." }, { status: 404, headers: privateNoStoreHeaders });
  }
  try {
    const query = new URL(request.url).searchParams;
    const channel = query.get("channel");
    const exempt = query.get("exempt");
    const refunded = query.get("refunded");
    const report = await buildTaxReport(user, {
      from: optionalDate(query.get("from")), to: optionalDate(query.get("to"), true),
      channel: channel === "online" || channel === "pos" ? channel : undefined,
      country: query.get("country")?.toUpperCase() || undefined,
      state: query.get("state")?.toUpperCase() || undefined,
      county: query.get("county") || undefined,
      status: query.get("status") || undefined,
      exempt: exempt === "true" ? true : exempt === "false" ? false : undefined,
      refunded: refunded === "true" ? true : refunded === "false" ? false : undefined,
      page: Number(query.get("page") || 1), pageSize: Number(query.get("pageSize") || 100)
    });
    if (query.get("format") === "csv") {
      return new Response(taxReportCsv(report), {
        headers: { ...privateNoStoreHeaders, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="sales-tax-report.csv"' }
      });
    }
    return Response.json(report, { headers: privateNoStoreHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to build tax report." }, { status: 400, headers: privateNoStoreHeaders });
  }
}
