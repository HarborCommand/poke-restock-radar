"use client";

import { useEffect } from "react";

function normalizeText(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function directTextLabel(element: HTMLElement) {
  return normalizeText(
    Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || "")
      .join(" ")
  );
}

function setDirectTextLabel(element: HTMLElement, nextLabel: string) {
  const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  if (!textNode) return;
  const current = textNode.textContent || "";
  const trailingSpace = /\s$/.test(current) ? " " : "";
  if (current.trim() !== nextLabel) textNode.textContent = `${nextLabel}${trailingSpace || " "}`;
}

function hide(element: HTMLElement) {
  element.dataset.posTaxSimplifiedHidden = "true";
  element.style.setProperty("display", "none", "important");
}

function show(element: HTMLElement) {
  delete element.dataset.posTaxSimplifiedHidden;
  element.style.removeProperty("display");
}

function smallestMatchingElement(root: HTMLElement, match: (text: string) => boolean) {
  const candidates = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]
    .map((element) => ({ element, text: normalizeText(element.textContent).toLowerCase() }))
    .filter(({ text }) => match(text))
    .sort((a, b) => a.text.length - b.text.length);

  return candidates[0]?.element || null;
}

function findLabelElement(root: HTMLElement, label: string) {
  const wanted = label.toLowerCase();
  const candidates = Array.from(root.querySelectorAll<HTMLElement>("*"))
    .filter((element) => {
      const direct = directTextLabel(element).toLowerCase();
      const all = normalizeText(element.textContent).toLowerCase();
      return direct === wanted || all === wanted;
    })
    .sort((a, b) => normalizeText(a.textContent).length - normalizeText(b.textContent).length);

  return candidates[0] || null;
}

function rowForLabel(labelElement: HTMLElement, boundary: HTMLElement) {
  let current: HTMLElement = labelElement;

  while (current.parentElement && current.parentElement !== boundary) {
    const parent = current.parentElement;
    const text = normalizeText(parent.textContent);
    if (/\$\s*\d/.test(text) && text.length <= 120) return parent;
    if (text.length > 180) break;
    current = parent;
  }

  return labelElement;
}

function simplifyTaxContainer(container: HTMLElement) {
  const totalSalesTaxLabel = findLabelElement(container, "Total sales tax");
  const existingSalesTaxLabel = findLabelElement(container, "Sales tax");

  for (const element of Array.from(container.querySelectorAll<HTMLElement>("*"))) {
    const label = directTextLabel(element).toLowerCase();
    if (!label) continue;

    const isSurtax = label.includes("surtax");
    const isStateBreakdown = /^[a-z]{2} tax$/.test(label) || label === "florida tax";
    if (isSurtax || isStateBreakdown) hide(rowForLabel(element, container));
  }

  if (totalSalesTaxLabel) {
    const row = rowForLabel(totalSalesTaxLabel, container);
    show(row);
    show(totalSalesTaxLabel);
    setDirectTextLabel(totalSalesTaxLabel, "Sales tax");
  } else if (existingSalesTaxLabel) {
    show(rowForLabel(existingSalesTaxLabel, container));
    show(existingSalesTaxLabel);
  }
}

function simplifyCartTaxDisplay(cartPanel: HTMLElement) {
  // The POS markup has changed over time, so do not rely on one CSS class for the tax profile card.
  // Find the smallest block that clearly represents the jurisdiction/settings card and remove it.
  const taxProfileCard = smallestMatchingElement(
    cartPanel,
    (text) =>
      text.includes("active tax jurisdiction") &&
      (text.includes("combined saved rate") || text.includes("edit tax settings"))
  );
  if (taxProfileCard) hide(taxProfileCard);

  const totalBox = cartPanel.querySelector<HTMLElement>(".pos-total-box") ||
    smallestMatchingElement(cartPanel, (text) => text.includes("merchandise subtotal") && text.includes("total sales tax"));
  if (totalBox) simplifyTaxContainer(totalBox);

  for (const prefix of ["calculated by the server", "quote v"]) {
    const note = smallestMatchingElement(cartPanel, (text) => text.startsWith(prefix));
    if (note && normalizeText(note.textContent).length <= 160) hide(note);
  }
}

function simplifyTaxDisplay() {
  document.querySelectorAll<HTMLElement>(".pos-tax-profile-card").forEach(hide);
  document.querySelectorAll<HTMLElement>(".pos-cart-panel").forEach(simplifyCartTaxDisplay);
  document
    .querySelectorAll<HTMLElement>(".pos-confirm-summary, .pos-receipt-total")
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
