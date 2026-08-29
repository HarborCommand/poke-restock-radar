"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import styles from "./pos-store-mode.module.css";

const RadarApp = dynamic(
  () => import("@/components/RadarApp").then((module) => module.RadarApp),
  { ssr: false }
);

type InventoryLocation = "IN_STORE" | "WAREHOUSE";

type PosSessionUser = {
  id: string;
  email: string;
  name: string;
  role: string;
};

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
  items: LocationItem[];
};

type StoredCartLine = {
  inventoryItemId: string;
  quantity: number;
};

const CART_STORAGE_PREFIX = "gamedaygrabs-pos-cart-v1:";

function locationLabel(location: InventoryLocation) {
  return location === "IN_STORE" ? "In Store" : "Warehouse / Home";
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function normalizedText(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function itemMatchesTitle(item: LocationItem, title: string) {
  const normalizedTitle = normalizedText(title);
  return normalizedTitle === normalizedText(item.publicTitle) || normalizedTitle === normalizedText(item.itemName);
}

function findLocationItemForCartLine(line: Element, items: LocationItem[]) {
  const title = line.querySelector(".pos-cart-line-copy strong")?.textContent?.trim() || "";
  const identifier = line.querySelector(".pos-cart-line-copy > span")?.textContent?.trim() || "";
  const normalizedIdentifier = normalizedText(identifier);

  return items.find((item) => {
    if (item.location !== "IN_STORE") return false;
    if (item.upc && normalizedIdentifier.includes(normalizedText(item.upc))) return true;
    if (item.sku && normalizedIdentifier.includes(normalizedText(item.sku))) return true;
    return itemMatchesTitle(item, title);
  });
}

function findProductCard(item: LocationItem) {
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".pos-product-card"));
  return cards.find((card) => {
    const title = card.querySelector(".pos-product-copy strong")?.textContent?.trim() || "";
    const text = normalizedText(card.textContent);
    if (item.upc && text.includes(normalizedText(item.upc))) return true;
    if (item.sku && text.includes(normalizedText(item.sku))) return true;
    return itemMatchesTitle(item, title);
  });
}

function parseStoredCart(storageKey: string): StoredCartLine[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
        const record = entry as Record<string, unknown>;
        const inventoryItemId = String(record.inventoryItemId || "").trim();
        const quantity = Math.max(1, Math.min(1000, Math.floor(Number(record.quantity) || 1)));
        return inventoryItemId ? { inventoryItemId, quantity } : null;
      })
      .filter((entry): entry is StoredCartLine => Boolean(entry));
  } catch {
    return [];
  }
}

