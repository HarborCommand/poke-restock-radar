"use client";

import { useEffect } from "react";

const ACCESSORY_TERMS = [
  "accessory",
  "accessories",
  "supplies",
  "sleeve",
  "sleeves",
  "binder",
  "portfolio",
  "toploader",
  "top loader",
  "card saver",
  "deck box",
  "playmat",
  "play mat",
  "one-touch",
  "one touch",
  "magnetic holder",
  "storage box",
  "card storage",
  "pocket pages",
  "9-pocket",
  "9 pocket"
];

const NON_ACCESSORY_TERMS = [
  "sealed packs",
  "sealed pack",
  "booster bundle",
  "booster bundles",
  "booster box",
  "elite trainer box",
  " etb",
  "blister",
  "checklane",
  "check lane",
  "tin",
  "collection box",
  "collection bundle",
  "single card",
  "singles"
];

function normalize(value: string | null | undefined) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isExplicitAccessory(card: HTMLElement) {
  const copy = normalize(card.querySelector<HTMLElement>(".pos-product-copy")?.textContent || card.textContent);
  if (!copy) return false;
  if (NON_ACCESSORY_TERMS.some((term) => copy.includes(term))) return false;
  return ACCESSORY_TERMS.some((term) => copy.includes(term));
}

function restoreCards(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.pos-product-card[data-pos-accessory-filter-hidden="true"]').forEach((card) => {
    card.hidden = false;
    delete card.dataset.posAccessoryFilterHidden;
  });
}

function activeFilterFromDom(root: HTMLElement) {
  const filters = Array.from(root.querySelectorAll<HTMLButtonElement>(".pos-filter"));
  const explicitlyActive = filters.find(
    (button) =>
      button.getAttribute("aria-pressed") === "true" ||
      button.getAttribute("aria-current") === "true" ||
      button.dataset.active === "true" ||
      button.classList.contains("active")
  );
  return normalize(explicitlyActive?.textContent);
}

export function PosAccessoriesFilterFix() {
  useEffect(() => {
    let selectedFilter = "";
    let scheduled = false;

    const root = () => document.querySelector<HTMLElement>(".pos-page");

    const apply = () => {
      scheduled = false;
      const current = root();
      if (!current) return;

      restoreCards(current);

      const domFilter = activeFilterFromDom(current);
      if (domFilter) selectedFilter = domFilter;
      if (selectedFilter !== "accessories") return;

      current.querySelectorAll<HTMLElement>(".pos-items-grid .pos-product-card").forEach((card) => {
        if (isExplicitAccessory(card)) return;
        card.hidden = true;
        card.dataset.posAccessoryFilterHidden = "true";
      });
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(apply);
    };

    const onFilterClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLButtonElement>(".pos-filter");
      const current = root();
      if (!button || !current?.contains(button)) return;
      selectedFilter = normalize(button.textContent);
      schedule();
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("click", onFilterClick);
    schedule();

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onFilterClick);
      const current = root();
      if (current) restoreCards(current);
    };
  }, []);

  return null;
}
