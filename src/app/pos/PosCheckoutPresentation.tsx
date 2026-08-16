"use client";

import { useEffect } from "react";

function cartCountFromHeading(value: string | null | undefined) {
  const match = String(value || "").match(/Cart\s*\((\d+)\)/i);
  return match ? Number(match[1]) : null;
}

function installSaleHeading(searchPanel: HTMLElement) {
  if (searchPanel.querySelector(".pos-register-sale-heading")) return;
  const heading = document.createElement("div");
  heading.className = "pos-register-sale-heading";

  const eyebrow = document.createElement("span");
  eyebrow.textContent = "Checkout";

  const title = document.createElement("h1");
  title.textContent = "New sale";

  heading.append(eyebrow, title);
  searchPanel.prepend(heading);
}

function simplifyCartHeader(cartPanel: HTMLElement) {
  const header = cartPanel.querySelector<HTMLElement>(".pos-cart-header");
  if (!header) return;

  const copy = header.querySelector<HTMLElement>(":scope > div");
  const heading = header.querySelector<HTMLElement>("h2");
  if (!copy || !heading) return;

  if (!copy.querySelector(".pos-register-cart-eyebrow")) {
    const eyebrow = document.createElement("span");
    eyebrow.className = "pos-register-cart-eyebrow";
    eyebrow.textContent = "Current sale";
    copy.prepend(eyebrow);
  }

  const count = cartCountFromHeading(heading.textContent);
  if (count !== null) heading.textContent = `${count} ${count === 1 ? "item" : "items"}`;
}

function markProductCards(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>(".pos-product-card").forEach((card) => {
    const addButton = card.querySelector<HTMLButtonElement>(".pos-add-button");
    const title = card.querySelector<HTMLElement>(".pos-product-copy strong")?.textContent?.trim() || "product";
    const enabled = Boolean(addButton && !addButton.disabled);

    card.dataset.posCardTappable = enabled ? "true" : "false";
    if (enabled) {
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", `Add ${title} to current sale`);
    } else {
      card.removeAttribute("role");
      card.removeAttribute("tabindex");
      card.removeAttribute("aria-label");
    }
  });
}

function applyPresentation(root: HTMLElement) {
  const searchPanel = root.querySelector<HTMLElement>(".pos-search-panel");
  if (searchPanel) installSaleHeading(searchPanel);

  const cartPanel = root.querySelector<HTMLElement>(".pos-cart-panel");
  if (cartPanel) simplifyCartHeader(cartPanel);

  markProductCards(root);
}

function interactiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button,input,a,select,textarea,label,[role='button']"));
}

export function PosCheckoutPresentation() {
  useEffect(() => {
    let scheduled = false;

    const root = () => document.querySelector<HTMLElement>(".pos-page");
    const run = () => {
      scheduled = false;
      const current = root();
      if (current) applyPresentation(current);
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(run);
    };

    const onClick = (event: MouseEvent) => {
      const current = root();
      if (!current || interactiveTarget(event.target)) return;
      if (!(event.target instanceof Element)) return;
      const card = event.target.closest<HTMLElement>(".pos-product-card[data-pos-card-tappable='true']");
      if (!card || !current.contains(card)) return;
      const addButton = card.querySelector<HTMLButtonElement>(".pos-add-button");
      if (addButton && !addButton.disabled) addButton.click();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!(event.target instanceof HTMLElement)) return;
      const card = event.target.closest<HTMLElement>(".pos-product-card[data-pos-card-tappable='true']");
      const current = root();
      if (!card || !current?.contains(card) || event.target !== card) return;
      const addButton = card.querySelector<HTMLButtonElement>(".pos-add-button");
      if (!addButton || addButton.disabled) return;
      event.preventDefault();
      addButton.click();
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled"] });
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