export default function PosStoreModePage() {
  const [authChecked, setAuthChecked] = useState(false);
  const [sessionUser, setSessionUser] = useState<PosSessionUser | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [locationItems, setLocationItems] = useState<LocationItem[]>([]);
  const [locationPanelOpen, setLocationPanelOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState<"ALL" | InventoryLocation>("ALL");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [savingLocationId, setSavingLocationId] = useState<string | null>(null);
  const [radarKey, setRadarKey] = useState(0);
  const locationByIdRef = useRef<Map<string, InventoryLocation>>(new Map());
  const locationItemsRef = useRef<LocationItem[]>([]);
  const originalFetchRef = useRef<typeof window.fetch | null>(null);
  const restoringCartRef = useRef(false);

  const userRole = String(sessionUser?.role || "");
  const isAdmin = userRole === "ADMIN";
  const isCashier = userRole === "CASHIER";
  const hasPosAccess = isAdmin || isCashier;

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") !== "pos") {
      url.searchParams.set("tab", "pos");
      window.history.replaceState(window.history.state, "", url);
    }

    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;

    void (async () => {
      try {
        const response = await originalFetch("/api/auth/session", { credentials: "same-origin" });
        const data = (await response.json()) as { user?: PosSessionUser | null };
        if (!active) return;
        setSessionUser(data.user ?? null);
      } catch {
        if (!active) return;
        setSessionUser(null);
      } finally {
        if (active) setAuthChecked(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionUser || !hasPosAccess) {
      setReady(false);
      return;
    }

    let active = true;
    let restoreFetch: (() => void) | null = null;
    let removeAddHandler: (() => void) | null = null;

    void (async () => {
      const originalFetch = originalFetchRef.current ?? window.fetch.bind(window);
      originalFetchRef.current = originalFetch;

      try {
        const response = await originalFetch("/api/radar/inventory-locations", {
          credentials: "same-origin"
        });
        if (!response.ok) throw new Error("Could not load inventory locations.");
        const data = (await response.json()) as LocationResponse;
        if (!active) return;
        setLocationItems(data.items);
        locationItemsRef.current = data.items;
        locationByIdRef.current = new Map(data.items.map((item) => [item.id, item.location]));
        setLocationError(null);
      } catch (error) {
        if (!active) return;
        setLocationError(error instanceof Error ? error.message : "Could not load inventory locations.");
        setLocationItems([]);
        locationItemsRef.current = [];
        locationByIdRef.current = new Map();
      }

      const storeFetch: typeof window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : input.toString();
        const requestedUrl = new URL(rawUrl, window.location.origin);
        const pathname = requestedUrl.pathname;
        const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();

        let fetchInput: RequestInfo | URL = input;
        if (isCashier && method === "GET" && pathname === "/api/radar/dashboard") {
          const replacement = new URL("/api/radar/pos/dashboard", window.location.origin);
          replacement.search = requestedUrl.search;
          fetchInput = replacement;
        } else if (isCashier && method === "GET" && pathname === "/api/radar/customers") {
          const replacement = new URL("/api/radar/pos/customer-search", window.location.origin);
          replacement.search = requestedUrl.search;
          fetchInput = replacement;
        }

        const response = await originalFetch(fetchInput, init);

        try {
          if (!response.ok || method !== "GET") return response;

          if (isCashier && pathname === "/api/auth/session") {
            const data = (await response.clone().json()) as Record<string, unknown>;
            if (data.user && typeof data.user === "object" && !Array.isArray(data.user)) {
              data.user = { ...(data.user as Record<string, unknown>), role: "ADMIN" };
            }
            const headers = new Headers(response.headers);
            headers.delete("content-length");
            headers.delete("content-encoding");
            headers.set("content-type", "application/json; charset=utf-8");
            return new Response(JSON.stringify(data), {
              status: response.status,
              statusText: response.statusText,
              headers
            });
          }

          if (pathname !== "/api/radar/dashboard") return response;

          const data = (await response.clone().json()) as Record<string, unknown>;
          if (Array.isArray(data.inventory)) {
            data.inventory = data.inventory.filter((entry) => {
              if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
              const id = String((entry as Record<string, unknown>).id || "");
              return locationByIdRef.current.get(id) !== "WAREHOUSE";
            });
          }
          if (isCashier && data.currentUser && typeof data.currentUser === "object" && !Array.isArray(data.currentUser)) {
            data.currentUser = { ...(data.currentUser as Record<string, unknown>), role: "ADMIN" };
          }

          const headers = new Headers(response.headers);
          headers.delete("content-length");
          headers.delete("content-encoding");
          headers.set("content-type", "application/json; charset=utf-8");

          return new Response(JSON.stringify(data), {
            status: response.status,
            statusText: response.statusText,
            headers
          });
        } catch {
          return response;
        }
      };

      window.fetch = storeFetch;
      restoreFetch = () => {
        if (window.fetch === storeFetch) window.fetch = originalFetch;
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
      removeAddHandler = () => document.removeEventListener("click", handlePosAddClick);

      if (active) setReady(true);
    })();

    return () => {
      active = false;
      setReady(false);
      removeAddHandler?.();
      restoreFetch?.();
    };
  }, [hasPosAccess, isCashier, sessionUser]);

  useEffect(() => {
    if (!ready || !sessionUser || !hasPosAccess) return;

    let active = true;
    let observer: MutationObserver | null = null;
    let saveTimer: number | null = null;
    const storageKey = `${CART_STORAGE_PREFIX}${sessionUser.id}`;

    const saveCart = () => {
      if (!active || restoringCartRef.current) return;
      const items = locationItemsRef.current;
      const lines = Array.from(document.querySelectorAll<HTMLElement>(".pos-cart-line"));
      const stored = lines
        .map((line) => {
          const item = findLocationItemForCartLine(line, items);
          if (!item) return null;
          const quantityInput = line.querySelector<HTMLInputElement>('input[aria-label="Quantity"]');
          const quantity = Math.max(1, Math.floor(Number(quantityInput?.value) || 1));
          return { inventoryItemId: item.id, quantity };
        })
        .filter((line): line is StoredCartLine => Boolean(line));
      window.localStorage.setItem(storageKey, JSON.stringify(stored));
    };

    const scheduleSave = () => {
      if (restoringCartRef.current) return;
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(saveCart, 80);
    };

    const restoreSavedCart = async () => {
      for (let attempt = 0; attempt < 50 && active; attempt += 1) {
        const searchInput = document.querySelector<HTMLInputElement>(".pos-search-input input");
        const cartPanel = document.querySelector<HTMLElement>(".pos-cart-panel");
        if (searchInput && cartPanel) break;
        await sleep(100);
      }
      if (!active) return;

      const searchInput = document.querySelector<HTMLInputElement>(".pos-search-input input");
      const cartPanel = document.querySelector<HTMLElement>(".pos-cart-panel");
      if (!searchInput || !cartPanel) return;

      const saved = parseStoredCart(storageKey);
      restoringCartRef.current = true;
      try {
        for (const savedLine of saved) {
          if (!active) return;
          const item = locationItemsRef.current.find(
            (candidate) => candidate.id === savedLine.inventoryItemId && candidate.location === "IN_STORE"
          );
          if (!item) continue;

          const query = item.upc || item.sku || item.publicTitle || item.itemName;
          setControlledInputValue(searchInput, query);
          await sleep(140);

          for (let count = 0; count < savedLine.quantity; count += 1) {
            const currentCard = findProductCard(item);
            if (!currentCard) break;
            const addButton = Array.from(currentCard.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
              const text = button.textContent?.trim() || "";
              return text === "Add" || text.startsWith("Added");
            });
            if (!addButton || addButton.disabled) break;
            addButton.click();
            await sleep(65);
          }
        }
      } finally {
        setControlledInputValue(searchInput, "");
        searchInput.blur();
        restoringCartRef.current = false;
      }

      observer = new MutationObserver(scheduleSave);
      observer.observe(cartPanel, { subtree: true, childList: true, characterData: true, attributes: true });
      document.addEventListener("input", scheduleSave, true);
      document.addEventListener("click", scheduleSave, true);
      window.setTimeout(saveCart, 120);
    };

    void restoreSavedCart();

    return () => {
      active = false;
      observer?.disconnect();
      document.removeEventListener("input", scheduleSave, true);
      document.removeEventListener("click", scheduleSave, true);
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      restoringCartRef.current = false;
    };
  }, [hasPosAccess, radarKey, ready, sessionUser]);

  const visibleLocationItems = useMemo(() => {
    const search = locationSearch.trim().toLowerCase();
    return locationItems.filter((item) => {
      if (locationFilter !== "ALL" && item.location !== locationFilter) return false;
      if (!search) return true;
      return [item.itemName, item.publicTitle, item.category, item.setName, item.upc, item.sku]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search));
    });
  }, [locationFilter, locationItems, locationSearch]);

  const inStoreCount = locationItems.filter((item) => item.location === "IN_STORE").length;
  const warehouseCount = locationItems.filter((item) => item.location === "WAREHOUSE").length;

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loginBusy) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const originalFetch = originalFetchRef.current ?? window.fetch.bind(window);
    setLoginBusy(true);
    setLoginError(null);

    try {
      const response = await originalFetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.get("email"), password: formData.get("password") })
      });
      const data = (await response.json()) as { user?: PosSessionUser; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || "Could not sign in.");
      const role = String(data.user.role);
      if (role !== "ADMIN" && role !== "CASHIER") {
        await originalFetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
        throw new Error("This account does not have POS access.");
      }
      setSessionUser(data.user);
      setAuthChecked(true);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    const originalFetch = originalFetchRef.current ?? window.fetch.bind(window);
    try {
      await originalFetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.assign("/pos");
    }
  }

  async function updateLocation(item: LocationItem, location: InventoryLocation) {
    if (!isAdmin || item.location === location || savingLocationId) return;
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

      const nextItems = locationItemsRef.current.map((currentItem) =>
        currentItem.id === item.id ? { ...currentItem, location } : currentItem
      );
      locationItemsRef.current = nextItems;
      setLocationItems(nextItems);
      locationByIdRef.current.set(item.id, location);
      setRadarKey((current) => current + 1);
    } catch (error) {
      setLocationError(error instanceof Error ? error.message : "Could not update inventory location.");
    } finally {
      setSavingLocationId(null);
    }
  }

  if (!authChecked) {
    return <div className={styles.loading}>Opening Store POS…</div>;
  }

  if (!sessionUser) {
    return (
      <main className={styles.loginPage}>
        <form className={styles.loginCard} onSubmit={login}>
          <span className={styles.loginEyebrow}>GameDayGrabs</span>
          <h1>Store POS</h1>
          <p>Sign in with the store cashier account to start selling.</p>
          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="username" required autoFocus />
          </label>
          <label>
            <span>Password</span>
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {loginError ? <div className={styles.loginError}>{loginError}</div> : null}
          <button type="submit" disabled={loginBusy}>{loginBusy ? "Signing in…" : "Sign In to POS"}</button>
        </form>
      </main>
    );
  }

  if (!hasPosAccess) {
    return (
      <main className={styles.loginPage}>
        <div className={styles.loginCard}>
          <span className={styles.loginEyebrow}>GameDayGrabs</span>
          <h1>POS access required</h1>
          <p>This account is not an Admin or Cashier account.</p>
          <button type="button" onClick={() => void logout()}>Sign Out</button>
        </div>
      </main>
    );
  }

  return (
    <div className={styles.storeMode} data-pos-store-mode="true">
      <div className={styles.storeActions}>
        {isAdmin ? (
          <>
            <Link className={styles.storeActionButton} href="/admin/cashiers">Cashier Accounts</Link>
            <button className={styles.storeActionButton} type="button" onClick={() => setLocationPanelOpen(true)}>Locations</button>
            <Link className={styles.storeActionButton} href="/admin?tab=pos">Exit Store Mode</Link>
          </>
        ) : (
          <>
            <span className={styles.cashierBadge}>{sessionUser.name || "Cashier"}</span>
            <button className={styles.storeActionButton} type="button" onClick={() => void logout()}>Sign Out</button>
          </>
        )}
      </div>

      {isAdmin && locationPanelOpen ? (
        <div className={styles.locationOverlay} role="dialog" aria-modal="true" aria-label="Inventory locations">
          <div className={styles.locationPanel}>
            <div className={styles.locationHeader}>
              <div>
                <h2>Inventory Locations</h2>
                <p>{inStoreCount} in store · {warehouseCount} warehouse / home</p>
              </div>
              <button type="button" onClick={() => setLocationPanelOpen(false)} aria-label="Close inventory locations">Close</button>
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
                      <strong>{item.publicTitle || item.itemName}</strong>
                      <span>Qty {item.quantity}{item.setName ? ` · ${item.setName}` : ""}</span>
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

      {ready ? <RadarApp key={radarKey} /> : <div className={styles.loading} role="status" aria-live="polite">Opening POS…</div>}
    </div>
  );
}
