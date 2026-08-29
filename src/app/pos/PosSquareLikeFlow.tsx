"use client";

import { Check, ChevronLeft, CreditCard, UserRound } from "lucide-react";
import { createPortal } from "react-dom";
import { type CSSProperties, useEffect, useState } from "react";
import feedbackStyles from "./PosCustomerAttachFeedback.module.css";
import styles from "./PosSquareLikeFlow.module.css";

type FlowMode = "sale" | "customer" | "payment";
type FloatingActionStyle = Pick<CSSProperties, "left" | "transform" | "width"> & {
  "--pos-checkout-dock-left"?: string;
  "--pos-checkout-dock-right"?: string;
  "--pos-checkout-dock-transform"?: string;
  "--pos-checkout-dock-width"?: string;
};

const SQUARE_PENDING_STORAGE_KEY = "gamedaygrabs-pos-square-pending-v1";
const SQUARE_PENDING_MAX_AGE_MS = 30 * 60 * 1000;
const FLOATING_ACTION_SIDE_MARGIN = 14;
const FLOATING_ACTION_MIN_PANEL_WIDTH = 260;
const FLOATING_ACTION_MAX_WIDTH = 540;

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

function compactButtonText(value: string | null | undefined) {
  return String(value || "Complete Sale").replace(/\s+/g, " ").trim() || "Complete Sale";
}

function completeButtonIsDisabled(button: HTMLButtonElement | null) {
  if (!button) return true;
  return (
    button.disabled ||
    button.classList.contains("inactive") ||
    button.getAttribute("aria-disabled") === "true" ||
    button.getAttribute("data-cash-disabled") === "true" ||
    button.getAttribute("data-square-disabled") === "true"
  );
}

function visibleViewportBounds() {
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  const left = viewport?.offsetLeft ?? 0;
  const height = viewport?.height ?? window.innerHeight;
  const width = viewport?.width ?? window.innerWidth;
  return {
    top,
    left,
    right: left + width,
    bottom: top + height
  };
}

function elementIsCheckoutVisible(element: HTMLElement | null) {
  if (!element || !element.isConnected) return false;
  const computed = window.getComputedStyle(element);
  if (computed.display === "none" || computed.visibility === "hidden" || Number(computed.opacity) <= 0.01) return false;

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const viewport = visibleViewportBounds();
  const visibleHeight = Math.max(0, Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top));
  const visibleWidth = Math.max(0, Math.min(rect.right, viewport.right) - Math.max(rect.left, viewport.left));
  return visibleHeight >= Math.min(rect.height, 44) && visibleWidth >= Math.min(rect.width, 160);
}

function floatingDockStyleForCartPanel(cartPanel: HTMLElement | null): FloatingActionStyle {
  if (!cartPanel || !cartPanel.isConnected) return {};

  const rect = cartPanel.getBoundingClientRect();
  const viewport = visibleViewportBounds();
  const leftBound = viewport.left + FLOATING_ACTION_SIDE_MARGIN;
  const rightBound = viewport.right - FLOATING_ACTION_SIDE_MARGIN;
  const panelLeft = Math.max(rect.left, leftBound);
  const panelRight = Math.min(rect.right, rightBound);
  const panelWidth = panelRight - panelLeft;

  if (panelWidth < FLOATING_ACTION_MIN_PANEL_WIDTH) return {};

  const width = Math.min(FLOATING_ACTION_MAX_WIDTH, panelWidth);
  const left = Math.min(Math.max(panelLeft + (panelWidth - width) / 2, leftBound), rightBound - width);
  return {
    left: `${Math.round(left)}px`,
    transform: "none",
    width: `${Math.round(width)}px`,
    "--pos-checkout-dock-left": `${Math.round(left)}px`,
    "--pos-checkout-dock-right": "auto",
    "--pos-checkout-dock-transform": "none",
    "--pos-checkout-dock-width": `${Math.round(width)}px`
  };
}

function sameFloatingActionStyle(current: FloatingActionStyle, next: FloatingActionStyle) {
  return (
    current.left === next.left &&
    current.transform === next.transform &&
    current.width === next.width &&
    current["--pos-checkout-dock-left"] === next["--pos-checkout-dock-left"] &&
    current["--pos-checkout-dock-right"] === next["--pos-checkout-dock-right"] &&
    current["--pos-checkout-dock-transform"] === next["--pos-checkout-dock-transform"] &&
    current["--pos-checkout-dock-width"] === next["--pos-checkout-dock-width"]
  );
}

