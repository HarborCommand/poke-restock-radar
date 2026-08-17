"use client";

import { Check, ChevronLeft, CreditCard, UserRound } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import feedbackStyles from "./PosCustomerAttachFeedback.module.css";
import styles from "./PosSquareLikeFlow.module.css";

type FlowMode = "sale" | "customer" | "payment";

const SQUARE_PENDING_STORAGE_KEY = "gamedaygrabs-pos-square-pending-v1";
const SQUARE_PENDING_MAX_AGE_MS = 30 * 60 * 1000;

function parseMoneyText(value: string | null | undefined) {
  const numeric = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function currentTotalCents() {
  return Math.round(parseMoneyText(document.querySelector(".pos-total-box .total strong")?.textContent) * 100);
}

function currentCartCount() {
  return document.querySelectorAll(".pos-cart-lines > .pos-cart-line").length;
}

function currentAttachedCustomerName(panel: HTMLElement | null) {
  return (
    panel
      ?.querySelector<HTMLElement>(".pos-selected-customer .customer-profile-summary-card h4")
      ?.textContent?.trim() || null
  );
}

function moneyFromCents(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.max(0, cents) / 100);
}

function hasActiveSquarePending() {
  try {
    const raw =
      window.localStorage.getItem(SQUARE_PENDING_STORAGE_KEY) ||
      window.sessionStorage.getItem(SQUARE_PENDING_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { startedAt?: unknown };
    const startedAt = Number(parsed.startedAt);
    if (!Number.isFinite(startedAt)) return true;
    return Date.now() - startedAt <= SQUARE_PENDING_MAX_AGE_MS;
  } catch {
    return true;
  }
}

export function PosSquareLikeFlow() {
  const [mode, setMode] = useState<FlowMode>("sale");
  const [cartPanel, setCartPanel] = useState<HTMLElement | null>(null);
  const [cartHeader, setCartHeader] = useState<HTMLElement | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [totalCents, setTotalCents] = useState(0);
  const [attachedCustomerName, setAttachedCustomerName] = useState<string | null>(null);
  const [customerToast, setCustomerToast] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("data") || hasActiveSquarePending()) setMode("payment");
  }, []);

  useEffect(() => {
    let scheduled = false;

    const sync = () => {
      scheduled = false;
      const nextPanel = document.querySelector<HTMLElement>(".pos-cart-panel");
      const nextHeader = nextPanel?.querySelector<HTMLElement>(".pos-cart-header") ?? null;
      const nextCount = currentCartCount();
      const nextTotal = currentTotalCents();
      const nextCustomerName = currentAttachedCustomerName(nextPanel);

      setCartPanel((current) => (current === nextPanel ? current : nextPanel));
      setCartHeader((current) => (current === nextHeader ? current : nextHeader));
      setCartCount((current) => (current === nextCount ? current : nextCount));
      setTotalCents((current) => (current === nextTotal ? current : nextTotal));
      setAttachedCustomerName((current) => (current === nextCustomerName ? current : nextCustomerName));

      if (nextCount === 0) {
        window.setTimeout(() => {
          if (hasActiveSquarePending()) return;
          setMode((current) => (current === "payment" ? "sale" : current));
        }, 120);
      }
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(sync);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "aria-busy", "value"]
    });
    document.addEventListener("input", schedule, true);
    document.addEventListener("change", schedule, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("input", schedule, true);
      document.removeEventListener("change", schedule, true);
    };
  }, []);

  useEffect(() => {
    if (!customerToast) return;
    const timer = window.setTimeout(() => setCustomerToast(null), 2400);
    return () => window.clearTimeout(timer);
  }, [customerToast]);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-pos-authenticated="true"]');
    if (!root) return;

    const data = root.dataset;
    data.posSquareFlowMode = mode;
    return () => {
      if (data.posSquareFlowMode === mode) delete data.posSquareFlowMode;
    };
  }, [cartPanel, mode]);

  useEffect(() => {
    if (!cartPanel) return;
    if (mode === "payment" || mode === "customer") {
      cartPanel.setAttribute("role", "dialog");
      cartPanel.setAttribute("aria-modal", "true");
      cartPanel.setAttribute("aria-label", mode === "payment" ? "Payment" : "Attach customer");
    } else {
      cartPanel.removeAttribute("role");
      cartPanel.removeAttribute("aria-modal");
      cartPanel.removeAttribute("aria-label");
    }

    return () => {
      cartPanel.removeAttribute("role");
      cartPanel.removeAttribute("aria-modal");
      cartPanel.removeAttribute("aria-label");
    };
  }, [cartPanel, mode]);

  useEffect(() => {
    if (!cartPanel || mode !== "customer") return;

    const customerPanel = cartPanel.querySelector<HTMLElement>('.pos-customer-panel[aria-label="Optional customer contact"]');
    if (!customerPanel) return;

    const searchInput = customerPanel.querySelector<HTMLInputElement>('input[aria-label="Search customers by name, email, or phone"]');
    const focusTimer = window.setTimeout(() => {
      searchInput?.focus({ preventScroll: true });
      searchInput?.select();
    }, 90);

    let pendingCard: HTMLElement | null = null;
    let pendingCustomerName: string | null = null;
    let pendingSelection = false;

    const finishWhenSelected = () => {
      if (!pendingSelection) return;

      const attachedName = currentAttachedCustomerName(cartPanel);
      const cardSelected = Boolean(pendingCard?.classList.contains("selected"));
      if (!attachedName && !cardSelected) return;
      if (attachedName && pendingCustomerName && attachedName !== pendingCustomerName && !cardSelected) return;

      const selectedName = attachedName || pendingCustomerName || "Customer";
      pendingSelection = false;
      pendingCard = null;
      pendingCustomerName = null;
      setAttachedCustomerName(selectedName);
      setCustomerToast(selectedName);
      setMode("sale");
    };

    const handleCustomerClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>("button");
      if (!button || !button.textContent?.trim().toLowerCase().includes("select customer")) return;

      pendingCard = button.closest<HTMLElement>(".customer-search-profile-card");
      pendingCustomerName =
        pendingCard?.querySelector<HTMLElement>(".customer-search-profile-main strong")?.textContent?.trim() || null;
      pendingSelection = true;
      window.setTimeout(finishWhenSelected, 0);
    };

    customerPanel.addEventListener("click", handleCustomerClick, true);
    const observer = new MutationObserver(finishWhenSelected);
    observer.observe(customerPanel, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "disabled"]
    });

    return () => {
      window.clearTimeout(focusTimer);
      observer.disconnect();
      customerPanel.removeEventListener("click", handleCustomerClick, true);
    };
  }, [cartPanel, mode]);

  const backToSale = () => {
    if (mode === "payment" && hasActiveSquarePending()) {
      window.alert("Finish or cancel the current Square payment before leaving Payment.");
      return;
    }
    setMode("sale");
  };

  if (!cartPanel) return null;

  const chargeDisabled = cartCount <= 0 || totalCents <= 0;
  const customerAttached = Boolean(attachedCustomerName);

  return (
    <>
      {mode === "payment"
        ? createPortal(<div className="pos-payment-backdrop" aria-hidden="true" />, document.body)
        : mode === "customer"
          ? createPortal(<div className="pos-customer-backdrop" aria-hidden="true" />, document.body)
          : null}

      {customerToast
        ? createPortal(
            <div className={feedbackStyles.customerToast} role="status" aria-live="polite">
              <span className={feedbackStyles.customerToastIcon} aria-hidden="true">
                <Check size={18} />
              </span>
              <div>
                <strong>Customer attached</strong>
                <span>{customerToast}</span>
              </div>
            </div>,
            document.body
          )
        : null}

      {cartHeader && mode === "sale"
        ? createPortal(
            <button
              className={`${styles.customerButton}${customerAttached ? ` ${feedbackStyles.customerButtonAttached}` : ""}`}
              type="button"
              aria-label={
                customerAttached
                  ? `Customer attached: ${attachedCustomerName}. Tap to change customer.`
                  : "Attach customer to current sale"
              }
              title={customerAttached ? `Attached: ${attachedCustomerName}` : "Attach customer"}
              onClick={() => setMode("customer")}
            >
              {customerAttached ? <Check size={17} aria-hidden="true" /> : <UserRound size={17} aria-hidden="true" />}
              <span>{customerAttached ? "Customer attached" : "Customer"}</span>
            </button>,
            cartHeader
          )
        : null}

      {createPortal(
        <>
          {mode === "sale" ? (
            <div className={styles.chargeBar} aria-label="Checkout action">
              <div className={styles.saleSummary}>
                <span>{cartCount === 1 ? "1 item" : `${cartCount} items`}</span>
                <strong>{moneyFromCents(totalCents)}</strong>
              </div>
              <button
                className={styles.chargeButton}
                type="button"
                disabled={chargeDisabled}
                onClick={() => setMode("payment")}
              >
                <CreditCard size={19} aria-hidden="true" />
                <span>Charge {moneyFromCents(totalCents)}</span>
              </button>
            </div>
          ) : (
            <div className={styles.screenHeader}>
              <button type="button" onClick={backToSale} aria-label="Back to current sale">
                <ChevronLeft size={20} aria-hidden="true" />
                <span>Back</span>
              </button>
              <div>
                <small>Current sale</small>
                <strong>{mode === "payment" ? "Payment" : "Attach customer"}</strong>
              </div>
              <span className={styles.screenTotal}>{moneyFromCents(totalCents)}</span>
            </div>
          )}
        </>,
        cartPanel
      )}
    </>
  );
}
