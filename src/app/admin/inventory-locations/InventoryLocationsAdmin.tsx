"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./inventory-locations.module.css";

type InventoryLocation = "IN_STORE" | "WAREHOUSE";
type LocationFilter = "ALL" | InventoryLocation;

type LocationItem = {
  id: string;
  itemName: string;
  publicTitle: string | null;
  quantity: number;
  category: string;
  setName: string | null;
  imageUrl: string | null;
  upc: string | null;
  sku: string | null;
  location: InventoryLocation;
};

type LocationResponse = {
  items?: LocationItem[];
  error?: string;
};

function locationLabel(location: InventoryLocation) {
  return location === "IN_STORE" ? "In Store" : "Warehouse / Home";
}

export function InventoryLocationsAdmin() {
  const [items, setItems] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LocationFilter>("ALL");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadItems() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/radar/inventory-locations", {
        credentials: "same-origin",
        cache: "no-store"
      });
      const data = (await response.json()) as LocationResponse;
      if (!response.ok) throw new Error(data.error || "Could not load inventory locations.");
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load inventory locations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems();
  }, []);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "ALL" && item.location !== filter) return false;
      if (!normalizedSearch) return true;
      return [item.itemName, item.publicTitle, item.category, item.setName, item.upc, item.sku]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [filter, items, search]);

  const inStoreCount = items.filter((item) => item.location === "IN_STORE").length;
  const warehouseCount = items.filter((item) => item.location === "WAREHOUSE").length;

  async function updateLocation(item: LocationItem, location: InventoryLocation) {
    if (savingId || item.location === location) return;
    const previousLocation = item.location;
    setSavingId(item.id);
    setError(null);
    setSuccess(null);
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, location } : entry));

    try {
      const response = await fetch("/api/radar/inventory-locations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryItemId: item.id, location })
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "Could not update inventory location.");
      setSuccess(`${item.publicTitle || item.itemName} moved to ${locationLabel(location)}.`);
    } catch (updateError) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, location: previousLocation } : entry));
      setError(updateError instanceof Error ? updateError.message : "Could not update inventory location.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>GameDayGrabs Admin</span>
            <h1>Inventory Locations</h1>
            <p>Choose what physically stays in the store and what stays at your warehouse or home.</p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.secondaryButton} href="/admin?tab=inventory">Products & Inventory</Link>
            <button className={styles.secondaryButton} type="button" onClick={() => void loadItems()} disabled={loading}>Refresh</button>
          </div>
        </header>

        <section className={styles.summaryGrid} aria-label="Inventory location summary">
          <article>
            <span>All Products</span>
            <strong>{items.length}</strong>
          </article>
          <article>
            <span>In Store</span>
            <strong>{inStoreCount}</strong>
            <small>Visible in POS</small>
          </article>
          <article>
            <span>Warehouse / Home</span>
            <strong>{warehouseCount}</strong>
            <small>Hidden from POS</small>
          </article>
        </section>

        <section className={styles.card}>
          <div className={styles.toolbar}>
            <label>
              <span>Search inventory</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Product, UPC, SKU, set…" />
            </label>
            <label>
              <span>Location</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value as LocationFilter)}>
                <option value="ALL">All locations</option>
                <option value="IN_STORE">In Store</option>
                <option value="WAREHOUSE">Warehouse / Home</option>
              </select>
            </label>
          </div>

          <div className={styles.help}>
            <strong>How it works:</strong> products marked <b>In Store</b> appear on the store POS. Products marked <b>Warehouse / Home</b> remain in your Admin inventory but are hidden from the store POS.
          </div>

          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          {success ? <div className={styles.success} role="status">{success}</div> : null}

          {loading ? (
            <div className={styles.empty}>Loading inventory locations…</div>
          ) : filteredItems.length ? (
            <div className={styles.list}>
              {filteredItems.map((item) => (
                <article className={styles.row} key={item.id}>
                  <div className={styles.imageFrame}>
                    {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span>No image</span>}
                  </div>
                  <div className={styles.itemInfo}>
                    <strong>{item.publicTitle || item.itemName}</strong>
                    <span>{item.setName || item.category || "Inventory"}</span>
                    <small>{[item.upc ? `UPC ${item.upc}` : null, item.sku ? `SKU ${item.sku}` : null].filter(Boolean).join(" · ") || "No UPC/SKU"}</small>
                  </div>
                  <div className={styles.quantity}>
                    <span>On hand</span>
                    <strong>{item.quantity}</strong>
                  </div>
                  <label className={styles.locationControl}>
                    <span>Physical location</span>
                    <select
                      value={item.location}
                      disabled={savingId === item.id}
                      onChange={(event) => void updateLocation(item, event.target.value as InventoryLocation)}
                    >
                      <option value="IN_STORE">In Store</option>
                      <option value="WAREHOUSE">Warehouse / Home</option>
                    </select>
                    <small>{item.location === "IN_STORE" ? "Shows in POS" : "Hidden from POS"}</small>
                  </label>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>No products match this search or location filter.</div>
          )}
        </section>
      </div>
    </main>
  );
}
