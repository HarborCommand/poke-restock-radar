"use client";

import { Banknote, CheckCircle2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./PosCashTender.module.css";

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function parseMoneyText(value: string | null | undefined) {
  const numeric = Number(String(value || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function activeCashPayment() {
  const active = document.querySelector<HTMLButtonElement>(".pos-payment.active");
  return Boolean(active && active.textContent?.trim().toLowerCase() === "cash");
}

function currentQuotedTotal() {
  return parseMoneyText(document.querySelector(".pos-total-box .total strong")?.textContent);
}

export function PosCashTender() {
  const [mountPoint, setMountPoint] = useState<HTMLElement | null>(null);
  const [cashActive, setCashActive] = useState(false);
  const [total, setTotal] = useState(0);
  const [cashInput, setCashInput] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let scheduled = false;

    const sync = () => {
      scheduled = false;
      const panel = document.querySelector<HTMLElement>(".pos-payment-panel");
      const nextCashActive = activeCashPayment();
      const nextTotal = currentQuotedTotal();
      setMountPoint((current) => (current === panel ? current : panel));
      setCashActive(nextCashActive);
      setTotal((current) => (Math.abs(current - nextTotal) < 0.001 ? current : nextTotal));
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
      attributeFilter: ["class", "disabled", "aria-busy"]
    });
    return () => observer.disconnect();
  }, []);

  const cashReceived = useMemo(() => {
    const numeric = Number(cashInput);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
  }, [cashInput]);
  const changeDue = Math.max(0, cashReceived - total);
  const sufficient = cashActive && total > 0 && cashReceived >= total;

  useEffect(() => {
    const referenceLabel = document.querySelector<HTMLElement>(".pos-reference-input");
    const referenceInput = referenceLabel?.querySelector<HTMLInputElement>("input") ?? null;
    if (!referenceLabel || !referenceInput) return;

    if (!cashActive) {
      referenceLabel.style.display = "";
      if (referenceInput.value.startsWith("Cash received ")) setControlledInputValue(referenceInput, "");
      setCashInput("");
      return;
    }

    referenceLabel.style.display = "none";
    const reference = sufficient
      ? `Cash received ${money(cashReceived)} · Change ${money(changeDue)}`
      : "";
    if (referenceInput.value !== reference) setControlledInputValue(referenceInput, reference);

    return () => {
      referenceLabel.style.display = "";
    };
  }, [cashActive, cashReceived, changeDue, sufficient]);

  useEffect(() => {
    if (!cashActive) return;
    const completeButton = document.querySelector<HTMLButtonElement>(".pos-complete-button");
    if (!completeButton) return;
    if (!sufficient) {
      completeButton.setAttribute("data-cash-disabled", "true");
      completeButton.setAttribute("aria-disabled", "true");
    } else {
      completeButton.removeAttribute("data-cash-disabled");
      completeButton.removeAttribute("aria-disabled");
    }
  }, [cashActive, sufficient, total]);

  useEffect(() => {
    if (!cashActive) return;

    const blockIncompleteCashCheckout = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest(".pos-complete-button") : null;
      if (!target || sufficient) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      inputRef.current?.focus();
    };

    document.addEventListener("click", blockIncompleteCashCheckout, true);
    return () => document.removeEventListener("click", blockIncompleteCashCheckout, true);
  }, [cashActive, sufficient]);

  useEffect(() => {
    if (cashActive) window.setTimeout(() => inputRef.current?.focus(), 40);
  }, [cashActive]);

  if (!mountPoint || !cashActive) return null;

  const quickAmounts = [20, 50, 100].filter((amount) => amount >= total && Math.abs(amount - total) > 0.009);

  return createPortal(
    <section className={styles.tender} aria-label="Cash tender calculator">
      <div className={styles.heading}>
        <span className={styles.icon}><Banknote size={20} aria-hidden="true" /></span>
        <div>
          <strong>Cash received</strong>
          <small>Enter what the customer hands you.</small>
        </div>
      </div>

      <label className={styles.amountField}>
        <span>Amount received</span>
        <div>
          <b>$</b>
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={cashInput}
            onChange={(event) => setCashInput(event.currentTarget.value)}
            placeholder="0.00"
            aria-label="Cash amount received"
          />
        </div>
      </label>

      <div className={styles.quickRow} aria-label="Quick cash amounts">
        <button type="button" onClick={() => setCashInput(total.toFixed(2))}>Exact {money(total)}</button>
        {quickAmounts.slice(0, 3).map((amount) => (
          <button type="button" key={amount} onClick={() => setCashInput(amount.toFixed(2))}>{money(amount)}</button>
        ))}
      </div>

      <div className={`${styles.changeCard} ${sufficient ? styles.ready : styles.waiting}`}>
        <span>{sufficient ? <CheckCircle2 size={20} aria-hidden="true" /> : <Banknote size={20} aria-hidden="true" />}</span>
        <div>
          <small>{sufficient ? "Change due" : "Still due"}</small>
          <strong>{sufficient ? money(changeDue) : money(Math.max(0, total - cashReceived))}</strong>
        </div>
      </div>

      <div className={styles.summary}>
        <span>Sale total <strong>{money(total)}</strong></span>
        <span>Cash received <strong>{money(cashReceived)}</strong></span>
      </div>
    </section>,
    mountPoint
  );
}
