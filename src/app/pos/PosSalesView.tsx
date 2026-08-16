"use client";

import { CreditCard, RefreshCw, Search, ShoppingBag } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./PosRegisterShell.module.css";

type PosHistorySale = {
  saleReference: string;
  completedAt: string;
  itemCount: number;
  lineCount: number;
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod: string;
  paymentMethodLabel: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  refundedAmount: number;
  refundStatus: string | null;
  items: string[];
};

type HistoryResponse = { sales?: PosHistorySale[]; error?: string };

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function saleTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function PosSalesView() {
  const [sales, setSales] = useState<PosHistorySale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/radar/pos/history", { credentials: "same-origin", cache: "no-store" });
      const data = (await response.json()) as HistoryResponse;
      if (!response.ok) throw new Error(data.error || "Could not load sales.");
      setSales(Array.isArray(data.sales) ? data.sales : []);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load sales.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleSales = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sales;
    return sales.filter((sale) =>
      [
        sale.saleReference,
        sale.paymentMethodLabel,
        sale.customerName,
        sale.customerEmail,
        sale.customerPhone,
        ...sale.items
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [sales, search]);

  const todayTotal = useMemo(() => {
    const today = new Date();
    return sales.reduce((sum, sale) => {
      const soldAt = new Date(sale.completedAt);
      const sameDay =
        soldAt.getFullYear() === today.getFullYear() &&
        soldAt.getMonth() === today.getMonth() &&
        soldAt.getDate() === today.getDate();
      return sameDay ? sum + Math.max(0, sale.total - sale.refundedAmount) : sum;
    }, 0);
  }, [sales]);

  return (
    <section className={styles.view} aria-label="POS sales">
      <div className={styles.viewHeader}>
        <div>
          <span className={styles.eyebrow}>Register activity</span>
          <h1>Sales</h1>
          <p>Recent in-store transactions only. Card details and private payment references are never exposed here.</p>
        </div>
        <div className={styles.summaryPills}>
          <span><b>{sales.length}</b> recent sales</span>
          <span><b>{money(todayTotal)}</b> today</span>
        </div>
      </div>

      <div className={styles.toolbarActions}>
        <label className={styles.searchField}>
          <Search size={18} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search receipt, customer or item"
            aria-label="Search POS sales"
          />
        </label>
        <button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {error ? <div className={styles.errorCard} role="alert">{error}</div> : null}
      {loading ? <div className={styles.loadingCard}>Loading sales…</div> : null}

      {!loading && !error ? (
        visibleSales.length ? (
          <div className={styles.salesList}>
            {visibleSales.map((sale) => (
              <article className={styles.saleRow} key={sale.saleReference}>
                <span className={styles.saleIcon}><CreditCard size={19} aria-hidden="true" /></span>
                <div className={styles.saleIdentity}>
                  <strong>{sale.saleReference}</strong>
                  <small>{saleTime(sale.completedAt)} · {sale.items.slice(0, 2).join(" · ")}{sale.items.length > 2 ? ` +${sale.items.length - 2}` : ""}</small>
                </div>
                <div className={styles.saleMetric}>
                  <small>Payment</small>
                  <strong>{sale.paymentMethodLabel}</strong>
                </div>
                <div className={styles.saleMetric}>
                  <small>Customer</small>
                  <strong>{sale.customerName || sale.customerEmail || "Guest"}</strong>
                </div>
                <div className={styles.saleMetric}>
                  <small>Items</small>
                  <strong>{sale.itemCount}</strong>
                </div>
                <div className={styles.saleTotal}>
                  {sale.refundedAmount > 0 ? <small>{sale.refundStatus || "Refunded"} · -{money(sale.refundedAmount)}</small> : <small>Completed</small>}
                  <strong>{money(Math.max(0, sale.total - sale.refundedAmount))}</strong>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyCard}>
            <ShoppingBag size={28} aria-hidden="true" />
            <strong>No matching sales</strong>
            <span>Completed register sales will appear here.</span>
          </div>
        )
      ) : null}
    </section>
  );
}
