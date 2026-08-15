"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./AdminInventoryLocationTools.module.css";

type InventoryLocation = "IN_STORE" | "WAREHOUSE";

type LocationItem = {
  id: string;
  location: InventoryLocation;
};

type LocationResponse = {
  items?: LocationItem[];
};

const LOCATION_CONTROL_ATTRIBUTE = "data-admin-inventory-location-control";

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

    function syncAllForms() {
      document.querySelectorAll<HTMLFormElement>("form.purchase-flow").forEach(syncForm);
    }

    const handleChange = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
      if (target.name !== "existingInventoryItemId") return;
      const form = target.closest<HTMLFormElement>("form.purchase-flow");
      if (form) window.setTimeout(() => syncForm(form), 0);
    };

    syncAllForms();
    const observer = new MutationObserver(syncAllForms);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", handleChange, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("change", handleChange, true);
    };
  }, [locationById]);

  return (
    <Link className={styles.shortcut} href="/admin/inventory-locations">
      Inventory Locations
    </Link>
  );
}
