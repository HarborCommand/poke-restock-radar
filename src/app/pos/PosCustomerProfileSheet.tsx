"use client";

import {
  CalendarDays,
  Mail,
  MapPin,
  Phone,
  ReceiptText,
  Save,
  ShoppingCart,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PosRegisterCustomer } from "./PosCustomersView";
import styles from "./PosCustomerProfileSheet.module.css";

type PosCustomerDetail = PosRegisterCustomer & {
  email: string;
  savedAddressCount: number;
  defaultAddressSummary: string | null;
  profile: {
    displayName: string;
    phone: string | null;
    status: string;
    adminNote: string | null;
  };
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    total: number;
    refundedAmount: number;
    createdAt: string;
  }>;
  recentPosSales: Array<{
    id: string;
    saleReference: string;
    total: number;
    refundStatus: string | null;
    soldAt: string;
  }>;
};

type CustomerDetailResponse = {
  customer?: PosCustomerDetail;
  error?: string;
};

type Props = {
  customer: PosRegisterCustomer;
  onClose: () => void;
  onCheckout: (customer: PosRegisterCustomer) => void;
  onUpdated: (customer: PosRegisterCustomer) => void;
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function normalizeInput(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function PosCustomerProfileSheet({ customer, onClose, onCheckout, onUpdated }: Props) {
  const [detail, setDetail] = useState<PosCustomerDetail | null>(null);
  const [displayName, setDisplayName] = useState(customer.displayName);
  const [phone, setPhone] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setSaved(false);

    void fetch(`/api/radar/pos/customers/${encodeURIComponent(customer.id)}`, {
      credentials: "same-origin",
      cache: "no-store"
    })
      .then(async (response) => {
        const data = (await response.json()) as CustomerDetailResponse;
        if (!response.ok || !data.customer) throw new Error(data.error || "Could not load customer profile.");
        if (!active) return;
        setDetail(data.customer);
        setDisplayName(data.customer.profile.displayName || data.customer.displayName);
        setPhone(data.customer.profile.phone || "");
        setAdminNote(data.customer.profile.adminNote || "");
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load customer profile.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [customer.id, customer.displayName]);

  const hasChanges = useMemo(() => {
    if (!detail) return false;
    return (
      displayName.trim() !== (detail.profile.displayName || detail.displayName).trim() ||
      phone.trim() !== (detail.profile.phone || "").trim() ||
      adminNote.trim() !== (detail.profile.adminNote || "").trim()
    );
  }, [adminNote, detail, displayName, phone]);

  async function saveProfile() {
    if (!detail || saving || !hasChanges) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch(`/api/radar/pos/customers/${encodeURIComponent(customer.id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: normalizeInput(displayName),
          phone: normalizeInput(phone),
          adminNote: normalizeInput(adminNote)
        })
      });
      const data = (await response.json()) as CustomerDetailResponse;
      if (!response.ok || !data.customer) throw new Error(data.error || "Could not save customer profile.");

      setDetail(data.customer);
      setDisplayName(data.customer.profile.displayName || data.customer.displayName);
      setPhone(data.customer.profile.phone || "");
      setAdminNote(data.customer.profile.adminNote || "");
      setSaved(true);
      onUpdated(data.customer);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save customer profile.");
    } finally {
      setSaving(false);
    }
  }

  const checkoutCustomer = detail ?? customer;

  return (
    <div
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside className={styles.sheet} role="dialog" aria-modal="true" aria-label={`Customer profile for ${customer.displayName}`}>
        <header className={styles.header}>
          <div className={styles.customerHeading}>
            <span className={styles.avatar}><UserRound size={24} aria-hidden="true" /></span>
            <div>
              <span>Customer profile</span>
              <strong>{detail?.displayName || customer.displayName}</strong>
            </div>
          </div>
          <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Close customer profile">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.body}>
          {loading ? <div className={styles.loading}>Loading customer profile…</div> : null}
          {error ? <div className={styles.error} role="alert">{error}</div> : null}

          {detail ? (
            <>
              <section className={styles.summaryGrid} aria-label="Customer summary">
                <div><span>Rewards</span><strong>{detail.availablePoints.toLocaleString()} pts</strong></div>
                <div><span>Purchases</span><strong>{detail.totalPurchaseCount}</strong></div>
                <div><span>Total spend</span><strong>{money(detail.totalSpend)}</strong></div>
              </section>

              <section className={styles.contactCard}>
                <div className={styles.contactLine}><Mail size={17} aria-hidden="true" /><span>{detail.email}</span></div>
                <div className={styles.contactLine}><Phone size={17} aria-hidden="true" /><span>{detail.profile.phone || "No phone saved"}</span></div>
                <div className={styles.contactLine}><CalendarDays size={17} aria-hidden="true" /><span>Customer since {dateLabel(detail.joinedAt)}</span></div>
                {detail.defaultAddressSummary ? (
                  <div className={styles.contactLine}><MapPin size={17} aria-hidden="true" /><span>{detail.defaultAddressSummary}</span></div>
                ) : null}
              </section>

              <section className={styles.section}>
                <div className={styles.sectionTitle}>
                  <div><span>Contact information</span><strong>Edit customer</strong></div>
                  <span className={detail.profile.status === "disabled" ? styles.statusDisabled : styles.statusActive}>
                    {detail.profile.status === "disabled" ? "Disabled" : "Active"}
                  </span>
                </div>

                <div className={styles.formGrid}>
                  <label>
                    <span>Name</span>
                    <input value={displayName} onChange={(event) => setDisplayName(event.currentTarget.value)} maxLength={120} />
                  </label>
                  <label>
                    <span>Phone number</span>
                    <input
                      value={phone}
                      onChange={(event) => setPhone(event.currentTarget.value)}
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="Add phone number"
                      maxLength={40}
                    />
                  </label>
                  <label className={styles.fullField}>
                    <span>Email</span>
                    <input value={detail.email} readOnly aria-readonly="true" />
                    <small>Email is read-only here because it is tied to the customer's account sign-in.</small>
                  </label>
                  <label className={styles.fullField}>
                    <span>Staff note</span>
                    <textarea
                      value={adminNote}
                      onChange={(event) => setAdminNote(event.currentTarget.value)}
                      placeholder="Optional note for staff"
                      maxLength={1000}
                    />
                  </label>
                </div>

                <button className={styles.saveButton} type="button" disabled={!hasChanges || saving} onClick={() => void saveProfile()}>
                  <Save size={17} aria-hidden="true" />
                  {saving ? "Saving…" : saved ? "Saved" : "Save Changes"}
                </button>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionTitle}><div><span>Recent activity</span><strong>Orders & POS sales</strong></div></div>
                <div className={styles.activityList}>
                  {detail.recentPosSales.map((sale) => (
                    <div className={styles.activityRow} key={`pos-${sale.id}`}>
                      <span className={styles.activityIcon}><ReceiptText size={17} aria-hidden="true" /></span>
                      <div><strong>{sale.saleReference}</strong><small>POS · {dateLabel(sale.soldAt)}</small></div>
                      <b>{money(sale.total)}</b>
                    </div>
                  ))}
                  {detail.recentOrders.map((order) => (
                    <div className={styles.activityRow} key={`order-${order.id}`}>
                      <span className={styles.activityIcon}><ShoppingCart size={17} aria-hidden="true" /></span>
                      <div><strong>{order.orderNumber}</strong><small>Online · {dateLabel(order.createdAt)}</small></div>
                      <b>{money(Math.max(0, order.total - order.refundedAmount))}</b>
                    </div>
                  ))}
                  {!detail.recentPosSales.length && !detail.recentOrders.length ? (
                    <div className={styles.noActivity}>No purchases yet.</div>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <button className={styles.checkoutButton} type="button" onClick={() => onCheckout(checkoutCustomer)}>
            <ShoppingCart size={18} aria-hidden="true" />
            Use in Checkout
          </button>
        </footer>
      </aside>
    </div>
  );
}
