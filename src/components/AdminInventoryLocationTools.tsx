"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./AdminInventoryLocationTools.module.css";

type InventoryLocation = "IN_STORE" | "WAREHOUSE";

type LocationItem = {
  id: string;
  itemName?: string;
  publicTitle?: string | null;
  upc?: string | null;
  sku?: string | null;
  location: InventoryLocation;
  onHandQuantity?: number;
  inStoreQuantity?: number;
  warehouseQuantity?: number;
};

type LocationResponse = {
  items?: LocationItem[];
};

const LOCATION_CONTROL_ATTRIBUTE = "data-admin-inventory-location-control";
const QUICK_ACTION_ATTRIBUTE = "data-admin-inventory-location-quick-action";
const CATALOG_LOCATION_ATTRIBUTE = "data-admin-inventory-location-catalog";

function normalizedText(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function locationSummary(item: LocationItem) {
  const onHand = Math.max(0, Math.floor(Number(item.onHandQuantity) || 0));
  const inStore = Math.max(0, Math.floor(Number(item.inStoreQuantity) || 0));
  const warehouse = Math.max(0, Math.floor(Number(item.warehouseQuantity) || 0));

  if (onHand <= 0) return { label: "No Stock", detail: "0 on hand", kind: "empty" };
  if (inStore > 0 && warehouse > 0) {
    return { label: "Split", detail: `Store ${inStore} · WH ${warehouse}`, kind: "split" };
  }
  if (inStore > 0) return { label: "In Store", detail: `${inStore} unit${inStore === 1 ? "" : "s"}`, kind: "store" };
  if (warehouse > 0) return { label: "Warehouse", detail: `${warehouse} unit${warehouse === 1 ? "" : "s"}`, kind: "warehouse" };
  return { label: "No Stock", detail: `${onHand} on hand`, kind: "empty" };
}

function findLeafByExactText(text: string, root: ParentNode = document) {
  const target = normalizedText(text);
  return Array.from(root.querySelectorAll<HTMLElement>("span,strong,b,small,p,div,button,a,th,td"))
    .filter((element) => element.children.length === 0)
    .find((element) => normalizedText(element.textContent) === target) ?? null;
}

function replaceText(root: HTMLElement, matcher: (text: string) => string | null) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  nodes.forEach((textNode) => {
    const replacement = matcher(textNode.textContent || "");
    if (replacement !== null) textNode.textContent = replacement;
  });
}

function createLocationControl(location: InventoryLocation) {
  const label = document.createElement("label");
  label.className = styles.purchaseLocationField;
  label.setAttribute(LOCATION_CONTROL_ATTRIBUTE, "true");

  const title = document.createElement("span");
  title.textContent = "Inventory Location";

  const select = document.createElement("select");
  select.name = "inventoryLocation";
  select.setAttribute("aria-label", "Inventory location");

  const inStoreOption = document.createElement("option");
  inStoreOption.value = "IN_STORE";
  inStoreOption.textContent = "In Store";

  const warehouseOption = document.createElement("option");
  warehouseOption.value = "WAREHOUSE";
  warehouseOption.textContent = "Warehouse / Home";

  select.append(inStoreOption, warehouseOption);
  select.value = location;

  const helper = document.createElement("small");
  helper.textContent = "Only In Store inventory appears on the store POS.";

  label.append(title, select, helper);
  return label;
}

function createQuickActionFrom(action: HTMLElement) {
  const link = document.createElement("a");
  link.href = "/admin/inventory-locations";
  link.className = `${action.className || ""} ${styles.quickAction}`.trim();
  link.setAttribute(QUICK_ACTION_ATTRIBUTE, "true");
  link.setAttribute("aria-label", "Inventory Locations");

  Array.from(action.childNodes).forEach((child) => link.append(child.cloneNode(true)));
  replaceText(link, (text) => {
    const normalized = normalizedText(text);
    if (normalized === "sold items") return "Inventory Locations";
    if (/^\d+\s+items?\s+sold$/i.test(text.trim())) return "Move store & warehouse stock";
    return null;
  });

  link.querySelectorAll<HTMLElement>("[disabled]").forEach((element) => element.removeAttribute("disabled"));
  return link;
}

function findCatalogRowForItem(item: LocationItem) {
  const identifiers = [item.upc, item.sku].filter((value): value is string => Boolean(value?.trim()));
  for (const identifier of identifiers) {
    const normalizedIdentifier = normalizedText(identifier);
    const leaf = Array.from(document.querySelectorAll<HTMLElement>("span,strong,small,div,td"))
      .filter((element) => element.children.length === 0)
      .find((element) => normalizedText(element.textContent).includes(normalizedIdentifier));
    if (!leaf) continue;

    let current: HTMLElement | null = leaf;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const text = normalizedText(current.textContent);
      if (text.includes(normalizedIdentifier) && text.includes("manage")) return current;
    }
  }

  const title = item.publicTitle || item.itemName;
  if (!title) return null;
  const titleLeaf = Array.from(document.querySelectorAll<HTMLElement>("strong,b,span,div"))
    .filter((element) => element.children.length === 0)
    .find((element) => normalizedText(element.textContent) === normalizedText(title));
  if (!titleLeaf) return null;

  let current: HTMLElement | null = titleLeaf;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    const text = normalizedText(current.textContent);
    if (text.includes(normalizedText(title)) && text.includes("manage")) return current;
  }
  return null;
}

