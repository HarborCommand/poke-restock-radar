"use client";

import { useEffect } from "react";

function directTextLabel(element: HTMLElement) {
  return Array.from(element.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function setDirectTextLabel(element: HTMLElement, nextLabel: string) {
  const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (!textNode) return;
  const current = textNode.textContent || "";
  const trailingSpace = /\s$/.test(current) ? " " : "";
  if (current.trim() !== nextLabel) textNode.textContent = `${nextLabel}${trailingSpace || " "}`;
}

function hide(element: HTMLElement) {
  if (element.dataset.posTaxSimplifiedHidden === "true") return;
  element.dataset.posTaxSimplifiedHidden = "true";
  element.style.display = "none";
}

function show(element: HTMLElement) {
  if (element.dataset.posTaxSimplifiedHidden !== "true" && element.style.display !== "none") return;
  delete element.dataset.posTaxSimplifiedHidden;
  element.style.removeProperty("display");
}

function simplifyTaxContainer(container: HTMLElement) {
  const rows = Array.from(container.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName === "SPAN"
  );

  const labels = rows.map((row) => ({ row, label: directTextLabel(row).toLowerCase() }));
  const totalSalesTax = labels.find(({ label }) => label === "total sales tax");
  const existingSalesTax = labels.find(({ label }) => label === "sales tax");

  for (const { row, label } of labels) {
    if (label.includes("surtax")) hide(row);
  }

  if (totalSalesTax) {
    for (const { row, label } of labels) {
      const isStateBreakdown = label.endsWith(" tax") && label !== "sales tax" && label !== "total sales tax";
      if (isStateBreakdown) hide(row);
    }

    show(totalSalesTax.row);
    setDirectTextLabel(totalSalesTax.row, "Sales tax");
    return;
  }

  // React may reuse a previously hidden tax-breakdown DOM node when the server quote refreshes.
  // If that reused node now represents the single cashier-facing Sales tax row, restore it.
  if (existingSalesTax) show(existingSalesTax.row);
}

function simplifyTaxDisplay() {
  document.querySelectorAll<HTMLElement>(".pos-tax-profile-card").forEach(hide);
  document
    .querySelectorAll<HTMLElement>(".pos-total-box, .pos-confirm-summary, .pos-receipt-total")
    .forEach(simplifyTaxContainer);
}

export function PosTaxDisplaySimplifier() {
  useEffect(() => {
    let scheduled = false;

    const run = () => {
      scheduled = false;
      simplifyTaxDisplay();
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(run);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
