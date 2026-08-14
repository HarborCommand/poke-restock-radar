"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./pos-store-mode.module.css";

const RadarApp = dynamic(
  () => import("@/components/RadarApp").then((module) => module.RadarApp),
  { ssr: false }
);

type InventoryLocation = "IN_STORE" | "WAREHOUSE";

type LocationItem = {
  id: string;
  itemName: string;
  quantity: number;
  category: string;
  setName: string | null;
  imageUrl: string | null;
  upc: string | null;
  sku: string | null;
  location: InventoryLocation;
};

type LocationResponse = {
  items: LocationItem[];
};

function locationLabel(location: InventoryLocation) {
  return location === "IN_STORE" ? "In Store" : "Warehouse / Home";
}

export default function PosStoreModePage() {
  const [ready, setReady] = useState(false);
  const [locationItems, setLocationItems] = useState<LocationItem[]>([]);
  const [locationPanelOpen, setLocationPanelOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<"ALL" | InventoryLocation>("ALL");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [savingLocationId, setSavingLocationId] = useState<string | null>(null);
  const [radarKey, setRadarKey] = useState(0);
  const locationByIdRef = useRef<Map<string, InventoryLocation>>(new Map());
  const originalFetchRef = useRef<typeof window.fetch | null>(null);

  useEffect(() => {
    let active = true;
    let restore: (() => void) | null = null;

    async function setupStoreMode() {
      const url = new URL(window.location.href);
      if (url.searchParams.get("tab") !== "pos") {
        url.searchParams.set("tab", "pos");
        window.history.replaceState(window.history.state, "", url);
      }

      const originalFetch = window.fetch.bind(window);
      originalFetchRef.current = originalFetch;

      try {
        const response = await originalFetch("/api/radar/inventory-locations", {
          credentials: "same-origin"
        });
        if (!response.ok) throw new Error("Could not load inventory locations.");
        const data = (await response.json()) as LocationResponse;
        if (!active) return;
        setLocationItems(data.items);
        locationByIdRef.current = new Map(data.items.map((item) => [item.id, item.location]));
      } catch (error) {
        if (!active) return;
        setLocationError(error instanceof Error ? error.message : "Could not load inventory locations.");
        locationByIdRef.current = new Map();
      }

      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const response = await originalFetch(input, init);
        try {
          const rawUrl =
            typeof input === "string"
              ? input
              : input instanceof Request
                ? input.url
                : input.toString();
          const pathname = new URL(rawUrl, window.location.origin).pathname;
          const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();

          if (method !== "GET" || pathname !== "/api/radar/dashboard" || !response.ok) {
            return response;
          }

          const data = (await response.clone().json()) as Record<string, unknown>;
          if (!Array.isArray(data.inventory)) return response;

          const inventory = data.inventory.filter((entry) => {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
            const id = String((entry as Record<string, unknown>).id || "");
            return locationByIdRef.current.get(id) !== "WAREHOUSE";
          });

          const headers = new Headers(response.headers);
          headers.delete("content-length");
          headers.delete("content-encoding");
          headers.set("content-type", "application/json; charset=utf-8");

          return new Response(JSON.stringify({ ...data, inventory }), {
            status: response.status,
            statusText: response.statusText,
            headers
          });
        } catch {
          return response;
        }
      };

      const handlePosAddClick = (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest(".pos-search-panel button");
        if (!button) return;
        const text = button.textContent?.trim() || "";
        if (text !== "Add" && !text.startsWith("Added")) return;

        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            const searchInput = document.querySelector<HTMLInputElement>(".pos-search-input input");
            if (searchInput && document.activeElement === searchInput) searchInput.blur();
          });
        });
      };

      document.addEventListener("click", handlePosAddClick);
      restore = () => {
        document.removeEventListener("click", handlePosAddClick);
        if (window.fetch !== originalFetch) window.fetch = originalFetch;
      };

      if (active) setReady(true);
    }

    void setupStoreMode();

    return () => {
      active = false;
      restore?.();
    };
  }, []);

  const visibleLocationItems = useMemo(() => {
    const search = locationSearch.trim().toLowerCase();
    return locationItems.filter((item) => {
      if (locationFilter !== "ALL" && item.location !== locationFilter) return false;
      if (!search) return true;
      return [item.itemName, item.category, item.setName, item.upc, item.sku]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }, [locationFilter, locationItems, locationSearch]);

  const inStoreCount = locationItems.filter((item) => item.location === "IN_STORE").length;
  const warehouseCount = locationItems.filter((item) => item.location === "WAREHOUSE").length;

  async function updateLocation(item: LocationItem, location: InventoryLocation) {
    if (item.location === location || savingLocationId) return;
    const originalFetch = originalFetchRef.current;
    if (!originalFetch) return;

    setSavingLocationId(item.id);
    setLocationError(null);
    try {
      const response = await originalFetch("/api/radar/inventory-locations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryItemId: item.id, location })
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Could not update inventory location.");

      setLocationItems((current) =>
        current.map((currentItem) =>
          currentItem.id === item.id ? { ...currentItem, location } : currentItem
        )
      );
      locationByIdRef.current.set(item.id, location);
      setRadarKey((current) => current + 1);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Could not update inventory location.");
    } finally {
      setSavingLocationId(null);
    }
  }

  return (
    <div className={styles.storeMode}>
      <button
        className={styles.locationsButton}
        type="button"
        onClick={() => setLocationPanelOpen(true)}
      >
        Locations
      </button>
      <Link className={styles.exitButton} href="/admin?tab=pos">
        Exit Store Mode
      </Link>

      {locationPanelOpen ? (
        <div className={styles.locationOverlay} role="dialog" aria-modal="true" aria-label="Inventory locations">
          <div className={styles.locationPanel}>
            <div className={styles.locationHeader}>
              <div>
                <h2>Inventory Locations</h2>
                <p>{inStoreCount} in store · {warehouseCount} warehouse / home</p>
              </div>
              <button type="button" onClick={() => setLocationPanelOpen(false)} aria-label="Close inventory locations">
                Close
              </button>
            </div>

            <div className={styles.locationToolbar}>
              <input
                value={locationSearch}
                onChange={(event) => setLocationSearch(event.target.value)}
                placeholder="Search products..."
                aria-label="Search inventory locations"
              />
              <select
                value={locationFilter}
                onChange={(event) => setLocationFilter(event.target.value as "ALL" | InventoryLocation)}
                aria-label="Filter inventory location"
              >
                <option value="ALL">All locations</option>
                <option value="IN_STORE">In Store</option>
                <option value="WAREHOUSE">Warehouse / Home</option>
              </select>
            </div>

            {locationError ? <div className={styles.locationError}>{locationError}</div> : null}

            <div className={styles.locationList}>
              {visibleLocationItems.length ? (
                visibleLocationItems.map((item) => (
                  <div className={styles.locationRow} key={item.id}>
                    <div className={styles.locationItemInfo}>
                      <strong>{item.itemName}</strong>
                      <span>
                        Qty {item.quantity}
                        {item.setName ? ` · ${item.setName}` : ""}
                      </span>
                    </div>
                    <select
                      value={item.location}
                      disabled={savingLocationId === item.id}
                      onChange={(event) => void updateLocation(item, event.target.value as InventoryLocation)}
                      aria-label={`Location for ${item.itemName}`}
                    >
                      <option value="IN_STORE">In Store</option>
                      <option value="WAREHOUSE">Warehouse / Home</option>
                    </select>
                  </div>
                ))
              ) : (
                <div className={styles.locationEmpty}>No products match this filter.</div>
              )}
            </div>

            <div className={styles.locationNote}>
              POS only shows items marked <strong>{locationLabel("IN_STORE")}</strong>. Warehouse / Home items stay in your inventory but are hidden from this store POS.
            </div>
          </div>
        </div>
      ) : null}

      {ready ? (
        <RadarApp key={radarKey} />
      ) : (
        <div className={styles.loading} role="status" aria-live="polite">
          Opening POS…
        </div>
      )}
    </div>
  );
}