function attachCatalogLocation(item: LocationItem) {
  const row = findCatalogRowForItem(item);
  if (!row) return;

  const existing = row.querySelector<HTMLElement>(`[${CATALOG_LOCATION_ATTRIBUTE}]`);
  const summary = locationSummary(item);
  const signature = `${summary.label}|${summary.detail}|${summary.kind}`;
  if (existing?.dataset.signature === signature) return;
  existing?.remove();

  const badge = document.createElement("span");
  badge.className = `${styles.catalogLocation} ${styles[`location_${summary.kind}`] || ""}`.trim();
  badge.setAttribute(CATALOG_LOCATION_ATTRIBUTE, "true");
  badge.dataset.signature = signature;
  badge.title = `Inventory location: ${summary.label} — ${summary.detail}`;

  const label = document.createElement("b");
  label.textContent = `Location: ${summary.label}`;
  const detail = document.createElement("small");
  detail.textContent = summary.detail;
  badge.append(label, detail);

  const storeReady = findLeafByExactText("Store Ready", row);
  const badgeContainer = storeReady?.parentElement;
  if (badgeContainer && badgeContainer !== row) {
    badgeContainer.append(badge);
    return;
  }

  const title = item.publicTitle || item.itemName || "";
  const titleLeaf = Array.from(row.querySelectorAll<HTMLElement>("strong,b,span,div"))
    .filter((element) => element.children.length === 0)
    .find((element) => normalizedText(element.textContent) === normalizedText(title));
  titleLeaf?.parentElement?.append(badge);
}

export function AdminInventoryLocationTools() {
  const [items, setItems] = useState<LocationItem[]>([]);

  const locationById = useMemo(
    () => new Map(items.map((item) => [item.id, item.location])),
    [items]
  );

  useEffect(() => {
    let active = true;

    void fetch("/api/radar/inventory-locations", {
      credentials: "same-origin",
      cache: "no-store"
    })
      .then(async (response) => {
        if (!response.ok) return { items: [] } as LocationResponse;
        return (await response.json()) as LocationResponse;
      })
      .then((data) => {
        if (active) setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (active) setItems([]);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let scheduled = false;

    function syncForm(form: HTMLFormElement) {
      let control = form.querySelector<HTMLElement>(`[${LOCATION_CONTROL_ATTRIBUTE}]`);
      let select = control?.querySelector<HTMLSelectElement>('select[name="inventoryLocation"]') ?? null;

      const existingProductControl = form.querySelector<HTMLInputElement | HTMLSelectElement>('[name="existingInventoryItemId"]');
      const existingItemId = existingProductControl?.value?.trim() || "";
      const existingLocation = existingItemId ? locationById.get(existingItemId) : undefined;

      if (!control || !select) {
        control = createLocationControl(existingLocation ?? "IN_STORE");
        select = control.querySelector<HTMLSelectElement>('select[name="inventoryLocation"]');

        const formGrid = form.querySelector<HTMLElement>(".form-grid.compact");
        if (formGrid) formGrid.append(control);
        else form.prepend(control);
      }

      if (select && existingLocation && select.dataset.inventoryItemId !== existingItemId) {
        select.value = existingLocation;
      }
      if (select) select.dataset.inventoryItemId = existingItemId;
    }

    function syncQuickAction() {
      if (document.querySelector(`[${QUICK_ACTION_ATTRIBUTE}]`)) return;
      const soldItemsLabel = findLeafByExactText("Sold Items");
      const action = soldItemsLabel?.closest<HTMLElement>("button,a,[role='button']");
      if (!action?.parentElement) return;
      action.insertAdjacentElement("afterend", createQuickActionFrom(action));
    }

    function syncCatalogLocations() {
      items.forEach(attachCatalogLocation);
    }

    function syncAll() {
      scheduled = false;
      document.querySelectorAll<HTMLFormElement>("form.purchase-flow").forEach(syncForm);
      syncQuickAction();
      syncCatalogLocations();
    }

    function scheduleSync() {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(syncAll);
    }

    const handleChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      if (target.name !== "existingInventoryItemId") return;
      const form = target.closest<HTMLFormElement>("form.purchase-flow");
      if (form) window.setTimeout(() => syncForm(form), 0);
    };

    syncAll();
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", handleChange, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("change", handleChange, true);
    };
  }, [items, locationById]);

  return null;
}
