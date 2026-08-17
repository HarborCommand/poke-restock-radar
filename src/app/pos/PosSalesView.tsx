"use client";

import {
  CheckCircle2,
  CreditCard,
  Mail,
  RefreshCw,
  RotateCcw,
  Search,
  ShoppingBag,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./PosRegisterShell.module.css";
import detailStyles from "./PosSalesView.module.css";

type PosHistoryLine = {
  title: string;
  quantity: number;
  unitPrice: number;
  originalUnitPrice: number | null;
  discountAmount: number;
  subtotal: number;
  tax: number;
  total: number;
  refundedAmount: number;
};

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
  lines?: PosHistoryLine[];
};

type HistoryResponse = { sales?: PosHistorySale[]; error?: string };
type MutationResponse = { sale?: unknown; error?: string; message?: string };
type RefundType = "full" | "partial";
type ActionMessage = { tone: "success" | "error"; text: string };

const refundReasons = [
  ["customer_return", "Customer return"],
  ["damaged_product", "Damaged product"],
  ["wrong_item", "Wrong item"],
  ["duplicate_sale", "Duplicate sale"],
  ["price_correction", "Price correction"],
  ["other", "Other"]
] as const;

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

function fullSaleTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function newActionKey(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}:${suffix}`;
}

function emailLooksValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = (await response.json().catch(() => ({}))) as MutationResponse;
  if (!response.ok) throw new Error(data.error || data.message || "The request could not be completed.");
  return data;
}

function fallbackLines(sale: PosHistorySale): PosHistoryLine[] {
  if (sale.lines?.length) return sale.lines;
  if (!sale.items.length) return [];
  const fallbackTotal = sale.items.length ? sale.subtotal / sale.items.length : 0;
  return sale.items.map((title) => ({
    title,
    quantity: 0,
    unitPrice: 0,
    originalUnitPrice: null,
    discountAmount: 0,
    subtotal: fallbackTotal,
    tax: 0,
    total: fallbackTotal,
    refundedAmount: 0
  }));
}

export function PosSalesView({ isAdmin = false }: { isAdmin?: boolean }) {
  const [sales, setSales] = useState<PosHistorySale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedSale, setSelectedSale] = useState<PosHistorySale | null>(null);
  const [alternateReceiptEmail, setAlternateReceiptEmail] = useState("");
  const [receiptSending, setReceiptSending] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundType, setRefundType] = useState<RefundType>("full");
  const [partialRefundAmount, setPartialRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState<(typeof refundReasons)[number][0]>("customer_return");
  const [refundNote, setRefundNote] = useState("");
  const [restoreInventory, setRestoreInventory] = useState(true);
  const [refundAcknowledged, setRefundAcknowledged] = useState(false);
  const [refundIdempotencyKey, setRefundIdempotencyKey] = useState(() => newActionKey("pos-refund"));
  const [refundSubmitting, setRefundSubmitting] = useState(false);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);

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

  useEffect(() => {
    if (!selectedSale) return;
    const refreshed = sales.find((sale) => sale.saleReference === selectedSale.saleReference);
    if (refreshed && refreshed !== selectedSale) setSelectedSale(refreshed);
  }, [sales]);

  useEffect(() => {
    if (!selectedSale) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !receiptSending && !refundSubmitting) setSelectedSale(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedSale, receiptSending, refundSubmitting]);

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

  function openSale(sale: PosHistorySale) {
    setSelectedSale(sale);
    setAlternateReceiptEmail("");
    setReceiptSending(false);
    setRefundOpen(false);
    setRefundType("full");
    setPartialRefundAmount("");
    setRefundReason("customer_return");
    setRefundNote("");
    setRestoreInventory(true);
    setRefundAcknowledged(false);
    setRefundIdempotencyKey(newActionKey("pos-refund"));
    setActionMessage(null);
  }

  function beginRefund() {
    setRefundOpen(true);
    setRefundType("full");
    setPartialRefundAmount("");
    setRestoreInventory(true);
    setRefundAcknowledged(false);
    setRefundIdempotencyKey(newActionKey("pos-refund"));
    setActionMessage(null);
  }

  function chooseRefundType(next: RefundType) {
    setRefundType(next);
    if (next === "partial") setRestoreInventory(false);
    else setRestoreInventory(true);
    setRefundAcknowledged(false);
  }

  async function resendReceipt() {
    if (!selectedSale || receiptSending) return;
    const email = alternateReceiptEmail.trim();
    if (!selectedSale.customerEmail && !email) {
      setActionMessage({ tone: "error", text: "This sale has no saved receipt email. Enter an email address first." });
      return;
    }
    if (email && !emailLooksValid(email)) {
      setActionMessage({ tone: "error", text: "Enter a valid email address for the receipt." });
      return;
    }

    setReceiptSending(true);
    setActionMessage(null);
    try {
      await postJson(`/api/radar/pos/sales/${encodeURIComponent(selectedSale.saleReference)}/receipt-email`, {
        email: email || undefined,
        idempotencyKey: newActionKey("pos-receipt-resend")
      });
      setActionMessage({
        tone: "success",
        text: email ? `Receipt sent to ${email}.` : "Receipt resent to the saved email address."
      });
      setAlternateReceiptEmail("");
    } catch (reason) {
      setActionMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Receipt could not be sent." });
    } finally {
      setReceiptSending(false);
    }
  }

  async function submitRefund() {
    if (!selectedSale || refundSubmitting) return;
    const remaining = Math.max(0, selectedSale.total - selectedSale.refundedAmount);
    const partialAmount = Number(partialRefundAmount);
    if (refundType === "partial" && (!Number.isFinite(partialAmount) || partialAmount <= 0 || partialAmount > remaining)) {
      setActionMessage({ tone: "error", text: `Enter a partial refund between $0.01 and ${money(remaining)}.` });
      return;
    }
    if (!refundAcknowledged) {
      setActionMessage({ tone: "error", text: "Confirm that the customer payment is being returned separately before recording the refund." });
      return;
    }

    setRefundSubmitting(true);
    setActionMessage(null);
    try {
      await postJson(`/api/radar/pos/sales/${encodeURIComponent(selectedSale.saleReference)}/refund`, {
        idempotencyKey: refundIdempotencyKey,
        refundType,
        partialRefundAmount: refundType === "partial" ? partialAmount : undefined,
        reason: refundReason,
        note: refundNote.trim() || undefined,
        restoreInventory: refundType === "full" ? restoreInventory : false
      });
      setActionMessage({
        tone: "success",
        text: refundType === "full"
          ? `Refund recorded for the remaining ${money(remaining)}${restoreInventory ? " and inventory was restored." : "."}`
          : `Partial refund of ${money(partialAmount)} recorded.`
      });
      setRefundOpen(false);
      setRefundAcknowledged(false);
      setRefundIdempotencyKey(newActionKey("pos-refund"));
      await load();
    } catch (reason) {
      setActionMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Refund could not be recorded." });
    } finally {
      setRefundSubmitting(false);
    }
  }

  const selectedLines = selectedSale ? fallbackLines(selectedSale) : [];
  const remainingRefundable = selectedSale ? Math.max(0, selectedSale.total - selectedSale.refundedAmount) : 0;
  const fullyRefunded = Boolean(selectedSale && remainingRefundable <= 0.005);
  const selectedStatus = selectedSale
    ? fullyRefunded
      ? "Fully refunded"
      : selectedSale.refundedAmount > 0
        ? "Partially refunded"
        : "Completed"
    : "Completed";

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
              <article
                className={`${styles.saleRow} ${detailStyles.clickableRow}`}
                key={sale.saleReference}
                role="button"
                tabIndex={0}
                aria-label={`Open sale ${sale.saleReference}`}
                onClick={() => openSale(sale)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  openSale(sale);
                }}
              >
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

      {selectedSale ? (
        <div className={detailStyles.backdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !receiptSending && !refundSubmitting) setSelectedSale(null);
        }}>
          <section className={detailStyles.modal} role="dialog" aria-modal="true" aria-label={`Sale ${selectedSale.saleReference}`}>
            <header className={detailStyles.modalHeader}>
              <div className={detailStyles.modalTitle}>
                <small>POS sale</small>
                <h2>{selectedSale.saleReference}</h2>
                <span>{fullSaleTime(selectedSale.completedAt)}</span>
              </div>
              <button
                type="button"
                className={detailStyles.closeButton}
                aria-label="Close sale details"
                disabled={receiptSending || refundSubmitting}
                onClick={() => setSelectedSale(null)}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className={detailStyles.modalBody}>
              <div className={detailStyles.summaryGrid}>
                <div className={detailStyles.summaryCard}>
                  <small>Status</small>
                  <span className={`${detailStyles.statusPill}${selectedSale.refundedAmount > 0 ? ` ${detailStyles.refunded}` : ""}`}>
                    <CheckCircle2 size={13} aria-hidden="true" />
                    {selectedStatus}
                  </span>
                </div>
                <div className={detailStyles.summaryCard}>
                  <small>Sale total</small>
                  <strong className={detailStyles.moneyValue}>{money(selectedSale.total)}</strong>
                </div>
                <div className={detailStyles.summaryCard}>
                  <small>Payment</small>
                  <strong>{selectedSale.paymentMethodLabel}</strong>
                </div>
                <div className={detailStyles.summaryCard}>
                  <small>Customer</small>
                  <strong>{selectedSale.customerName || "Guest"}</strong>
                </div>
              </div>

              <section className={detailStyles.section}>
                <div className={detailStyles.sectionHeader}>
                  <h3>Items</h3>
                  <span>{selectedSale.itemCount} item{selectedSale.itemCount === 1 ? "" : "s"}</span>
                </div>
                <div className={detailStyles.lineItems}>
                  {selectedLines.map((line, index) => (
                    <div className={detailStyles.lineItem} key={`${line.title}-${index}`}>
                      <div className={detailStyles.lineItemCopy}>
                        <strong>{line.title}</strong>
                        <small>
                          {line.quantity > 0 ? `${line.quantity} × ${money(line.unitPrice)}` : "Sale item"}
                          {line.discountAmount > 0 ? ` · discount ${money(line.discountAmount)} each` : ""}
                        </small>
                      </div>
                      <strong className={detailStyles.lineItemTotal}>{money(line.total)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <section className={detailStyles.section}>
                <div className={detailStyles.detailGrid}>
                  <div className={detailStyles.infoCard}>
                    <div className={detailStyles.infoRow}><span>Customer</span><strong>{selectedSale.customerName || "Guest"}</strong></div>
                    <div className={detailStyles.infoRow}><span>Email</span><strong>{selectedSale.customerEmail || "Not saved"}</strong></div>
                    <div className={detailStyles.infoRow}><span>Phone</span><strong>{selectedSale.customerPhone || "Not saved"}</strong></div>
                    <div className={detailStyles.infoRow}><span>Payment method</span><strong>{selectedSale.paymentMethodLabel}</strong></div>
                  </div>
                  <div className={detailStyles.totalsCard}>
                    <div className={detailStyles.totalRow}><span>Subtotal</span><strong>{money(selectedSale.subtotal)}</strong></div>
                    <div className={detailStyles.totalRow}><span>Sales tax</span><strong>{money(selectedSale.tax)}</strong></div>
                    <div className={`${detailStyles.totalRow} ${detailStyles.total}`}><span>Total</span><strong>{money(selectedSale.total)}</strong></div>
                    {selectedSale.refundedAmount > 0 ? (
                      <div className={`${detailStyles.totalRow} ${detailStyles.refund}`}><span>Refunded</span><strong>-{money(selectedSale.refundedAmount)}</strong></div>
                    ) : null}
                    <div className={detailStyles.totalRow}><span>Remaining sale value</span><strong>{money(remainingRefundable)}</strong></div>
                  </div>
                </div>
              </section>

              {actionMessage ? (
                <div className={`${detailStyles.actionMessage}${actionMessage.tone === "error" ? ` ${detailStyles.error}` : ""}`} role={actionMessage.tone === "error" ? "alert" : "status"}>
                  {actionMessage.tone === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
                  <span>{actionMessage.text}</span>
                </div>
              ) : null}

              {isAdmin ? (
                <section className={detailStyles.section}>
                  <div className={detailStyles.sectionHeader}>
                    <h3>Order actions</h3>
                    <span>Admin controls</span>
                  </div>
                  <div className={detailStyles.actionsGrid}>
                    <div className={detailStyles.actionCard}>
                      <h3>Resend receipt</h3>
                      <p>
                        {selectedSale.customerEmail
                          ? `The saved receipt email is ${selectedSale.customerEmail}. Leave the field blank to resend there.`
                          : "No receipt email is saved for this sale. Enter an email address to send a copy."}
                      </p>
                      <label className={detailStyles.field}>
                        {selectedSale.customerEmail ? "Different email (optional)" : "Receipt email"}
                        <input
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          value={alternateReceiptEmail}
                          onChange={(event) => setAlternateReceiptEmail(event.currentTarget.value)}
                          placeholder={selectedSale.customerEmail ? "Leave blank for saved email" : "customer@example.com"}
                        />
                      </label>
                      <button type="button" className={detailStyles.primaryAction} disabled={receiptSending || refundSubmitting} onClick={() => void resendReceipt()}>
                        <Mail size={16} aria-hidden="true" />
                        {receiptSending ? "Sending…" : "Resend receipt"}
                      </button>
                    </div>

                    <div className={detailStyles.actionCard}>
                      <h3>Refund</h3>
                      <p>
                        {fullyRefunded
                          ? "This sale is fully refunded."
                          : `${money(remainingRefundable)} remains refundable in the POS record.`}
                      </p>
                      <button
                        type="button"
                        className={detailStyles.refundAction}
                        disabled={fullyRefunded || receiptSending || refundSubmitting}
                        onClick={beginRefund}
                      >
                        <RotateCcw size={16} aria-hidden="true" />
                        {fullyRefunded ? "Fully refunded" : "Refund sale"}
                      </button>
                    </div>
                  </div>

                  {refundOpen && !fullyRefunded ? (
                    <div className={detailStyles.refundPanel}>
                      <div className={detailStyles.warningBox}>
                        <strong>Payment return is separate.</strong> This action records the refund in GameDayGrabs, updates tax/reward records, and can restore inventory on a full refund. It does not send money through Square, Zelle, or another payment provider. Return the customer's payment separately before recording it here.
                      </div>

                      <div className={detailStyles.refundMode} aria-label="Refund type">
                        <button type="button" className={refundType === "full" ? detailStyles.activeRefundMode : ""} onClick={() => chooseRefundType("full")}>Full remaining refund</button>
                        <button type="button" className={refundType === "partial" ? detailStyles.activeRefundMode : ""} onClick={() => chooseRefundType("partial")}>Partial refund</button>
                      </div>

                      {refundType === "partial" ? (
                        <label className={detailStyles.field}>
                          Partial refund amount
                          <input
                            type="number"
                            inputMode="decimal"
                            min="0.01"
                            max={remainingRefundable.toFixed(2)}
                            step="0.01"
                            value={partialRefundAmount}
                            onChange={(event) => setPartialRefundAmount(event.currentTarget.value)}
                            placeholder={remainingRefundable.toFixed(2)}
                          />
                        </label>
                      ) : null}

                      <label className={detailStyles.field}>
                        Refund reason
                        <select value={refundReason} onChange={(event) => setRefundReason(event.currentTarget.value as (typeof refundReasons)[number][0])}>
                          {refundReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>

                      <label className={detailStyles.field}>
                        Internal note (optional)
                        <textarea value={refundNote} onChange={(event) => setRefundNote(event.currentTarget.value)} placeholder="Return details, condition, or payment-return reference" />
                      </label>

                      {refundType === "full" ? (
                        <label className={detailStyles.checkboxRow}>
                          <input type="checkbox" checked={restoreInventory} onChange={(event) => setRestoreInventory(event.currentTarget.checked)} />
                          <span>Restore the sold quantities to POS inventory.</span>
                        </label>
                      ) : (
                        <div className={detailStyles.warningBox}>Partial refunds do not automatically restore inventory because item-level return quantities are not being selected.</div>
                      )}

                      <label className={detailStyles.checkboxRow}>
                        <input type="checkbox" checked={refundAcknowledged} onChange={(event) => setRefundAcknowledged(event.currentTarget.checked)} />
                        <span>I confirm the customer's payment has been returned, or I am handling the payment return separately.</span>
                      </label>

                      <div className={detailStyles.actionsGrid}>
                        <button type="button" className={detailStyles.secondaryAction} disabled={refundSubmitting} onClick={() => {
                          setRefundOpen(false);
                          setRefundAcknowledged(false);
                          setActionMessage(null);
                        }}>Cancel</button>
                        <button type="button" className={detailStyles.refundAction} disabled={refundSubmitting || !refundAcknowledged} onClick={() => void submitRefund()}>
                          <RotateCcw size={16} aria-hidden="true" />
                          {refundSubmitting
                            ? "Recording…"
                            : refundType === "full"
                              ? `Record refund ${money(remainingRefundable)}`
                              : partialRefundAmount && Number(partialRefundAmount) > 0
                                ? `Record refund ${money(Number(partialRefundAmount))}`
                                : "Record partial refund"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : (
                <div className={detailStyles.adminOnlyNote}>Receipt resend and refund controls require an Admin account.</div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
