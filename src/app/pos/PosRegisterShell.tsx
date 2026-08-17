"use client";

import Link from "next/link";
import {
  Boxes,
  ChevronDown,
  LogOut,
  MoreHorizontal,
  ReceiptText,
  ShoppingCart,
  Store,
  Users
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { PosCustomersView, type PosRegisterCustomer } from "./PosCustomersView";
import { PosProductsView, type PosRegisterProduct } from "./PosProductsView";
import { PosSalesView } from "./PosSalesView";
import styles from "./PosRegisterShell.module.css";

type RegisterView = "checkout" | "products" | "customers" | "sales";

type SessionUser = {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
};

const SQUARE_PENDING_STORAGE_KEY = "gamedaygrabs-pos-square-pending-v1";
const SQUARE_PENDING_MAX_AGE_MS = 30 * 60 * 1000;

const tabs: Array<{ id: RegisterView; label: string; icon: typeof ShoppingCart }> = [
  { id: "checkout", label: "Checkout", icon: ShoppingCart },
  { id: "products", label: "Products", icon: Boxes },
  { id: "customers", label: "Customers", icon: Users },
  { id: "sales", label: "Sales", icon: ReceiptText }
];

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function dispatchEnterWithoutSearchFocus(input: HTMLInputElement) {
  const originalFocus = input.focus;
  const blockedFocus: typeof input.focus = () => undefined;
  input.focus = blockedFocus;
  try {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  } finally {
    input.focus = originalFocus;
  }
}

function activeSquarePending() {
  try {
    const raw = window.localStorage.getItem(SQUARE_PENDING_STORAGE_KEY) || window.sessionStorage.getItem(SQUARE_PENDING_STORAGE_KEY);
    if (!raw) return false;
    const pending = JSON.parse(raw) as { startedAt?: unknown };
    const startedAt = Number(pending.startedAt);
    if (!Number.isFinite(startedAt)) return true;
    return Date.now() - startedAt <= SQUARE_PENDING_MAX_AGE_MS;
  } catch {
    return true;
  }
}

function findCustomerSearchInput() {
  const labels = Array.from(document.querySelectorAll<HTMLElement>("label.pos-reference-input"));
  const label = labels.find((candidate) => candidate.textContent?.toLowerCase().includes("search customer"));
  return label?.querySelector<HTMLInputElement>("input") ?? null;
}

export function PosRegisterShell({ children }: { children: ReactNode }) {
  const [view, setView] = useState<RegisterView>("checkout");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const checkoutRef = useRef<HTMLDivElement | null>(null);

  const isAdmin = String(user?.role || "") === "ADMIN";
  const userLabel = user?.name?.trim() || user?.email?.trim() || "Register";

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("data")) setView("checkout");

    let active = true;
    let sessionResolved = false;
    const loadSession = async () => {
      try {
        const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
        const data = (await response.json()) as { user?: SessionUser | null };
        if (!active) return;
        setUser(data.user ?? null);
        if (data.user) sessionResolved = true;
      } catch {
        if (active && !sessionResolved) setUser(null);
      }
    };

    void loadSession();
    const timer = window.setInterval(() => {
      if (sessionResolved) {
        window.clearInterval(timer);
        return;
      }
      void loadSession();
    }, 1200);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const root = checkoutRef.current;
    if (!root) return;

    const markLegacyActions = () => {
      const controls = Array.from(root.querySelectorAll<HTMLElement>("a,button"));
      const marker = controls.find((control) => {
        const text = control.textContent?.trim().toLowerCase();
        return text === "exit store mode" || text === "cashier accounts" || text === "sign out";
      });
      const actionRow = marker?.parentElement;
      if (actionRow) actionRow.classList.add("pos-legacy-actions");
    };

    markLegacyActions();
    const observer = new MutationObserver(markLegacyActions);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [menuOpen]);

  function selectView(nextView: RegisterView) {
    setMenuOpen(false);
    if (nextView !== "checkout" && activeSquarePending()) {
      setNotice("Finish or cancel the current Square payment before leaving Checkout.");
      setView("checkout");
      return;
    }
    setNotice(null);
    setView(nextView);
  }

  function openProductAtCheckout(product: PosRegisterProduct) {
    selectView("checkout");
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(".pos-search-input input");
      if (!input) return;
      const exactCode = product.upc || product.sku;
      setControlledInputValue(input, exactCode || product.title);
      if (exactCode) {
        window.setTimeout(() => {
          // Dispatch the existing Enter-to-add path without allowing RadarApp's
          // legacy post-add refocus to summon the iPad software keyboard.
          dispatchEnterWithoutSearchFocus(input);
        }, 40);
      }
    }, 80);
  }

  function openCustomerAtCheckout(customer: PosRegisterCustomer) {
    selectView("checkout");
    window.setTimeout(() => {
      const input = findCustomerSearchInput();
      if (!input) return;
      setControlledInputValue(input, customer.displayName);
      input.focus();
      window.setTimeout(() => {
        const panel = input.closest(".pos-customer-panel");
        const searchButton = Array.from(panel?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((button) =>
          button.textContent?.trim().toLowerCase().startsWith("search")
        );
        searchButton?.click();
      }, 80);
    }, 80);
  }

  async function signOut() {
    setMenuOpen(false);
    const response = await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
    if (response.ok) window.location.assign("/pos");
    else setNotice("Could not sign out. Try again.");
  }

  return (
    <div className={styles.shell} data-pos-register-view={view} data-pos-authenticated={user ? "true" : "false"}>
      {user ? (
        <header className={styles.header}>
          <div className={styles.brand} aria-label="GameDayGrabs POS">
            <span className={styles.brandMark}>G</span>
            <div><strong>GameDayGrabs</strong><small>Point of Sale</small></div>
          </div>

          <nav className={styles.tabs} aria-label="Register sections">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = view === tab.id;
              return (
                <button
                  type="button"
                  key={tab.id}
                  className={active ? styles.activeTab : ""}
                  aria-current={active ? "page" : undefined}
                  onClick={() => selectView(tab.id)}
                >
                  <Icon size={18} strokeWidth={2} aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>

          <div className={styles.account} ref={menuRef}>
            <button type="button" className={styles.accountButton} onClick={() => setMenuOpen((current) => !current)} aria-expanded={menuOpen}>
              <span className={styles.userAvatar}>{userLabel.slice(0, 1).toUpperCase()}</span>
              <span className={styles.userCopy}><strong>{userLabel}</strong><small>{isAdmin ? "Admin" : "Cashier"}</small></span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className={styles.accountMenu} role="menu">
                {isAdmin ? (
                  <>
                    <Link role="menuitem" href="/admin/inventory-locations"><Store size={16} />Inventory Locations</Link>
                    <Link role="menuitem" href="/admin/cashiers"><Users size={16} />Cashier Accounts</Link>
                    <Link role="menuitem" href="/admin?tab=pos"><MoreHorizontal size={16} />Admin Dashboard</Link>
                    <div className={styles.menuDivider} />
                  </>
                ) : null}
                <button type="button" role="menuitem" onClick={() => void signOut()}><LogOut size={16} />Sign Out</button>
              </div>
            ) : null}
          </div>
        </header>
      ) : null}

      {notice && user ? <div className={styles.notice} role="status">{notice}<button type="button" onClick={() => setNotice(null)}>Dismiss</button></div> : null}

      <div
        ref={checkoutRef}
        className={user && view !== "checkout" ? `${styles.checkoutHost} ${styles.checkoutHidden}` : user ? styles.checkoutHost : undefined}
        aria-hidden={Boolean(user && view !== "checkout")}
      >
        {children}
      </div>

      {user && view === "products" ? <PosProductsView onCheckout={openProductAtCheckout} /> : null}
      {user && view === "customers" ? <PosCustomersView onCheckout={openCustomerAtCheckout} /> : null}
      {user && view === "sales" ? <PosSalesView isAdmin={isAdmin} /> : null}
    </div>
  );
}
