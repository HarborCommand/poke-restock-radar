"use client";

import { CheckCircle2, CreditCard, LoaderCircle, TriangleAlert } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./PosSquarePayment.module.css";

type SquareConfig = {
  enabled: boolean;
  applicationId: string | null;
  locationId: string | null;
  callbackUrl: string;
};

type SquareCallbackData = {
  status?: string;
  transaction_id?: string;
  client_transaction_id?: string;
  error_code?: string;
  state?: string;
};

type PendingSquarePayment = {
  state: string;
  totalCents: number;
  cartSignature: string;
  startedAt: number;
};

type ApprovedSquarePayment = {
  transactionId: string;
  state: string;
};

const PENDING_STORAGE_KEY = "gamedaygrabs-pos-square-pending-v1";
const MAX_PENDING_AGE_MS = 30 * 60 * 1000;

function parseMoneyText(value: string | null | undefined) {
  const numeric = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function currentTotalCents() {
  return Math.round(parseMoneyText(document.querySelector(".pos-total-box .total strong")?.textContent) * 100);
}

function currentCartSignature() {
  return Array.from(document.querySelectorAll<HTMLElement>(".pos-cart-line"))
    .map((line) => {
      const title = line.querySelector(".pos-cart-line-copy strong")?.textContent?.trim() || "";
      const identifier = line.querySelector(".pos-cart-line-copy > span")?.textContent?.trim() || "";
      const quantity = line.querySelector<HTMLInputElement>('input[aria-label="Quantity"]')?.value || "1";
      return `${title}\u001f${identifier}\u001f${quantity}`;
    })
    .join("\u001e");
}

function squarePaymentButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".pos-payment")).find((button) => {
    const label = String(button.textContent || "").trim().toLowerCase();
    return label.includes("square") || label.includes("external card");
  }) ?? null;
}

function squarePaymentActive() {
  const active = document.querySelector<HTMLButtonElement>(".pos-payment.active");
  if (!active) return false;
  const label = String(active.textContent || "").trim().toLowerCase();
  return label.includes("square") || label.includes("external card");
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function loadPendingPayment(): PendingSquarePayment | null {
  try {
    const raw = window.localStorage.getItem(PENDING_STORAGE_KEY) || window.sessionStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingSquarePayment>;
    const state = String(parsed.state || "").trim();
    const totalCents = Number(parsed.totalCents);
    const cartSignature = String(parsed.cartSignature || "");
    const startedAt = Number(parsed.startedAt);
    if (!state || !Number.isInteger(totalCents) || totalCents <= 0 || !cartSignature || !Number.isFinite(startedAt)) return null;
    if (Date.now() - startedAt > MAX_PENDING_AGE_MS) return null;
    return { state, totalCents, cartSignature, startedAt };
  } catch {
    return null;
  }
}

function savePendingPayment(pending: PendingSquarePayment) {
  const value = JSON.stringify(pending);
  window.localStorage.setItem(PENDING_STORAGE_KEY, value);
  window.sessionStorage.setItem(PENDING_STORAGE_KEY, value);
}

function clearPendingPayment() {
  window.localStorage.removeItem(PENDING_STORAGE_KEY);
  window.sessionStorage.removeItem(PENDING_STORAGE_KEY);
}

function cleanSquareCallbackFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("data")) return;
  url.searchParams.delete("data");
  window.history.replaceState(window.history.state, "", url);
}

function buildSquareUrl(config: SquareConfig, pending: PendingSquarePayment) {
  const data = {
    amount_money: {
      amount: String(pending.totalCents),
      currency_code: "USD"
    },
    callback_url: config.callbackUrl,
    client_id: config.applicationId,
    version: "1.3",
    location_id: config.locationId,
    state: pending.state,
    notes: `GameDayGrabs POS · ${pending.state.slice(0, 18)}`,
    options: {
      supported_tender_types: ["CREDIT_CARD"],
      clear_default_fees: true,
      auto_return: true,
      skip_receipt: true
    }
  };
  return `square-commerce-v1://payment/create?data=${encodeURIComponent(JSON.stringify(data))}`;
}

