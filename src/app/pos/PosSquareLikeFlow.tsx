"use client";

import { ChevronLeft, CreditCard, UserRound } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
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

      setCartPanel((current) => (current === nextPanel ? current : nextPanel));
      setCartHeader((current) => (current === nextHeader ? current : nextHeader));
      setCartCount((current) => (current === nextCount ? current : nextCount));
      setTotalCents((current) => (current === nextTotal ? current : nextTotal));

      if (nextCount === 0) {
        window.setTimeout(() => {
          if (!hasActiveSquarePending()) setMode("sale");
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
    const root = document.querySelector<HTMLElement>('[data-pos-authenticated="true"]');
    if (!root) return;

    root.dataset.posSquareFlowMode = mode;
    return () => {
      if (root.dataset.posSquareFlowMode === mode) delete root.dataset.posSquareFlowMode;
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

  return (
    <>
      {cartHeader && mode === "sale"
        ? createPortal(
            <button className={styles.customerButton} type="button" onClick={() => setMode("customer")}>
              <UserRound size={17} aria-hidden="true" />
              <span>Customer</span>
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
                <strong>{mode === "payment" ? "Payment" : "Customer"}</strong>
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
