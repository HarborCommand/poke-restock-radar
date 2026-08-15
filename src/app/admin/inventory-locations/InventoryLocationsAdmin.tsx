"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import styles from "./inventory-locations.module.css";

type InventoryLocation = "IN_STORE" | "WAREHOUSE";
type LocationFilter = "ALL" | "IN_STORE" | "WAREHOUSE" | "SPLIT";

type LocationItem = {
  id: string;
  itemName: string;
  publicTitle: string | null;
  quantity: number;
  onHandQuantity: number;
  inStoreQuantity: number;
  warehouseQuantity: number;
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

type MoveStockState = {
  itemId: string;
  toLocation: InventoryLocation;
  quantity: number;
} | null;

function locationLabel(location: InventoryLocation) {
  return location === "IN_STORE" ? "In Store" : "Warehouse / Home";
}

function fromLocationFor(toLocation: InventoryLocation): InventoryLocation {
  return toLocation === "IN_STORE" ? "WAREHOUSE" : "IN_STORE";
}

export function InventoryLocationsAdmin() {
  const [items, setItems] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LocationFilter>("ALL");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [moveStock, setMoveStock] = useState<MoveStockState>(null);

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
      if (filter === "IN_STORE" && item.inStoreQuantity <= 0) return false;
      if (filter === "WAREHOUSE" && item.warehouseQuantity <= 0) return false;
      if (filter === "SPLIT" && !(item.inStoreQuantity > 0 && item.warehouseQuantity > 0)) return false;
      if (!normalizedSearch) return true;
      return [item.itemName, item.publicTitle, item.category, item.setName, item.upc, item.sku]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  }, [filter, items, search]);

  const totalOnHand = items.reduce((sum, item) => sum + item.onHandQuantity, 0);
  const inStoreUnits = items.reduce((sum, item) => sum + item.inStoreQuantity, 0);
  const warehouseUnits = items.reduce((sum, item) => sum + item.warehouseQuantity, 0);
  const splitProductCount = items.filter((item) => item.inStoreQuantity > 0 && item.warehouseQuantity > 0).length;

  const moveItem = moveStock ? items.find((item) => item.id === moveStock.itemId) ?? null : null;
  const moveFromLocation = moveStock ? fromLocationFor(moveStock.toLocation) : "WAREHOUSE";
  const moveAvailable = moveItem
    ? moveFromLocation === "IN_STORE"
      ? moveItem.inStoreQuantity
      : moveItem.warehouseQuantity
    : 0;
  const moveQuantity = moveStock ? Math.max(1, Math.min(moveStock.quantity, Math.max(1, moveAvailable))) : 1;

  function openMoveStock(item: LocationItem, toLocation?: InventoryLocation) {
    const defaultTo = toLocation ?? (item.warehouseQuantity > 0 ? "IN_STORE" : "WAREHOUSE");
    const available = defaultTo === "IN_STORE" ? item.warehouseQuantity : item.inStoreQuantity;
    setError(null);
    setSuccess(null);
    setMoveStock({ itemId: item.id, toLocation: defaultTo, quantity: Math.max(1, Math.min(1, Math.max(1, available))) });
  }

  function updateMoveDestination(toLocation: InventoryLocation) {
    if (!moveStock || !moveItem) return;
    const available = toLocation === "IN_STORE" ? moveItem.warehouseQuantity : moveItem.inStoreQuantity;
    setMoveStock({ ...moveStock, toLocation, quantity: Math.max(1, Math.min(moveStock.quantity, Math.max(1, available))) });
  }

  function updateMoveQuantity(nextQuantity: number) {
    if (!moveStock) return;
    const max = Math.max(1, moveAvailable);
    setMoveStock({ ...moveStock, quantity: Math.max(1, Math.min(Math.floor(nextQuantity) || 1, max)) });
  }

  async function submitMove() {
    if (!moveStock || !moveItem || savingId || moveAvailable <= 0) return;
    const quantity = Math.min(moveQuantity, moveAvailable);
    const fromLocation = fromLocationFor(moveStock.toLocation);
    setSavingId(moveItem.id);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/radar/inventory-locations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventoryItemId: moveItem.id,
          fromLocation,
          toLocation: moveStock.toLocation,
          quantity
        })
      });
      const data = (await response.json().catch(() => null)) as { item?: Partial<LocationItem>; error?: string } | null;
      if (!response.ok || !data?.item) throw new Error(data?.error || "Could not move inventory.");

      setItems((current) => current.map((item) => item.id === moveItem.id ? { ...item, ...data.item } : item));
      setSuccess(`${quantity} ${quantity === 1 ? "unit" : "units"} of ${moveItem.publicTitle || moveItem.itemName} moved to ${locationLabel(moveStock.toLocation)}.`);
      setMoveStock(null);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Could not move inventory.");
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
            <p>Split the units you already own between the physical store and Warehouse / Home without changing your total inventory.</p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.secondaryButton} href="/admin?tab=inventory">Products & Inventory</Link>
            <button className={styles.secondaryButton} type="button" onClick={() => void loadItems()} disabled={loading}>Refresh</button>
          </div>
        </header>

        <section className={styles.summaryGrid} aria-label="Inventory location summary">
          <article>
            <span>Total On Hand</span>
            <strong>{totalOnHand}</strong>
            <small>{items.length} products</small>
          </article>
          <article>
            <span>In Store Units</span>
            <strong>{inStoreUnits}</strong>
            <small>Available to the store POS</small>
          </article>
          <article>
            <span>Warehouse / Home Units</span>
            <strong>{warehouseUnits}</strong>
            <small>Not available to the store POS</small>
          </article>
          <article>
            <span>Split Products</span>
            <strong>{splitProductCount}</strong>
            <small>Stock in both locations</small>
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
                <option value="ALL">All inventory</option>
                <option value="IN_STORE">Has In Store stock</option>
                <option value="WAREHOUSE">Has Warehouse / Home stock</option>
                <option value="SPLIT">Split between both</option>
              </select>
            </label>
          </div>

          <div className={styles.help}>
            <strong>How it works:</strong> <b>On Hand</b> now matches your live Products & Inventory count. Use <b>Move Stock</b> to transfer only the number of units you want. Moving units changes location only — it never adds or removes inventory.
          </div>

          {error ? <div className={styles.error} role="alert">{error}</div> : null}
          {success ? <div className={styles.success} role="status">{success}</div> : null}

          {loading ? (
            <div className={styles.empty}>Loading live inventory quantities…</div>
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
                  <div className={styles.locationNumbers}>
                    <span className={styles.totalCount}><small>On hand</small><b>{item.onHandQuantity}</b></span>
                    <span className={styles.storeCount}><small>In Store</small><b>{item.inStoreQuantity}</b></span>
                    <span className={styles.warehouseCount}><small>Warehouse / Home</small><b>{item.warehouseQuantity}</b></span>
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      className={styles.moveButton}
                      type="button"
                      disabled={item.onHandQuantity <= 0 || savingId === item.id}
                      onClick={() => openMoveStock(item)}
                    >
                      Move Stock
                    </button>
                    <small>{item.onHandQuantity <= 0 ? "No units on hand" : item.inStoreQuantity > 0 && item.warehouseQuantity > 0 ? "Split inventory" : item.inStoreQuantity > 0 ? "All current units in store" : "All current units in warehouse / home"}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>No products match this search or location filter.</div>
          )}
        </section>
      </div>

      {moveStock && moveItem ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !savingId) setMoveStock(null);
        }}>
          <section className={styles.moveModal} role="dialog" aria-modal="true" aria-label={`Move stock for ${moveItem.publicTitle || moveItem.itemName}`}>
            <header className={styles.moveHeader}>
              <div>
                <span className={styles.eyebrow}>Inventory Transfer</span>
                <h2>Move Stock</h2>
                <p>{moveItem.publicTitle || moveItem.itemName}</p>
              </div>
              <button className={styles.closeButton} type="button" onClick={() => setMoveStock(null)} disabled={Boolean(savingId)}>Close</button>
            </header>

            <div className={styles.currentStockGrid}>
              <article><span>Total On Hand</span><strong>{moveItem.onHandQuantity}</strong></article>
              <article><span>In Store</span><strong>{moveItem.inStoreQuantity}</strong></article>
              <article><span>Warehouse / Home</span><strong>{moveItem.warehouseQuantity}</strong></article>
            </div>

            <div className={styles.moveSection}>
              <span className={styles.sectionLabel}>Move inventory to</span>
              <div className={styles.destinationButtons}>
                <button
                  type="button"
                  className={moveStock.toLocation === "IN_STORE" ? styles.destinationActive : ""}
                  onClick={() => updateMoveDestination("IN_STORE")}
                >
                  In Store
                  <small>{moveItem.warehouseQuantity} available to move</small>
                </button>
                <button
                  type="button"
                  className={moveStock.toLocation === "WAREHOUSE" ? styles.destinationActive : ""}
                  onClick={() => updateMoveDestination("WAREHOUSE")}
                >
                  Warehouse / Home
                  <small>{moveItem.inStoreQuantity} available to move</small>
                </button>
              </div>
            </div>

            <div className={styles.moveSection}>
              <div className={styles.quantityHeading}>
                <span className={styles.sectionLabel}>Quantity to move</span>
                <small>Available from {locationLabel(moveFromLocation)}: {moveAvailable}</small>
              </div>
              <div className={styles.quantityStepper}>
                <button type="button" onClick={() => updateMoveQuantity(moveQuantity - 1)} disabled={moveQuantity <= 1 || moveAvailable <= 0}>−</button>
                <input
                  type="number"
                  min="1"
                  max={Math.max(1, moveAvailable)}
                  value={moveQuantity}
                  disabled={moveAvailable <= 0}
                  onChange={(event) => updateMoveQuantity(Number(event.target.value))}
                  aria-label="Quantity to move"
                />
                <button type="button" onClick={() => updateMoveQuantity(moveQuantity + 1)} disabled={moveQuantity >= moveAvailable || moveAvailable <= 0}>+</button>
              </div>
              {moveAvailable > 1 ? <button className={styles.moveAllButton} type="button" onClick={() => updateMoveQuantity(moveAvailable)}>Move all {moveAvailable}</button> : null}
            </div>

            {moveAvailable > 0 ? (
              <div className={styles.previewCard}>
                <strong>After this move</strong>
                <div>
                  <span>In Store <b>{moveItem.inStoreQuantity + (moveStock.toLocation === "IN_STORE" ? moveQuantity : -moveQuantity)}</b></span>
                  <span>Warehouse / Home <b>{moveItem.warehouseQuantity + (moveStock.toLocation === "WAREHOUSE" ? moveQuantity : -moveQuantity)}</b></span>
                  <span>Total On Hand <b>{moveItem.onHandQuantity}</b></span>
                </div>
              </div>
            ) : (
              <div className={styles.noStockMessage}>There are no units in {locationLabel(moveFromLocation)} to move to {locationLabel(moveStock.toLocation)}.</div>
            )}

            <footer className={styles.modalActions}>
              <button className={styles.cancelButton} type="button" onClick={() => setMoveStock(null)} disabled={Boolean(savingId)}>Cancel</button>
              <button className={styles.confirmButton} type="button" onClick={() => void submitMove()} disabled={Boolean(savingId) || moveAvailable <= 0}>
                {savingId ? "Moving Stock…" : `Move ${moveQuantity} ${moveQuantity === 1 ? "Unit" : "Units"} to ${locationLabel(moveStock.toLocation)}`}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