export function PosSquareLikeFlow() {
  const [mode, setMode] = useState<FlowMode>("sale");
  const [cartPanel, setCartPanel] = useState<HTMLElement | null>(null);
  const [cartHeader, setCartHeader] = useState<HTMLElement | null>(null);
  const [completeButton, setCompleteButton] = useState<HTMLButtonElement | null>(null);
  const [completeButtonLabel, setCompleteButtonLabel] = useState("Complete Sale");
  const [completeButtonDisabled, setCompleteButtonDisabled] = useState(true);
  const [completeButtonVisible, setCompleteButtonVisible] = useState(true);
  const [floatingActionStyle, setFloatingActionStyle] = useState<FloatingActionStyle>({});
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
      const nextCompleteButton = document.querySelector<HTMLButtonElement>(".pos-complete-button");
      const nextCompleteLabel = compactButtonText(nextCompleteButton?.textContent);
      const nextCompleteDisabled = completeButtonIsDisabled(nextCompleteButton);

      setCartPanel((current) => (current === nextPanel ? current : nextPanel));
      setCartHeader((current) => (current === nextHeader ? current : nextHeader));
      setCompleteButton((current) => (current === nextCompleteButton ? current : nextCompleteButton));
      setCompleteButtonLabel((current) => (current === nextCompleteLabel ? current : nextCompleteLabel));
      setCompleteButtonDisabled((current) => (current === nextCompleteDisabled ? current : nextCompleteDisabled));
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
      attributeFilter: ["class", "disabled", "aria-busy", "aria-disabled", "data-cash-disabled", "data-square-disabled", "value"]
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
    let frame = 0;

    const syncVisibility = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const nextCompleteVisible = mode !== "payment" || elementIsCheckoutVisible(completeButton);
        const nextFloatingActionStyle = floatingDockStyleForCartPanel(cartPanel);
        setCompleteButtonVisible((current) => (current === nextCompleteVisible ? current : nextCompleteVisible));
        setFloatingActionStyle((current) =>
          sameFloatingActionStyle(current, nextFloatingActionStyle) ? current : nextFloatingActionStyle
        );
      });
    };

    syncVisibility();
    const observer = new MutationObserver(syncVisibility);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "aria-hidden", "aria-disabled", "data-cash-disabled", "data-square-disabled", "style"]
    });
    document.addEventListener("scroll", syncVisibility, true);
    window.addEventListener("resize", syncVisibility, { passive: true });
    window.addEventListener("orientationchange", syncVisibility, { passive: true });
    window.visualViewport?.addEventListener("resize", syncVisibility, { passive: true });
    window.visualViewport?.addEventListener("scroll", syncVisibility, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("scroll", syncVisibility, true);
      window.removeEventListener("resize", syncVisibility);
      window.removeEventListener("orientationchange", syncVisibility);
      window.visualViewport?.removeEventListener("resize", syncVisibility);
      window.visualViewport?.removeEventListener("scroll", syncVisibility);
    };
  }, [cartPanel, completeButton, mode]);

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

  const completeVisibleSale = () => {
    const button = completeButton ?? document.querySelector<HTMLButtonElement>(".pos-complete-button");
    if (!button || completeButtonIsDisabled(button)) {
      button?.scrollIntoView({ block: "nearest", inline: "nearest" });
      return;
    }
    button.click();
  };

  if (!cartPanel) return null;

  const chargeDisabled = cartCount <= 0 || totalCents <= 0;
  const customerAttached = Boolean(attachedCustomerName);
  const showPinnedComplete = mode === "payment" && cartCount > 0 && !completeButtonVisible;

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

      {showPinnedComplete
        ? createPortal(
            <div
              className={styles.floatingActionDock}
              style={floatingActionStyle}
              aria-label="Pinned complete sale action"
            >
              <button
                className={`${styles.floatingChargeButton} ${styles.floatingCompleteButton}`}
                type="button"
                disabled={completeButtonDisabled}
                onClick={completeVisibleSale}
              >
                <Check size={19} aria-hidden="true" />
                <span>{completeButtonLabel}</span>
              </button>
            </div>,
            document.body
          )
        : null}

      {createPortal(
        <>
          {mode === "sale" ? (
            <div
              className={styles.chargeBar}
              aria-label="Checkout action"
            >
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