function newStateToken() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `gdg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function moneyFromCents(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.max(0, cents) / 100);
}

export function PosSquarePayment() {
  const [config, setConfig] = useState<SquareConfig | null>(null);
  const [mountPoint, setMountPoint] = useState<HTMLElement | null>(null);
  const [squareActive, setSquareActive] = useState(false);
  const [totalCents, setTotalCents] = useState(0);
  const [cartSignature, setCartSignature] = useState("");
  const [pending, setPending] = useState<PendingSquarePayment | null>(null);
  const [approved, setApproved] = useState<ApprovedSquarePayment | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [returnError, setReturnError] = useState<string | null>(null);
  const handledCallbackRef = useRef(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/radar/pos/square/config", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { square?: SquareConfig; error?: string };
        if (!response.ok || !payload.square) throw new Error(payload.error || "Square setup could not be loaded.");
        if (active) setConfig(payload.square);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "Square setup could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (handledCallbackRef.current) return;
    const url = new URL(window.location.href);
    const rawData = url.searchParams.get("data");
    if (!rawData) return;
    handledCallbackRef.current = true;

    const savedPending = loadPendingPayment();
    setPending(savedPending);

    try {
      const result = JSON.parse(rawData) as SquareCallbackData;
      if (result.status !== "ok") {
        const code = String(result.error_code || "payment_canceled").replace(/_/g, " ");
        setReturnError(`Square payment was not completed (${code}).`);
        clearPendingPayment();
        setPending(null);
        return;
      }
      const transactionId = String(result.transaction_id || "").trim();
      const state = String(result.state || "").trim();
      if (!savedPending) throw new Error("The pending Square checkout could not be restored.");
      if (!state || state !== savedPending.state) throw new Error("The Square return did not match this checkout.");
      if (!transactionId) {
        throw new Error("Square did not return an online transaction ID. Reconnect before completing this sale.");
      }
      setApproved({ transactionId, state });
      setMessage("Square approved the card payment. Confirm the restored cart, then complete the sale.");
    } catch (error) {
      setReturnError(error instanceof Error ? error.message : "Square returned an invalid payment result.");
    } finally {
      cleanSquareCallbackFromUrl();
    }
  }, []);

  useEffect(() => {
    const existingPending = loadPendingPayment();
    if (existingPending && !pending) setPending(existingPending);

    let scheduled = false;
    let selectedReturnCard = false;
    const sync = () => {
      scheduled = false;
      const panel = document.querySelector<HTMLElement>(".pos-payment-panel");
      const nextActive = squarePaymentActive();
      const nextTotal = currentTotalCents();
      const nextCartSignature = currentCartSignature();
      setMountPoint((current) => (current === panel ? current : panel));
      setSquareActive(nextActive);
      setTotalCents((current) => (current === nextTotal ? current : nextTotal));
      setCartSignature((current) => (current === nextCartSignature ? current : nextCartSignature));

      if (approved && !selectedReturnCard) {
        const button = squarePaymentButton();
        if (button && !nextActive) {
          selectedReturnCard = true;
          button.click();
        }
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
  }, [approved, pending]);

  const cartMatchesApprovedPayment = useMemo(() => {
    if (!approved || !pending || totalCents <= 0 || totalCents !== pending.totalCents) return false;
    return cartSignature === pending.cartSignature;
  }, [approved, cartSignature, pending, totalCents]);

  useEffect(() => {
    const referenceLabel = document.querySelector<HTMLElement>(".pos-reference-input");
    const referenceInput = referenceLabel?.querySelector<HTMLInputElement>("input") ?? null;
    if (!referenceLabel || !referenceInput) return;

    if (!squareActive) {
      referenceLabel.style.display = "";
      return;
    }

    referenceLabel.style.display = "none";
    const reference = approved && cartMatchesApprovedPayment ? `square:${approved.transactionId}` : "";
    if (referenceInput.value !== reference) setControlledInputValue(referenceInput, reference);

    return () => {
      referenceLabel.style.display = "";
    };
  }, [approved, cartMatchesApprovedPayment, squareActive]);

  useEffect(() => {
    if (!squareActive) return;
    const completeButton = document.querySelector<HTMLButtonElement>(".pos-complete-button");
    if (!completeButton) return;
    if (!approved || !cartMatchesApprovedPayment) {
      completeButton.setAttribute("data-square-disabled", "true");
      completeButton.setAttribute("aria-disabled", "true");
    } else {
      completeButton.removeAttribute("data-square-disabled");
      completeButton.removeAttribute("aria-disabled");
    }
  }, [approved, cartMatchesApprovedPayment, squareActive, totalCents]);

  useEffect(() => {
    const blockUnpaidSquareCompletion = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest(".pos-complete-button") : null;
      if (!target || !squarePaymentActive()) return;

      const currentTotal = currentTotalCents();
      const signature = currentCartSignature();
      if (approved && pending && currentTotal === pending.totalCents && signature === pending.cartSignature) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (approved) {
        setReturnError("The cart changed after Square approved the payment. Do not charge the card again; restore the paid cart before completing the sale.");
      } else {
        setReturnError(null);
        setMessage("Pay with Square first. Complete Sale unlocks after Square approves the card.");
      }
    };

    document.addEventListener("click", blockUnpaidSquareCompletion, true);
    return () => document.removeEventListener("click", blockUnpaidSquareCompletion, true);
  }, [approved, pending]);

  useEffect(() => {
    if (!approved || !cartMatchesApprovedPayment) return;
    const observer = new MutationObserver(() => {
      if (document.querySelectorAll(".pos-cart-line").length > 0) return;
      clearPendingPayment();
      setPending(null);
      setApproved(null);
      setMessage(null);
      observer.disconnect();
    });
    observer.observe(document.body, { subtree: true, childList: true });
    return () => observer.disconnect();
  }, [approved, cartMatchesApprovedPayment]);

  const startSquarePayment = () => {
    setReturnError(null);
    if (!config?.enabled || !config.applicationId || !config.locationId) {
      setMessage("Square still needs to be connected before card checkout can start.");
      return;
    }

    const currentTotal = currentTotalCents();
    const signature = currentCartSignature();
    if (currentTotal <= 0 || !signature) {
      setMessage("Add an item and wait for the final total before starting Square.");
      return;
    }

    const nextPending: PendingSquarePayment = {
      state: newStateToken(),
      totalCents: currentTotal,
      cartSignature: signature,
      startedAt: Date.now()
    };
    savePendingPayment(nextPending);
    setPending(nextPending);
    setApproved(null);
    setMessage("Opening Square…");
    window.location.href = buildSquareUrl(config, nextPending);
  };

  if (!mountPoint || !squareActive) return null;

  const configured = Boolean(config?.enabled);
  const waitingForReturn = Boolean(pending && !approved && !returnError);
  const canStartPayment = configured && totalCents > 0 && Boolean(cartSignature) && !waitingForReturn;

  return createPortal(
    <section className={styles.card} aria-label="Square card payment">
      <div className={styles.heading}>
        <span className={styles.icon}><CreditCard size={20} aria-hidden="true" /></span>
        <div>
          <strong>Square card payment</strong>
          <small>Customer pays securely in the Square POS app.</small>
        </div>
      </div>

      {approved && cartMatchesApprovedPayment ? (
        <div className={`${styles.status} ${styles.success}`}>
          <CheckCircle2 size={20} aria-hidden="true" />
          <div><strong>Payment approved</strong><small>Tap Complete Sale to record it in GameDayGrabs.</small></div>
        </div>
      ) : approved ? (
        <div className={`${styles.status} ${styles.warning}`}>
          <TriangleAlert size={20} aria-hidden="true" />
          <div><strong>Paid cart needs attention</strong><small>The restored cart does not match the Square charge.</small></div>
        </div>
      ) : waitingForReturn ? (
        <div className={`${styles.status} ${styles.waiting}`}>
          <LoaderCircle className={styles.spin} size={20} aria-hidden="true" />
          <div><strong>Square checkout pending</strong><small>Finish or cancel the payment in Square.</small></div>
        </div>
      ) : (
        <div className={`${styles.status} ${configured ? styles.ready : styles.warning}`}>
          {configured ? <CreditCard size={20} aria-hidden="true" /> : <TriangleAlert size={20} aria-hidden="true" />}
          <div>
            <strong>{configured ? "Ready for Square" : "Connect Square to enable cards"}</strong>
            <small>{configured ? "Tap Pay with Square to send the exact POS total to the Square app." : "Cash checkout remains available while Square is being connected."}</small>
          </div>
        </div>
      )}

      {!approved && !waitingForReturn && configured ? (
        <button
          type="button"
          className={styles.payButton}
          onClick={startSquarePayment}
          disabled={!canStartPayment}
        >
          <CreditCard size={18} aria-hidden="true" />
          <span>Pay {moneyFromCents(totalCents)} with Square</span>
        </button>
      ) : null}

      {returnError ? <p className={styles.error}>{returnError}</p> : null}
      {!returnError && message ? <p className={styles.message}>{message}</p> : null}
    </section>,
    mountPoint
  );
}
