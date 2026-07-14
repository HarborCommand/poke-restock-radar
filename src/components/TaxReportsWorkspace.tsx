"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { TaxReport } from "@/lib/tax-reporting";

type Filters = {
  from: string;
  to: string;
  channel: string;
  fulfillment: string;
  country: string;
  state: string;
  county: string;
  status: string;
};

function businessDate(value: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function defaultDates() {
  const now = new Date();
  const to = businessDate(now);
  const [year, month, day] = to.split("-").map(Number);
  const from = new Date(Date.UTC(year!, month! - 1, day! - 29));
  return { from: from.toISOString().slice(0, 10), to };
}

function money(cents: number | null) {
  if (cents === null) return "Not recorded";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York"
  }).format(new Date(value));
}

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function queryFor(filters: Filters, page: number) {
  const query = new URLSearchParams({ page: String(page), pageSize: "50" });
  for (const [key, value] of Object.entries(filters)) if (value.trim()) query.set(key, value.trim());
  return query;
}

export function TaxReportsWorkspace() {
  const [filters, setFilters] = useState<Filters>(() => ({
    ...defaultDates(),
    channel: "",
    fulfillment: "",
    country: "",
    state: "",
    county: "",
    status: ""
  }));
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<TaxReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/radar/tax-report?${queryFor(applied, page)}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal
      });
      const payload = (await response.json()) as TaxReport & { error?: string; message?: string; requestId?: string };
      if (!response.ok) {
        const message = payload.message || payload.error || "Tax report could not be loaded.";
        throw new Error(`${message}${payload.requestId ? ` Reference: ${payload.requestId}.` : ""}`);
      }
      setReport(payload);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Tax report could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setApplied(filters);
  }

  const exportHref = `/api/radar/tax-report?${queryFor(applied, 1)}&format=csv`;
  const summary = report?.summary;
  const financialCards = summary ? [
    ["Gross merchandise", summary.grossMerchandiseSalesCents],
    ["Discounts", summary.discountCents],
    ["Net merchandise", summary.netMerchandiseSalesCents],
    ["Taxable sales", summary.taxableSalesCents],
    ["Exempt sales", summary.exemptSalesCents],
    ["Non-taxable sales", summary.nonTaxableSalesCents],
    ["Shipping charged", summary.shippingCents],
    ["Florida state tax", summary.floridaStateTaxCents],
    ["County surtax", summary.countySurtaxCents],
    ["Total tax collected", summary.totalTaxCents],
    ["Tax refunded", summary.refundedTaxCents],
    ["Net tax collected", summary.netTaxCents]
  ] as const : [];
  const countCards = summary ? [
    ["Active", summary.activeTransactionCount],
    ["Refunded", summary.refundedTransactionCount],
    ["Exempt", summary.exemptTransactionCount],
    ["Not recorded", summary.notRecordedTransactionCount]
  ] as const : [];

  return (
    <main className="tax-report-workspace" aria-busy={loading}>
      <header className="tax-report-header">
        <div>
          <a href="/admin">Admin</a><span aria-hidden="true"> / </span><a href="/admin/tax-settings">Tax Settings</a>
          <p className="tax-report-eyebrow">Accounting-support workspace</p>
          <h1>Sales Tax Reports</h1>
          <p>Review finalized online and POS snapshots in America/New_York time. Historical tax is never recalculated or repaired here.</p>
        </div>
        <div className="tax-report-actions">
          {report ? <a className="tax-report-secondary" href={exportHref}>Export accountant CSV</a> : null}
          <button type="button" onClick={() => void load()} disabled={loading}>Refresh</button>
        </div>
      </header>

      <form className="tax-report-filters" onSubmit={submit}>
        <label>Start date<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} required /></label>
        <label>End date<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} required /></label>
        <label>Channel<select value={filters.channel} onChange={(event) => setFilters({ ...filters, channel: event.target.value })}><option value="">All channels</option><option value="online">Online</option><option value="pos">POS</option></select></label>
        <label>Fulfillment<select value={filters.fulfillment} onChange={(event) => setFilters({ ...filters, fulfillment: event.target.value })}><option value="">All fulfillment</option><option value="shipping">Shipment</option><option value="local_pickup">Local Pickup</option></select></label>
        <label>Country<input maxLength={2} value={filters.country} onChange={(event) => setFilters({ ...filters, country: event.target.value.toUpperCase() })} /></label>
        <label>State<input maxLength={2} value={filters.state} onChange={(event) => setFilters({ ...filters, state: event.target.value.toUpperCase() })} /></label>
        <label>County<input maxLength={80} value={filters.county} onChange={(event) => setFilters({ ...filters, county: event.target.value })} placeholder="All counties" /></label>
        <label>Tax status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option><option value="active">Active</option><option value="refunded">Refunded</option><option value="exempt">Exempt</option><option value="not_recorded">Not recorded</option></select></label>
        <button type="submit" disabled={loading}>Apply filters</button>
        <p className="tax-report-filter-note">Dates are inclusive calendar dates in America/New_York. Reports are limited to 366 days and 5,000 transactions.</p>
      </form>

      {error ? <div className="tax-report-error" role="alert">{error}</div> : null}
      {loading && !report ? <div className="tax-report-state" role="status">Loading persisted tax snapshots...</div> : null}

      {report ? (
        <>
          <section className="tax-report-kpis" aria-label="Tax report financial summary">
            {financialCards.map(([name, value]) => <article className={name === "Net tax collected" ? "primary" : ""} key={name}><span>{name}</span><strong>{money(value)}</strong></article>)}
          </section>

          <section className="tax-report-counts" aria-label="Tax report transaction counts">
            {countCards.map(([name, value]) => <article key={name}><span>{name}</span><strong>{value.toLocaleString()}</strong></article>)}
          </section>

          {summary && summary.notRecordedTransactionCount > 0 ? (
            <div className="tax-report-unknown" role="status">
              <strong>{summary.notRecordedTransactionCount.toLocaleString()} historical transaction{summary.notRecordedTransactionCount === 1 ? " has" : "s have"} tax not recorded.</strong>
              <span>These transactions are excluded from collected-tax totals and are never treated as authoritative zero tax.</span>
            </div>
          ) : null}

          <section className={report.reconciliation.clean ? "tax-reconciliation clean" : "tax-reconciliation warning"} aria-label="Read-only reconciliation findings">
            <div><p>Read-only reconciliation</p><h2>{report.reconciliation.clean ? "No findings" : `${report.reconciliation.findingCount} finding${report.reconciliation.findingCount === 1 ? "" : "s"} need review`}</h2></div>
            <p>Scanned all {report.reconciliation.scannedTransactions.toLocaleString()} bounded transactions. Findings never update or auto-correct source records.</p>
            {summary && summary.unallocatedTaxCents > 0 ? <p>Authoritative tax without a stored state/county split: {money(summary.unallocatedTaxCents)}.</p> : null}
            {summary && summary.deduplicatedTransactionCount > 0 ? <p>Excluded {summary.deduplicatedTransactionCount.toLocaleString()} mirrored cross-channel transaction{summary.deduplicatedTransactionCount === 1 ? "" : "s"} from totals.</p> : null}
          </section>

          <section className="tax-report-table-card">
            <div className="tax-report-table-heading"><div><p>Transaction detail</p><h2>{report.pagination.total.toLocaleString()} canonical transaction{report.pagination.total === 1 ? "" : "s"}</h2></div><span>Generated {dateTime(report.generatedAt)}</span></div>
            <div className="tax-report-table-scroll" tabIndex={0} aria-label="Scrollable tax transaction table">
              <table>
                <thead><tr><th>Date</th><th>Reference</th><th>Channel</th><th>Jurisdiction</th><th>Net merchandise</th><th>Taxable sales</th><th>Shipping</th><th>State tax</th><th>County tax</th><th>Total tax</th><th>Refunded tax</th><th>Net tax</th><th>Total charged</th><th>Status and findings</th></tr></thead>
                <tbody>
                  {report.rows.map((row, index) => (
                    <tr key={`${row.channel}-${row.reference}-${row.occurredAt}-${index}`}>
                      <td>{dateTime(row.occurredAt)}</td><td className="tax-report-reference"><strong>{row.reference}</strong><small>{label(row.fulfillment)}</small></td><td>{row.channel === "pos" ? "POS" : "Online"}</td><td>{row.jurisdiction}</td>
                      <td>{money(row.netMerchandiseSalesCents)}</td><td>{money(row.taxableSubtotalCents)}</td><td>{money(row.shippingCents)}</td><td>{money(row.stateTaxCents)}</td><td>{money(row.countySurtaxCents)}</td><td>{money(row.taxCents)}</td><td>{money(row.refundedTaxCents)}</td><td>{money(row.netTaxCents)}</td><td>{money(row.totalCents)}</td>
                      <td><span className={`tax-row-status ${row.anomalies.length ? "warning" : ""}`}>{row.exempt ? "Exempt" : label(row.status)}</span>{row.anomalies.map((finding) => <small key={finding}>{label(finding)}</small>)}</td>
                    </tr>
                  ))}
                  {!report.rows.length ? <tr><td colSpan={14} className="tax-report-empty">No persisted tax records match these filters.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <footer className="tax-report-pagination"><span>Page {report.pagination.page} of {Math.max(1, report.pagination.pageCount)}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button type="button" disabled={page >= report.pagination.pageCount || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></footer>
          </section>
          <p className="tax-report-disclaimer">{report.disclaimer}</p>
        </>
      ) : null}
    </main>
  );
}
