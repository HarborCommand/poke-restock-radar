"use client";

import { Search, ShoppingCart, UserRound, Users } from "lucide-react";
import { useEffect, useState } from "react";
import styles from "./PosRegisterShell.module.css";

export type PosRegisterCustomer = {
  id: string;
  displayName: string;
  maskedEmail: string;
  maskedPhone: string | null;
  status: string;
  lastActivityAt: string | null;
  joinedAt: string;
  totalPurchaseCount: number;
  totalSpend: number;
  availablePoints: number;
};

type CustomerResponse = {
  customers?: PosRegisterCustomer[];
  pagination?: { total: number };
  error?: string;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function activityLabel(value: string | null, fallback: string) {
  const date = new Date(value || fallback);
  if (Number.isNaN(date.getTime())) return "No recent activity";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

export function PosCustomersView({ onCheckout }: { onCheckout: (customer: PosRegisterCustomer) => void }) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<PosRegisterCustomer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ sort: "activity", pageSize: "50" });
      if (query.trim()) params.set("search", query.trim());
      setLoading(true);
      void fetch(`/api/radar/pos/customer-search?${params}`, { credentials: "same-origin", cache: "no-store" })
        .then(async (response) => {
          const data = (await response.json()) as CustomerResponse;
          if (!response.ok) throw new Error(data.error || "Could not load customers.");
          if (!active) return;
          setCustomers(Array.isArray(data.customers) ? data.customers : []);
          setTotal(data.pagination?.total ?? 0);
          setError(null);
        })
        .catch((reason) => {
          if (active) setError(reason instanceof Error ? reason.message : "Could not load customers.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 240);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  return (
    <section className={styles.view} aria-label="POS customers">
      <div className={styles.viewHeader}>
        <div>
          <span className={styles.eyebrow}>Customer directory</span>
          <h1>Customers</h1>
          <p>Find a customer, check rewards and purchase history, then attach them from Checkout.</p>
        </div>
        <div className={styles.summaryPills}><span><b>{total}</b> customers</span></div>
      </div>

      <div className={styles.toolbarSingle}>
        <label className={styles.searchField}>
          <Search size={18} aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search name, email or phone"
            aria-label="Search POS customers"
          />
        </label>
      </div>

      {error ? <div className={styles.errorCard} role="alert">{error}</div> : null}
      {loading ? <div className={styles.loadingCard}>Loading customers…</div> : null}

      {!loading && !error ? (
        customers.length ? (
          <div className={styles.customerList}>
            {customers.map((customer) => (
              <article className={styles.customerRow} key={customer.id}>
                <span className={styles.avatar}><UserRound size={20} aria-hidden="true" /></span>
                <div className={styles.customerIdentity}>
                  <strong>{customer.displayName}</strong>
                  <small>{customer.maskedEmail}{customer.maskedPhone ? ` · ${customer.maskedPhone}` : ""}</small>
                </div>
                <div className={styles.customerMetric}>
                  <small>Rewards</small>
                  <strong>{customer.availablePoints.toLocaleString()} pts</strong>
                </div>
                <div className={styles.customerMetric}>
                  <small>Purchases</small>
                  <strong>{customer.totalPurchaseCount} · {money(customer.totalSpend)}</strong>
                </div>
                <div className={styles.customerMetric}>
                  <small>Last activity</small>
                  <strong>{activityLabel(customer.lastActivityAt, customer.joinedAt)}</strong>
                </div>
                <button className={styles.rowAction} type="button" onClick={() => onCheckout(customer)}>
                  <ShoppingCart size={16} aria-hidden="true" />
                  Checkout
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyCard}>
            <Users size={28} aria-hidden="true" />
            <strong>No customers found</strong>
            <span>Try another name, email or phone.</span>
          </div>
        )
      ) : null}
    </section>
  );
}
