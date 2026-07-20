"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  BadgeCheck,
  Check,
  ChevronDown,
  ChevronRight,
  CreditCard,
  ExternalLink,
  Lock,
  Mail,
  Menu,
  MessageCircle,
  Minus,
  Package,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Trash2,
  Truck,
  Trophy,
  User,
  X
} from "lucide-react";
import { GAMEDAYGRABS_SPORTS_CARDS_URL } from "@/lib/storefront-routing";
import { GrabbyCard } from "@/components/brand/GrabbyCard";
import {
  storefrontImageBadges,
  storefrontMatchesAvailability,
  storefrontPrimaryActionDisabled,
  isSoldOutProduct,
  isNewArrival,
  type StorefrontAvailabilityFilter
} from "@/lib/storefront-badges";
import { displayStorefrontCategory, storefrontCategoryMatches } from "@/lib/storefront-categories";
import { storefrontProductCardSubtitle } from "@/lib/storefront-card-copy";
import { cleanStorefrontDescription, cleanStorefrontTitle, storefrontSoldOutNote } from "@/lib/storefront-copy";
import {
  GAMEDAYGRABS_AUTHENTICITY_SOURCE_DISCLOSURE,
  GAMEDAYGRABS_FOOTER_AFFILIATION_DISCLOSURE,
  GAMEDAYGRABS_FOOTER_RETAILER_DISCLOSURE,
  GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE,
  GAMEDAYGRABS_PRODUCT_SELLER_DISCLOSURE
} from "@/lib/storefront-disclosures";
import { GAMEDAYGRABS_EBAY_FEEDBACK_URL, storefrontFeedback } from "@/lib/storefront-feedback";
import {
  homepageFeaturedDropsSection,
  selectHomepageHeroProduct,
  type HomepageMerchandisingSection
} from "@/lib/storefront-home";
import {
  storefrontCollectionPath,
  storefrontCollectionPathForCategory,
  type StorefrontCollectionDefinition
} from "@/lib/storefront-collections";
import { isStorefrontDisplayImageUrl } from "@/lib/product-image-quality";
import { calculateCartShipping } from "@/lib/shipping";
import {
  storefrontAvailabilityDetail,
  storefrontAvailabilityLabel,
  storefrontEffectiveMaxQuantity,
  storefrontPurchaseLimitLabel
} from "@/lib/storefront-purchase-limits";
import {
  normalizeStorefrontShopAvailability,
  normalizeStorefrontShopPage,
  normalizeStorefrontShopQuery,
  normalizeStorefrontShopSort,
  type StorefrontShopAvailability,
  type StorefrontShopSort
} from "@/lib/storefront-shop-query";
import { trackStorefrontEvent } from "@/lib/storefront-analytics";
import type { PublicStoreProductDTO, StorefrontSettingsDTO } from "@/types/radar";

type CartItem = { id: string; quantity: number };

type ShippingQuoteResult = {
  quoteId: string;
  carrier: string;
  service: string;
  amount: number;
  amountCents: number;
  currency: string;
  destinationZip: string;
  expiresAt: string;
  fallbackUsed: boolean;
  warning: string | null;
};

type CustomerAccountSession = {
  enabled: boolean;
  account: { email: string; displayName: string | null; emailVerified: boolean } | null;
  session: { authenticated: boolean };
  timeout?: {
    enabled: boolean;
    idleExpiresAt: string | null;
    absoluteExpiresAt: string | null;
    warningSeconds: number;
    activityTouchIntervalSeconds: number;
    serverNow: string;
    expiredReason: string | null;
  };
};

const cartKey = "poke-radar-cart";
const customerSessionEventKey = "gdg-customer-session-event";
const customerSessionEventName = "gdg-customer-session";
const emptyCartSnapshot: CartItem[] = [];
let cartSnapshotRaw = "[]";
let cartSnapshotCache: CartItem[] = emptyCartSnapshot;
const storefrontLogoPath = "/brand/gamedaygrabs-logo-horizontal.png";
const storefrontLogoWidth = 256;
const storefrontLogoHeight = 50;
const preferredCategories = [
  "Pokemon Sealed",
  "Booster Bundles",
  "Booster Boxes",
  "Elite Trainer Boxes",
  "Premium Collections",
  "Sleeved Boosters",
  "Blisters",
  "Tins",
  "Collection Boxes",
  "Accessories",
  "Sports Cards",
  "Graded Cards"
];
const homeCategories = [
  "Booster Bundles",
  "Tins",
  "Blisters",
  "Premium Collections",
  "New Arrivals"
];

const customerAccountMenuLinks = [
  { href: "/account", label: "My Account" },
  { href: "/account/orders", label: "My Orders" },
  { href: "/account/rewards", label: "Rewards" },
  { href: "/account/addresses", label: "Saved Addresses" },
  { href: "/order-status", label: "Order Status" }
];

const categorySubtitles: Record<string, string> = {
  "Pokemon Sealed": "Sealed Pokémon products",
  "Booster Bundles": "Compact pack bundles",
  "Booster Boxes": "Full display boxes",
  "Elite Trainer Boxes": "ETBs and trainer kits",
  "Premium Collections": "Collector boxes",
  "Sleeved Boosters": "Single pack products",
  "Blisters": "Blisters and checklanes",
  "Tins": "Tins and Poké Balls",
  "Collection Boxes": "Boxed collections",
  "Accessories": "Storage and collector gear",
  "New Arrivals": "Freshly added drops",
  "Sports Cards": "Shop on eBay",
  "Graded Cards": "Slabs and singles"
};

function categoryToSlug(category: string) {
  return category
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function categoryFromParam(value: string | null | undefined) {
  if (!value) return "all";
  const normalized = categoryToSlug(value);
  if (normalized === "pokemon") return "Pokemon Sealed";
  const match = preferredCategories.find((entry) => categoryToSlug(entry) === normalized);
  return match ?? "all";
}

function sortFromParam(value: string | null | undefined): StorefrontShopSort {
  return normalizeStorefrontShopSort(value);
}

function availabilityFromParam(value: string | null | undefined): StorefrontAvailabilityFilter {
  return normalizeStorefrontShopAvailability(value);
}

function categoryHref(category: string) {
  if (category === "New Arrivals") return storefrontCollectionPath("new-arrivals");
  return storefrontCollectionPathForCategory(category) ?? `/shop?category=${categoryToSlug(category)}`;
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "TBD";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function availabilitySortScore(product: Pick<PublicStoreProductDTO, "availabilityLevel" | "status">) {
  if (isSoldOutProduct(product)) return 0;
  if (product.availabilityLevel === "almost_gone") return 1;
  if (product.availabilityLevel === "low_stock") return 2;
  return 3;
}

function publicCategoryLabel(category: string) {
  return cleanStorefrontTitle(category);
}

function productIncludedBullets(product: PublicStoreProductDTO, displayCategory: string, conditionLabel: string) {
  const bullets = [`Product type: ${displayCategory}.`];
  if (product.setName && !product.title.toLowerCase().includes(product.setName.toLowerCase())) {
    bullets.push(`Set/series: ${cleanStorefrontTitle(product.setName)}.`);
  }
  if (conditionLabel) {
    bullets.push(`Condition shown by listing: ${conditionLabel}.`);
  }
  return Array.from(new Set(bullets));
}

function displayStoreName(settings: StorefrontSettingsDTO) {
  if (settings.storeName && !/poke radar/i.test(settings.storeName)) {
    return settings.storeName.replace(/\s+LLC\b/i, "").trim();
  }
  return "GameDayGrabs";
}

function checkoutModeLabel(settings: StorefrontSettingsDTO) {
  return settings.checkoutConfigured ? "Add to Cart" : "Request Invoice";
}

const STOREFRONT_TAX_PAYMENT_COPY = "Any required taxes are shown before payment.";

function storefrontRewardsProgramCopy(settings: StorefrontSettingsDTO) {
  if (!settings.customerAccounts.enabled || !settings.customerAccounts.rewardsEnabled) return null;
  return settings.customerAccounts.redemptionEnabled
    ? "Earn points on eligible purchases."
    : "Earn points now. Redemption coming soon.";
}

function storefrontRewardEstimateLabel(product: PublicStoreProductDTO, settings: StorefrontSettingsDTO) {
  if (!settings.customerAccounts.enabled || !settings.customerAccounts.rewardsEnabled) return null;
  if (isSoldOutProduct(product)) return null;
  const points = Math.floor(Math.max(0, product.price));
  if (points <= 0) return null;
  return `Earn ${points.toLocaleString()} point${points === 1 ? "" : "s"}`;
}

function storefrontFulfillmentBadges(product: PublicStoreProductDTO) {
  const badges: string[] = [];
  if (product.shippingAvailable) badges.push("Ships");
  if (product.localPickupEligible) badges.push("Local Pickup");
  return badges.length ? badges : ["Fulfillment pending"];
}

function sportsCardsLink(settings: StorefrontSettingsDTO) {
  const externalUrl = settings.sportsCardsExternalUrl?.trim() || GAMEDAYGRABS_SPORTS_CARDS_URL;
  return {
    href: externalUrl || "/shop?category=sports-cards",
    external: Boolean(externalUrl)
  };
}

function productImageCandidates(product: Pick<PublicStoreProductDTO, "primaryImageUrl" | "imageUrl" | "images">) {
  const seen = new Set<string>();
  return [product.primaryImageUrl, product.imageUrl, ...(product.images ?? [])]
    .map((image) => image?.trim())
    .filter((image): image is string => Boolean(image))
    .filter(isStorefrontDisplayImageUrl)
    .filter((image) => {
      if (seen.has(image)) return false;
      seen.add(image);
      return true;
    });
}

function productImageUrl(product: Pick<PublicStoreProductDTO, "primaryImageUrl" | "imageUrl" | "images">) {
  return productImageCandidates(product)[0] ?? null;
}

function readCart(): CartItem[] {
  return getCartSnapshot();
}

function getCartSnapshot(): CartItem[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(cartKey) || "[]";
  if (raw === cartSnapshotRaw) return cartSnapshotCache;
  try {
    const parsed = JSON.parse(raw);
    cartSnapshotRaw = raw;
    if (Array.isArray(parsed)) {
      cartSnapshotCache = parsed
        .map((item) => ({ id: String(item.id || ""), quantity: Number(item.quantity || 0) }))
        .filter((item) => item.id && item.quantity > 0);
      return cartSnapshotCache;
    }
  } catch {
    cartSnapshotRaw = raw;
    cartSnapshotCache = emptyCartSnapshot;
    return cartSnapshotCache;
  }
  cartSnapshotCache = emptyCartSnapshot;
  return cartSnapshotCache;
}

function getServerCartSnapshot(): CartItem[] {
  return emptyCartSnapshot;
}

function broadcastCustomerSessionEvent(reason: "logout" | "expired" | "refreshed") {
  if (typeof window === "undefined") return;
  const payload = { reason, at: Date.now() };
  window.dispatchEvent(new CustomEvent(customerSessionEventName, { detail: payload }));
  try {
    window.localStorage.setItem(customerSessionEventKey, JSON.stringify(payload));
  } catch {
    // Session broadcasts are best-effort only; never affect cart or checkout state.
  }
}

function useCustomerAccountSession(enabled: boolean) {
  const [session, setSession] = useState<CustomerAccountSession | null>(null);

  const refreshSession = useCallback(async () => {
    if (!enabled) {
      setSession(null);
      return null;
    }
    try {
      const response = await fetch("/api/account/session", { cache: "no-store", credentials: "same-origin" });
      const data = response.ok ? ((await response.json()) as CustomerAccountSession) : null;
      setSession(data);
      return data;
    } catch {
      setSession(null);
      return null;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clears stale customer account state when the public account feature is disabled.
      setSession(null);
      return;
    }

    let active = true;
    fetch("/api/account/session", { cache: "no-store", credentials: "same-origin" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: CustomerAccountSession | null) => {
        if (active) setSession(data);
      })
      .catch(() => {
        if (active) setSession(null);
      });

    return () => {
      active = false;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    function handleSessionEvent(event: Event) {
      const detail =
        event instanceof CustomEvent
          ? event.detail
          : event instanceof StorageEvent && event.key === customerSessionEventKey
            ? (() => {
                try {
                  return event.newValue ? JSON.parse(event.newValue) : null;
                } catch {
                  return null;
                }
              })()
            : null;
      if (!detail || typeof detail.reason !== "string") return;
      if (detail.reason === "logout" || detail.reason === "expired") {
        setSession(null);
        if (window.location.pathname.startsWith("/account")) {
          const login = new URL("/account/login", window.location.origin);
          login.searchParams.set(detail.reason === "expired" ? "session" : "signedOut", "1");
          window.location.assign(login.toString());
        }
      } else if (detail.reason === "refreshed") {
        void refreshSession();
      }
    }

    window.addEventListener(customerSessionEventName, handleSessionEvent);
    window.addEventListener("storage", handleSessionEvent);
    return () => {
      window.removeEventListener(customerSessionEventName, handleSessionEvent);
      window.removeEventListener("storage", handleSessionEvent);
    };
  }, [enabled, refreshSession]);

  return {
    session,
    setSession,
    refreshSession
  };
}

function CustomerSessionExpiryController({
  session,
  setSession,
  refreshSession
}: {
  session: CustomerAccountSession | null;
  setSession: (session: CustomerAccountSession | null) => void;
  refreshSession: () => Promise<CustomerAccountSession | null>;
}) {
  const [warningOpen, setWarningOpen] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const timeout = session?.timeout;
  const authenticated = Boolean(session?.session.authenticated);

  const expireLocally = useCallback(() => {
    setWarningOpen(false);
    setSession(null);
    broadcastCustomerSessionEvent("expired");
  }, [setSession]);

  useEffect(() => {
    if (!authenticated || !timeout?.enabled || !timeout.idleExpiresAt || timeout.expiredReason) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Closes the warning immediately when the authenticated session/timeout is no longer active.
      setWarningOpen(false);
      setRemainingSeconds(null);
      return;
    }

    const serverOffsetMs = Date.parse(timeout.serverNow) - Date.now();
    const idleExpiresAtMs = Date.parse(timeout.idleExpiresAt);
    const warningSeconds = Math.max(10, Number(timeout.warningSeconds || 60));
    let countdownTimer: number | undefined;

    function msUntilIdleExpiration() {
      return idleExpiresAtMs - (Date.now() + serverOffsetMs);
    }

    function updateCountdown() {
      setRemainingSeconds(Math.max(0, Math.ceil(msUntilIdleExpiration() / 1000)));
    }

    const warningDelayMs = Math.max(0, msUntilIdleExpiration() - warningSeconds * 1000);
    const expiryDelayMs = Math.max(0, msUntilIdleExpiration());
    const warningTimer = window.setTimeout(() => {
      setWarningOpen(true);
      updateCountdown();
      countdownTimer = window.setInterval(updateCountdown, 1000);
    }, warningDelayMs);
    const expiryTimer = window.setTimeout(expireLocally, expiryDelayMs);

    return () => {
      if (warningTimer !== undefined) window.clearTimeout(warningTimer);
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
      if (countdownTimer !== undefined) window.clearInterval(countdownTimer);
    };
  }, [authenticated, expireLocally, timeout?.enabled, timeout?.expiredReason, timeout?.idleExpiresAt, timeout?.serverNow, timeout?.warningSeconds]);

  async function staySignedIn() {
    const response = await fetch("/api/account/session/refresh", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin"
    }).catch(() => null);
    if (!response?.ok) {
      expireLocally();
      return;
    }
    setWarningOpen(false);
    await refreshSession();
    broadcastCustomerSessionEvent("refreshed");
  }

  async function signOut() {
    await fetch("/api/account/logout", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin"
    }).catch(() => null);
    setWarningOpen(false);
    setSession(null);
    broadcastCustomerSessionEvent("logout");
    window.location.assign("/account/login?signedOut=1");
  }

  if (!warningOpen || !authenticated) return null;

  return (
    <div className="gdg-session-warning" role="dialog" aria-modal="true" aria-labelledby="gdg-session-warning-title">
      <div className="gdg-session-warning-card">
        <ShieldCheck size={24} aria-hidden="true" />
        <div>
          <p className="gdg-overline">Customer Session</p>
          <h2 id="gdg-session-warning-title">Your session is about to expire due to inactivity.</h2>
          <p>
            Stay signed in to keep viewing your account. Guest cart items remain separate and are not removed.
            {remainingSeconds !== null ? ` ${remainingSeconds} seconds remaining.` : ""}
          </p>
        </div>
        <div className="gdg-session-warning-actions">
          <button type="button" className="gdg-primary-button" onClick={staySignedIn}>Stay signed in</button>
          <button type="button" className="gdg-secondary-button" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div>
  );
}

function subscribeCart(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener("poke-radar-cart", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("poke-radar-cart", callback);
  };
}

function writeCart(items: CartItem[]) {
  const raw = JSON.stringify(items);
  cartSnapshotRaw = raw;
  cartSnapshotCache = items;
  window.localStorage.setItem(cartKey, raw);
  window.dispatchEvent(new CustomEvent("poke-radar-cart", { detail: items }));
}

function addToCart(product: PublicStoreProductDTO, quantity = 1) {
  const cart = readCart();
  const existing = cart.find((item) => item.id === product.id);
  const effectiveMaxQuantity = storefrontEffectiveMaxQuantity(product);
  if (effectiveMaxQuantity <= 0) return;
  const nextQuantity = Math.min(effectiveMaxQuantity, Math.max(1, (existing?.quantity ?? 0) + quantity));
  const next = existing
    ? cart.map((item) => (item.id === product.id ? { ...item, quantity: nextQuantity } : item))
    : [...cart, { id: product.id, quantity: nextQuantity }];
  writeCart(next);
  trackStorefrontEvent("product_added_to_cart", {
    productSlug: product.slug,
    productCategory: displayStorefrontCategory(product),
    productStatus: product.status,
    quantity
  });
}

function categoryPreviewCards(products: PublicStoreProductDTO[], categories: string[]) {
  const usedImages = new Set<string>();
  return categories.slice(0, 6).map((category) => {
    const useProductImage = category !== "Sports Cards" && category !== "Graded Cards";
    const matchedProduct = useProductImage
      ? (products.find((product) => {
          const image = productImageUrl(product);
          if (!image || usedImages.has(image)) return false;
          const specificCategory = displayStorefrontCategory(product);
          if (category === "Pokemon Sealed" && specificCategory !== "Pokemon Sealed") return false;
          if (category !== "Pokemon Sealed" && specificCategory !== category && !storefrontCategoryMatches(product, category)) return false;
          usedImages.add(image);
          return true;
        }) ?? null)
      : null;
    return { category, imageUrl: matchedProduct ? productImageUrl(matchedProduct) : null, subtitle: categorySubtitles[category] ?? "Shop category", tone: categoryToSlug(category) };
  });
}

function CategoryVisual({ category, imageUrl }: { category: string; imageUrl: string | null }) {
  if (imageUrl) {
    return <Image src={imageUrl} alt="" width={260} height={200} unoptimized />;
  }

  if (category === "Sports Cards") {
    return (
      <span className="gdg-category-illustration gdg-category-illustration-sports" aria-hidden="true">
        <span className="gdg-ebay-mark">
          <b>e</b>
          <b>B</b>
          <b>a</b>
          <b>y</b>
        </span>
        <span className="gdg-sports-card-stack">
          <i />
          <i />
          <i />
        </span>
      </span>
    );
  }

  if (category === "Graded Cards") {
    return (
      <span className="gdg-category-illustration gdg-category-illustration-graded" aria-hidden="true">
        <span className="gdg-graded-slab">
          <small>GRADED</small>
          <b>10</b>
          <i />
        </span>
      </span>
    );
  }

  return (
    <span className={`gdg-category-illustration gdg-category-illustration-${categoryToSlug(category)}`} aria-hidden="true">
      <Package size={30} />
      <i />
      <i />
    </span>
  );
}

function ProductImage({
  product,
  size = "card",
  showBadges = false,
  newArrivalDays = 14
}: {
  product: Pick<PublicStoreProductDTO, "title" | "primaryImageUrl" | "imageUrl" | "images" | "availabilityLevel" | "status" | "publishedAt" | "createdAt">;
  size?: "card" | "hero" | "thumb" | "detail";
  showBadges?: boolean;
  newArrivalDays?: number;
}) {
  const badges = showBadges ? storefrontImageBadges(product, newArrivalDays) : [];
  const imageCandidates = productImageCandidates(product);
  const [failedImageUrls, setFailedImageUrls] = useState<string[]>([]);
  const imageUrl = imageCandidates.find((candidate) => !failedImageUrls.includes(candidate)) ?? null;

  return (
    <div className={`gdg-product-image gdg-product-image-${size} gdg-product-media ${size === "detail" ? "gdg-product-image-detail-media" : ""}`}>
      <div className="gdg-image-badges" aria-hidden="true">
        {badges.map((badge, index) => (
          <span key={`${badge.variant}-${badge.label}-${index}`} className={`gdg-product-badge gdg-product-badge-${badge.variant}`}>
            {badge.label}
          </span>
        ))}
      </div>
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={product.title}
          width={720}
          height={540}
          unoptimized
          onError={() => setFailedImageUrls((current) => (current.includes(imageUrl) ? current : [...current, imageUrl]))}
        />
      ) : (
        <div className="gdg-image-placeholder" role="img" aria-label={`${cleanStorefrontTitle(product.title)} image unavailable`}>
          <Package size={size === "thumb" ? 18 : 30} aria-hidden="true" />
          {size !== "thumb" ? <span>Image coming soon</span> : null}
        </div>
      )}
    </div>
  );
}

export function StorefrontHeader({ settings, homeHref = "/shop" }: { settings: StorefrontSettingsDTO; homeHref?: string }) {
  const [count, setCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const storeName = displayStoreName(settings);
  const sportsCards = sportsCardsLink(settings);
  const accountSessionState = useCustomerAccountSession(settings.customerAccounts.enabled);
  const accountSession = accountSessionState.session;
  const accountSignedIn = Boolean(accountSession?.session.authenticated);
  const accountHref = accountSignedIn ? "/account" : "/account/login";
  const accountLabel = accountSignedIn ? "My Account" : "Sign In / Create Account";

  useEffect(() => {
    const sync = () => setCount(readCart().reduce((sum, item) => sum + item.quantity, 0));
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("poke-radar-cart", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("poke-radar-cart", sync);
    };
  }, []);

  const nav: Array<{ href: string; label: string; external: boolean; className?: string }> = [
    { href: homeHref, label: "Home", external: false },
    { href: "/shop", label: "Shop", external: false },
    { href: storefrontCollectionPath("pokemon-sealed-products"), label: "Pokémon", external: false },
    { href: sportsCards.href, label: "Sports Cards", external: sportsCards.external },
    { href: storefrontCollectionPath("new-arrivals"), label: "New Arrivals", external: false },
    { href: "/about", label: "About", external: false },
    { href: "/policies", label: "Policies", external: false },
    { href: "/contact", label: "Contact", external: false }
  ];
  if (settings.customerAccounts.enabled) {
    if (!accountSignedIn) {
      nav.push({ href: accountHref, label: accountLabel, external: false, className: "gdg-mobile-account-nav" });
    }
  }

  useEffect(() => {
    if (!accountMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && accountMenuRef.current?.contains(target)) return;
      setAccountMenuOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setAccountMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  return (
    <>
    <header className="gdg-header">
      <Link href={homeHref} className="gdg-brand" aria-label={`${storeName} home`}>
        <Image
          src={storefrontLogoPath}
          alt={`${storeName} home`}
          width={storefrontLogoWidth}
          height={storefrontLogoHeight}
          className="gdg-brand-logo"
          priority
        />
      </Link>
      <nav className={`gdg-nav ${menuOpen ? "open" : ""}`} aria-label="Public shop navigation">
        {nav.map((item) =>
          item.external ? (
            <a key={`${item.label}-${item.href}`} href={item.href} target="_blank" rel="noopener noreferrer" className={`gdg-external-nav ${item.className ?? ""}`.trim()} onClick={() => setMenuOpen(false)}>
              {item.label}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            <Link
              key={`${item.label}-${item.href}`}
              href={item.href}
              className={item.className}
              onClick={() => {
                if (item.href === "/account/login") trackStorefrontEvent("account_login_requested", { source: "mobile_nav" });
                setMenuOpen(false);
              }}
            >
              {item.label}
            </Link>
          )
        )}
        {settings.customerAccounts.enabled && accountSignedIn ? (
          <div className="gdg-mobile-account-menu">
            <p>Customer account</p>
            {customerAccountMenuLinks.map((item) => (
              <Link key={`mobile-${item.href}`} href={item.href} onClick={() => setMenuOpen(false)}>
                {item.label}
              </Link>
            ))}
            <form action="/api/account/logout" method="post" onSubmit={() => broadcastCustomerSessionEvent("logout")}>
              <button type="submit">Sign Out</button>
            </form>
          </div>
        ) : null}
      </nav>
      <div className="gdg-header-actions">
        <a className="gdg-icon-link" href="/shop" aria-label="Search products">
          <Search size={18} />
        </a>
        {settings.customerAccounts.enabled && accountSignedIn ? (
          <div className="gdg-account-menu" ref={accountMenuRef}>
            <button
              className="gdg-account-entry"
              type="button"
              aria-label="Open account menu"
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              onClick={() => setAccountMenuOpen((value) => !value)}
            >
              <User size={16} aria-hidden="true" />
              <span>My Account</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <div className={`gdg-account-dropdown ${accountMenuOpen ? "open" : ""}`} role="menu" aria-label="Customer account menu">
              {customerAccountMenuLinks.map((item) => (
                <Link key={item.href} href={item.href} role="menuitem" onClick={() => setAccountMenuOpen(false)}>
                  {item.label}
                </Link>
              ))}
              <form action="/api/account/logout" method="post" onSubmit={() => broadcastCustomerSessionEvent("logout")}>
                <button type="submit" role="menuitem">Sign Out</button>
              </form>
            </div>
          </div>
        ) : settings.customerAccounts.enabled ? (
          <Link
            href="/account/login"
            className="gdg-account-entry"
            aria-label="Sign In / Create Account"
            onClick={() => trackStorefrontEvent("account_login_requested", { source: "header" })}
          >
            <User size={16} aria-hidden="true" />
            <span>Sign In / Create Account</span>
          </Link>
        ) : null}
        <Link href="/cart" className="gdg-cart-link" aria-label={`Cart with ${count} items`}>
          <ShoppingBag size={18} />
          {count ? <b>{count}</b> : null}
        </Link>
        <button className="gdg-menu-button" type="button" aria-expanded={menuOpen} aria-label="Open menu" onClick={() => setMenuOpen((value) => !value)}>
          {menuOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
    </header>
    <CustomerSessionExpiryController
      session={accountSession}
      setSession={accountSessionState.setSession}
      refreshSession={accountSessionState.refreshSession}
    />
    </>
  );
}

export function StorefrontFooter({ settings, homeHref = "/shop" }: { settings: StorefrontSettingsDTO; homeHref?: string }) {
  const storeName = displayStoreName(settings);
  return (
    <footer className="gdg-footer">
      <div className="gdg-footer-brand-column">
        <Link href={homeHref} className="gdg-footer-brand">
          <Image src={storefrontLogoPath} alt={`${storeName} logo`} width={storefrontLogoWidth} height={storefrontLogoHeight} className="gdg-footer-brand-logo" />
          <span className="sr-only">{storeName}</span>
        </Link>
        <p>Sealed Pokemon TCG products, sports cards, and collectible card products packed carefully for collectors.</p>
        {settings.contactEmail ? (
          <a href={`mailto:${settings.contactEmail}`} className="gdg-footer-email">
            <Mail size={15} />
            {settings.contactEmail}
          </a>
        ) : (
          <span className="gdg-footer-email muted">Contact email pending setup</span>
        )}
      </div>
      <nav aria-label="Store footer navigation">
        <Link href="/shop">Shop</Link>
        <Link href="/about">About</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/policies/shipping">Shipping</Link>
        <Link href="/policies/returns">Returns</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </nav>
      <div className="gdg-footer-legal" aria-label="Store legal and trademark disclosure">
        <small>
          <strong>Store name:</strong> GameDayGrabs. <strong>Legal business:</strong> GameDayGrabs LLC. (c){" "}
          {new Date().getFullYear()} GameDayGrabs LLC. Availability subject to change.
        </small>
        <small>
          <strong>{GAMEDAYGRABS_FOOTER_RETAILER_DISCLOSURE}</strong> {GAMEDAYGRABS_FOOTER_AFFILIATION_DISCLOSURE}
        </small>
      </div>
    </footer>
  );
}

function marketplaceFeedbackBadgeIcon(label: string) {
  if (label === "Carefully packed") return <Package size={16} aria-hidden="true" />;
  if (label === "Fast shipping") return <Truck size={16} aria-hidden="true" />;
  if (label === "Accurate listings") return <BadgeCheck size={16} aria-hidden="true" />;
  return <MessageCircle size={16} aria-hidden="true" />;
}

export function MarketplaceFeedbackSection({ variant = "home" }: { variant?: "home" | "about" }) {
  const isAbout = variant === "about";
  const snippets = storefrontFeedback.snippets.slice(0, 3);
  const title = isAbout ? storefrontFeedback.aboutTitle : storefrontFeedback.homepageTitle;
  const body = isAbout ? storefrontFeedback.aboutBody : storefrontFeedback.homepageBody;
  const trustBadges = storefrontFeedback.trustBadges.slice(0, 3);

  return (
    <section
      className={`gdg-feedback-panel compact${isAbout ? " about" : ""}`}
      aria-labelledby={isAbout ? "gdg-about-feedback-title" : "gdg-home-feedback-title"}
    >
      <div className="gdg-feedback-heading">
        <p className="gdg-overline">Customer feedback</p>
        <h2 id={isAbout ? "gdg-about-feedback-title" : "gdg-home-feedback-title"}>{title}</h2>
        <p>{body}</p>
      </div>
      <div className="gdg-feedback-badges" aria-label="Feedback themes">
        {trustBadges.map((badge) => (
          <span key={badge}>
            {marketplaceFeedbackBadgeIcon(badge)}
            {badge}
          </span>
        ))}
      </div>
      <div className="gdg-feedback-grid">
        {snippets.map((snippet) => (
          <article key={snippet} className="gdg-feedback-card">
            <span className="gdg-feedback-quote" aria-hidden="true">
              &ldquo;
            </span>
            <p>{snippet}</p>
            <small>{storefrontFeedback.sourceLabel}</small>
            <b>{storefrontFeedback.attribution}</b>
          </article>
        ))}
      </div>
      <div className="gdg-feedback-actions">
        <a className="gdg-primary-button" href={GAMEDAYGRABS_EBAY_FEEDBACK_URL} target="_blank" rel="noopener noreferrer">
          {storefrontFeedback.ctaLabel}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        <p>{storefrontFeedback.disclaimer}</p>
      </div>
    </section>
  );
}

export function StorefrontContactForm({ settings }: { settings: StorefrontSettingsDTO }) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const formData = new FormData(form);
      const response = await fetch("/api/storefront/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(formData.get("name") || ""),
          email: String(formData.get("email") || ""),
          subject: String(formData.get("subject") || ""),
          message: String(formData.get("message") || "")
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Message could not be sent.");
      setStatus(payload.message || "Thanks. Your message was saved.");
      form.reset();
    } catch (contactError) {
      setError(contactError instanceof Error ? contactError.message : "Message could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="gdg-contact-form" onSubmit={submitContact}>
      <div>
        <h2>Send a message</h2>
        <p>
          {settings.contactEmail
            ? `Messages go to ${settings.contactEmail} when email is configured.`
            : "Messages are saved as storefront inquiries until a public contact email is configured."}
        </p>
      </div>
      <label>
        Name
        <input name="name" autoComplete="name" required minLength={2} maxLength={120} />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Subject
        <input name="subject" required minLength={2} maxLength={160} placeholder="Inventory question" />
      </label>
      <label>
        Message
        <textarea name="message" required minLength={10} maxLength={2000} rows={6} placeholder="Tell us what you are looking for." />
      </label>
      <button className="gdg-primary-button wide" type="submit" disabled={busy}>
        {busy ? "Sending..." : "Send Message"}
      </button>
      {status ? <p className="gdg-toast inline">{status}</p> : null}
      {error ? <p className="gdg-error">{error}</p> : null}
    </form>
  );
}

function ProductCard({
  product,
  settings,
  onAdded
}: {
  product: PublicStoreProductDTO;
  settings: StorefrontSettingsDTO;
  onAdded?: (product: PublicStoreProductDTO) => void;
}) {
  const actionLabel = checkoutModeLabel(settings);
  const actionDisabled = storefrontPrimaryActionDisabled(product);
  const isSoldOut = isSoldOutProduct(product);
  const actionText = actionDisabled ? "Sold Out" : actionLabel;
  const compactActionText = actionDisabled ? actionText : settings.checkoutConfigured ? "Add" : "Request";
  const displayCategory = publicCategoryLabel(displayStorefrontCategory(product));
  const productTitle = cleanStorefrontTitle(product.title);
  const productSubtitle = storefrontProductCardSubtitle({ title: product.title, category: displayCategory, setName: product.setName });
  const rewardEstimate = storefrontRewardEstimateLabel(product, settings);
  const rewardProgramCopy = storefrontRewardsProgramCopy(settings);
  const fulfillmentBadges = storefrontFulfillmentBadges(product);

  return (
    <article className="gdg-product-card">
      <Link href={`/product/${product.slug}`} className="gdg-product-media">
        <ProductImage product={product} showBadges newArrivalDays={settings.newArrivalDays} />
      </Link>
      <div className="gdg-product-body">
        <span className="gdg-product-category">{displayCategory}</span>
        <h3>
          <Link href={`/product/${product.slug}`} aria-label={productTitle}>
            {productTitle}
          </Link>
        </h3>
        {productSubtitle ? <p className="gdg-product-card-subtitle">{productSubtitle}</p> : null}
        <strong>{money(product.price)}</strong>
        <div className="gdg-product-card-meta" aria-label={`Purchase details for ${productTitle}`}>
          {rewardEstimate ? <span className="gdg-product-reward-estimate" title={rewardProgramCopy ?? undefined}>{rewardEstimate}</span> : null}
          {fulfillmentBadges.map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
        </div>
      </div>
      <footer>
        <div className="gdg-product-card-status-row">
          <span className={isSoldOut ? "gdg-stock out" : "gdg-stock in"}>{isSoldOut ? "Sold Out" : "In Stock"}</span>
          {product.shippingAvailable && product.localPickupEligible ? <small>Ship or pick up</small> : null}
        </div>
        <div className="gdg-card-actions">
          <Link href={`/product/${product.slug}`} className="gdg-secondary-button gdg-product-card-action" aria-label={`View ${productTitle}`}>
            <span className="gdg-product-action-label-full">View Product</span>
            <span className="gdg-product-action-label-short" aria-hidden="true">View</span>
          </Link>
          <button
            type="button"
            className="gdg-primary-button compact gdg-product-card-action"
            disabled={actionDisabled}
            aria-label={`${actionText} ${productTitle}`}
            onClick={() => {
              addToCart(product);
              onAdded?.(product);
            }}
          >
            <span className="gdg-product-action-label-full">{actionText}</span>
            <span className="gdg-product-action-label-short" aria-hidden="true">{compactActionText}</span>
          </button>
        </div>
      </footer>
    </article>
  );
}

function HomepageProductSection({
  section,
  settings,
  onAdded,
  emptyTitle,
  emptyDetail
}: {
  section: HomepageMerchandisingSection;
  settings: StorefrontSettingsDTO;
  onAdded: (product: PublicStoreProductDTO) => void;
  emptyTitle?: string;
  emptyDetail?: string;
}) {
  return (
    <section className="gdg-section gdg-home-product-section">
      <div className="gdg-section-header">
        <div>
          <h2>{section.title}</h2>
          <p>{section.detail}</p>
        </div>
        <Link href={section.href}>{section.linkLabel}</Link>
      </div>
      <div className="gdg-home-product-row">
        {section.products.length ? (
          section.products.map((product) => <ProductCard key={product.id} product={product} settings={settings} onAdded={onAdded} />)
        ) : (
          <div className="gdg-empty compact">
            <h3>{emptyTitle ?? "No matching products yet"}</h3>
            <p>{emptyDetail ?? "Check back as new public listings are added."}</p>
          </div>
        )}
      </div>
    </section>
  );
}

function HomepageSupportStrip() {
  const points = [
    { icon: <Package size={19} aria-hidden="true" />, title: "Packed carefully", text: "Sealed products are packed with collector condition in mind." },
    { icon: <CreditCard size={19} aria-hidden="true" />, title: "Secure Stripe checkout", text: "Stripe handles payment securely; card details stay with Stripe." },
    { icon: <Truck size={19} aria-hidden="true" />, title: "USPS calculated shipping", text: "Carrier shipping is calculated from ZIP and package details." },
    { icon: <ShoppingCart size={19} aria-hidden="true" />, title: "No account required", text: "Guest checkout stays available for every shopper." },
    { icon: <Trophy size={19} aria-hidden="true" />, title: "Optional account & rewards", text: "Track orders and display points when you want an account." },
    { icon: <ShieldCheck size={19} aria-hidden="true" />, title: "Clear final-sale policy", text: "Trading card return terms are available before purchase." }
  ];

  return (
    <section className="gdg-section gdg-support-strip gdg-home-trust-section" aria-label="Why buy from GameDayGrabs">
      <div className="gdg-section-header gdg-section-header-centered">
        <div>
          <h2>Why buy from GameDayGrabs?</h2>
          <p>Clear shipping, secure checkout, and collector-minded handling without forcing an account.</p>
        </div>
        <Link href="/policies">Read policies</Link>
      </div>
      {points.map((point) => (
        <article key={point.title}>
          <span>{point.icon}</span>
          <div>
            <h3>{point.title}</h3>
            <p>{point.text}</p>
          </div>
        </article>
      ))}
    </section>
  );
}

function HomepageAccountCta({ settings, signedIn }: { settings: StorefrontSettingsDTO; signedIn: boolean }) {
  const accountsEnabled = settings.customerAccounts.enabled;
  const headline = signedIn ? "Your account is ready." : "Create an account to track orders and rewards.";
  const detail = signedIn
    ? "Track orders, saved addresses, and rewards from your dashboard."
    : "Guest checkout stays available. Sign in anytime to view orders, saved addresses, and points.";
  const primaryHref = signedIn ? "/account" : accountsEnabled ? "/account/login" : "/order-status";
  const primaryLabel = signedIn ? "My Account" : accountsEnabled ? "Sign In / Create Account" : "Check Order Status";
  const secondaryHref = signedIn ? storefrontCollectionPath("new-arrivals") : "/shop";
  const secondaryLabel = signedIn ? "Shop New Arrivals" : "Shop as Guest";

  return (
    <section className={`gdg-section gdg-home-account-cta ${signedIn ? "gdg-home-account-cta-ready" : ""}`} aria-label="Customer account and rewards">
      <div className="gdg-home-account-copy">
        <span className="gdg-home-account-badge-shell" aria-hidden="true">
          <span className="gdg-home-account-badge-mark">G</span>
          <Sparkles size={13} className="gdg-home-account-badge-spark" />
        </span>
        <div>
          <h2>{headline}</h2>
          <p>{detail}</p>
          <small>{signedIn ? "Earn points now. Redemption coming soon." : "No account required to buy. Earn points now. Redemption coming soon."}</small>
        </div>
      </div>
      <div className="gdg-home-account-actions">
        <Link
          href={primaryHref}
          className="gdg-primary-button"
          onClick={() => {
            if (primaryHref === "/account/login") trackStorefrontEvent("account_login_requested", { source: "homepage" });
          }}
        >
          {primaryLabel}
        </Link>
        <Link href={secondaryHref} className="gdg-secondary-button">
          {secondaryLabel}
        </Link>
      </div>
    </section>
  );
}

function HomepageGrabbyTip() {
  return (
    <GrabbyCard
      variant="shop-guide"
      title="Grabby's tip"
      message="Start with Featured Drops, or jump into Shop to see every active product."
      ctaHref="/shop"
      ctaLabel="Shop all products"
      compact
      className="grabby-helper-strip gdg-home-grabby-strip"
    />
  );
}

function collectionGrabbyMessage(collection: StorefrontCollectionDefinition) {
  const messages: Record<string, string> = {
    "booster-bundles": "Booster bundles are a clean way to grab sealed packs without opening a full box.",
    tins: "Tins are compact sealed picks collectors love for display and gifting.",
    blisters: "Blisters are easy grab-and-go sealed products for quick pickups.",
    "premium-collections": "Premium collections usually include promo cards and display-ready packaging.",
    "new-arrivals": "Fresh drops show the newest active products first."
  };

  return messages[collection.slug] ?? "Browse active listings here, then jump to related collections when you want to compare product types.";
}

type StorefrontShopSearchResult = {
  products: PublicStoreProductDTO[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  categories: string[];
  sets: string[];
  applied: {
    q: string;
    category: string;
    set: string;
    availability: StorefrontShopAvailability;
    sort: StorefrontShopSort;
    page: number;
    pageSize: number;
  };
};

type StorefrontShopFilterState = {
  q: string;
  category: string;
  set: string;
  availability: StorefrontShopAvailability;
  sort: StorefrontShopSort;
};

export function ProductGrid({
  products,
  settings,
  mode = "shop",
  initialQuery,
  initialCategory,
  initialSet,
  initialSort,
  initialAvailability,
  initialShopResult
}: {
  products: PublicStoreProductDTO[];
  settings: StorefrontSettingsDTO;
  mode?: "home" | "shop";
  initialQuery?: string | null;
  initialCategory?: string | null;
  initialSet?: string | null;
  initialSort?: string | null;
  initialAvailability?: string | null;
  initialShopResult?: StorefrontShopSearchResult;
}) {
  const isShopMode = mode === "shop";
  const [query, setQuery] = useState(() => (isShopMode ? normalizeStorefrontShopQuery(initialQuery) : ""));
  const [category, setCategory] = useState(() => (isShopMode ? initialCategory || categoryFromParam(initialCategory) : "all"));
  const [setFilter, setSetFilter] = useState(() => (isShopMode ? normalizeStorefrontShopQuery(initialSet) : ""));
  const [availability, setAvailability] = useState(() => (mode === "shop" ? availabilityFromParam(initialAvailability) : "in-stock"));
  const [sort, setSort] = useState(() => (mode === "shop" ? sortFromParam(initialSort) : "newest"));
  const [shopProducts, setShopProducts] = useState(products);
  const [shopTotal, setShopTotal] = useState(initialShopResult?.total ?? products.length);
  const [shopPage, setShopPage] = useState(initialShopResult?.page ?? 1);
  const [shopHasMore, setShopHasMore] = useState(initialShopResult?.hasMore ?? false);
  const [shopCategories, setShopCategories] = useState(initialShopResult?.categories ?? []);
  const [shopSets, setShopSets] = useState(initialShopResult?.sets ?? []);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopError, setShopError] = useState("");
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const activeShopRequest = useRef<AbortController | null>(null);
  const shopRequestSeq = useRef(0);
  const applyingPopState = useRef(false);
  const lastShopUrl = useRef("");
  const filterSheetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const filterSheetCloseRef = useRef<HTMLButtonElement | null>(null);
  const filterSheetPreviouslyFocusedRef = useRef<HTMLElement | null>(null);
  const filterSheetWasOpenRef = useRef(false);
  const sportsCards = sportsCardsLink(settings);
  const { session: accountSession } = useCustomerAccountSession(settings.customerAccounts.enabled);
  const accountSignedIn = Boolean(accountSession?.session.authenticated);

  const categories = useMemo(() => {
    const source = isShopMode ? shopCategories : products.map((product) => displayStorefrontCategory(product)).filter(Boolean);
    const fromProducts = Array.from(new Set(source));
    return ["all", ...preferredCategories, ...fromProducts.filter((entry) => !preferredCategories.includes(entry))];
  }, [isShopMode, products, shopCategories]);

  const homeVisibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products
      .filter((product) => {
        const matchesQuery =
          !normalizedQuery ||
          product.title.toLowerCase().includes(normalizedQuery) ||
          product.category.toLowerCase().includes(normalizedQuery) ||
          displayStorefrontCategory(product).toLowerCase().includes(normalizedQuery) ||
          product.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
        const matchesCategory = category === "all" || storefrontCategoryMatches(product, category) || product.category === category;
        const matchesAvailability = storefrontMatchesAvailability(product, availability);
        return matchesQuery && matchesCategory && matchesAvailability;
      })
      .sort((left, right) => {
        if (sort === "price-low") return left.price - right.price;
        if (sort === "price-high") return right.price - left.price;
        if (sort === "name") return left.title.localeCompare(right.title);
        if (sort === "availability") return availabilitySortScore(right) - availabilitySortScore(left);
        return 0;
      });
  }, [availability, category, products, query, sort]);
  const visibleProducts = isShopMode ? shopProducts : homeVisibleProducts;
  const activeFilterCount = [query, category !== "all" ? category : "", setFilter, availability !== "in-stock" ? availability : "", sort !== "featured" ? sort : ""].filter(Boolean).length;
  const shopFilterSummary = shopLoading
    ? "Loading shop results."
    : `${shopTotal} result${shopTotal === 1 ? "" : "s"} with ${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}.`;

  const featuredSection = useMemo(() => homepageFeaturedDropsSection(products, settings.newArrivalDays), [products, settings.newArrivalDays]);
  const heroProduct = selectHomepageHeroProduct(products, settings);
  const heroCategory = heroProduct ? publicCategoryLabel(displayStorefrontCategory(heroProduct)) : null;
  const heroProductTitle = heroProduct ? cleanStorefrontTitle(heroProduct.title) : "";
  const heroProductBadges = heroProduct
    ? [
        ...(isSoldOutProduct(heroProduct) ? ["Sold Out"] : []),
        ...(isNewArrival(heroProduct, new Date(), settings.newArrivalDays) ? ["New Arrival"] : ["Latest Release"])
      ]
    : [];
  const categoryCards = useMemo(() => categoryPreviewCards(products, homeCategories), [products]);

  function onAdded(product: PublicStoreProductDTO) {
    setNotice(`${cleanStorefrontTitle(product.title)} added. ${settings.checkoutConfigured ? "Open cart to checkout." : "Open cart to request an invoice."}`);
  }

  const isSportsCardsCategory = mode === "shop" && category === "Sports Cards" && sportsCards.external;

  const currentShopFilterState = useCallback(
    (overrides?: Partial<StorefrontShopFilterState>): StorefrontShopFilterState => ({
      q: normalizeStorefrontShopQuery(overrides?.q ?? query),
      category: overrides?.category ?? category,
      set: normalizeStorefrontShopQuery(overrides?.set ?? setFilter),
      availability: overrides?.availability ?? availability,
      sort: overrides?.sort ?? sort
    }),
    [availability, category, query, setFilter, sort]
  );

  const updateShopUrl = useCallback((nextPage: number, mode: "push" | "replace", state?: StorefrontShopFilterState) => {
    if (!isShopMode || typeof window === "undefined") return;
    const params = new URLSearchParams();
    const filters = state ?? currentShopFilterState();
    if (filters.q) params.set("q", filters.q);
    if (filters.category && filters.category !== "all") params.set("category", filters.category);
    if (filters.set) params.set("set", filters.set);
    if (filters.availability !== "in-stock") params.set("availability", filters.availability);
    if (filters.sort !== "featured") params.set("sort", filters.sort);
    if (nextPage > 1) params.set("page", String(nextPage));
    const nextUrl = params.toString() ? `/shop?${params.toString()}` : "/shop";
    if (lastShopUrl.current === nextUrl) return;
    lastShopUrl.current = nextUrl;
    if (mode === "push") {
      window.history.pushState(null, "", nextUrl);
    } else {
      window.history.replaceState(null, "", nextUrl);
    }
  }, [currentShopFilterState, isShopMode]);

  const runShopSearch = useCallback(async (nextPage = 1, options: { append?: boolean; history?: "push" | "replace"; state?: Partial<StorefrontShopFilterState> } = {}) => {
    if (!isShopMode) return;
    const sequence = shopRequestSeq.current + 1;
    shopRequestSeq.current = sequence;
    activeShopRequest.current?.abort();
    const controller = new AbortController();
    activeShopRequest.current = controller;
    setShopLoading(true);
    setShopError("");
    const params = new URLSearchParams();
    const filters = currentShopFilterState(options.state);
    if (filters.q) params.set("q", filters.q);
    if (filters.category && filters.category !== "all") params.set("category", filters.category);
    if (filters.set) params.set("set", filters.set);
    params.set("availability", filters.availability);
    params.set("sort", filters.sort);
    params.set("page", String(nextPage));
    updateShopUrl(nextPage, options.history ?? "replace", filters);
    try {
      const response = await fetch(`/api/storefront/shop/search?${params.toString()}`, {
        signal: controller.signal,
        headers: { accept: "application/json" }
      });
      const payload = (await response.json()) as StorefrontShopSearchResult & { error?: string; requestId?: string };
      if (!response.ok) {
        const reference = payload.requestId ? ` Reference: ${payload.requestId}.` : "";
        throw new Error(`${payload.error || "Shop results could not be loaded."}${reference}`);
      }
      if (sequence !== shopRequestSeq.current) return;
      setShopProducts((current) => (options.append ? [...current, ...payload.products] : payload.products));
      setShopTotal(payload.total);
      setShopPage(payload.page);
      setShopHasMore(payload.hasMore);
      setShopCategories(payload.categories);
      setShopSets(payload.sets);
      trackStorefrontEvent(filters.q ? "shop_searched" : "shop_filter_used", {
        hasQuery: Boolean(filters.q),
        filterCount: [
          filters.category && filters.category !== "all" ? filters.category : "",
          filters.set,
          filters.availability !== "in-stock" ? filters.availability : "",
          filters.sort !== "featured" ? filters.sort : ""
        ].filter(Boolean).length,
        resultCount: payload.total
      });
      if (!payload.applied.category && filters.category !== "all") setCategory("all");
      if (!payload.applied.set && filters.set) setSetFilter("");
    } catch (error) {
      if (controller.signal.aborted || sequence !== shopRequestSeq.current) return;
      setShopError(error instanceof Error ? error.message : "Shop results could not be loaded.");
    } finally {
      if (sequence === shopRequestSeq.current) setShopLoading(false);
    }
  }, [currentShopFilterState, isShopMode, updateShopUrl]);

  useEffect(() => {
    if (!isShopMode || applyingPopState.current) return undefined;
    const timer = window.setTimeout(() => {
      void runShopSearch(1, { history: "replace" });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [availability, category, isShopMode, query, runShopSearch, setFilter, sort]);

  useEffect(() => {
    if (!isShopMode || typeof window === "undefined") return undefined;
    lastShopUrl.current = `${window.location.pathname}${window.location.search}`;
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const nextState: StorefrontShopFilterState = {
        q: normalizeStorefrontShopQuery(params.get("q")),
        category: params.get("category") || "all",
        set: normalizeStorefrontShopQuery(params.get("set")),
        availability: availabilityFromParam(params.get("availability")),
        sort: sortFromParam(params.get("sort"))
      };
      const nextPage = normalizeStorefrontShopPage(params.get("page"));
      applyingPopState.current = true;
      setQuery(nextState.q);
      setCategory(nextState.category);
      setSetFilter(nextState.set);
      setAvailability(nextState.availability);
      setSort(nextState.sort);
      window.setTimeout(() => {
        applyingPopState.current = false;
        void runShopSearch(nextPage, { history: "replace", state: nextState });
      }, 0);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isShopMode, runShopSearch]);

  useEffect(() => {
    return () => activeShopRequest.current?.abort();
  }, []);

  useEffect(() => {
    if (!isShopMode || typeof document === "undefined") return undefined;
    if (!filterSheetOpen) {
      if (filterSheetWasOpenRef.current) {
        filterSheetWasOpenRef.current = false;
        const restoreTarget = filterSheetPreviouslyFocusedRef.current || filterSheetTriggerRef.current;
        filterSheetPreviouslyFocusedRef.current = null;
        window.requestAnimationFrame(() => restoreTarget?.focus());
      }
      return undefined;
    }

    filterSheetWasOpenRef.current = true;
    if (!filterSheetPreviouslyFocusedRef.current && document.activeElement instanceof HTMLElement) {
      filterSheetPreviouslyFocusedRef.current = document.activeElement;
    }
    const filterSheet = document.getElementById("gdg-shop-filters");
    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])"
    ].join(",");
    window.requestAnimationFrame(() => filterSheetCloseRef.current?.focus());

    function handleFilterSheetKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setFilterSheetOpen(false);
        return;
      }
      if (event.key !== "Tab" || !filterSheet) return;

      const focusable = Array.from(filterSheet.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
        const box = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
      });
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleFilterSheetKeyDown);
    return () => document.removeEventListener("keydown", handleFilterSheetKeyDown);
  }, [filterSheetOpen, isShopMode]);

  function submitShopFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilterSheetOpen(false);
    void runShopSearch(1, { history: "push" });
  }

  function openShopFilters() {
    filterSheetPreviouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : filterSheetTriggerRef.current;
    setFilterSheetOpen(true);
  }

  function closeShopFilters() {
    setFilterSheetOpen(false);
  }

  function resetShopFilters() {
    setQuery("");
    setCategory("all");
    setSetFilter("");
    setAvailability("in-stock");
    setSort("featured");
    setFilterSheetOpen(false);
  }

  return (
    <>
      {mode === "home" ? (
        <>
          <section className="gdg-hero">
            <div className="gdg-hero-copy">
              <p className="gdg-overline">Pokémon & Sports Cards</p>
              <h1>Collect. Play. Invest.</h1>
              <p>Shop sealed Pokemon TCG products, booster bundles, tins, blisters, premium collections, and collectible card products packed carefully for collectors.</p>
              <div className="gdg-hero-actions">
                <Link href="/shop" className="gdg-primary-button">
                  Shop Pokemon
                </Link>
                <Link href={storefrontCollectionPath("new-arrivals")} className="gdg-secondary-button">
                  View New Arrivals
                </Link>
              </div>
              {heroProduct ? (
                <div className="gdg-hero-feature">
                  <div className="gdg-hero-badge-row">
                    {heroProductBadges.map((badge, index) => (
                      <span key={`${badge}-${index}`}>{badge}</span>
                    ))}
                  </div>
                  <small>{heroCategory}</small>
                  <strong>{heroProductTitle}</strong>
                  <b>{money(heroProduct.price)}</b>
                  <Link href={`/product/${heroProduct.slug}`} className="gdg-secondary-button compact">
                    View Product
                  </Link>
                </div>
              ) : null}
            </div>
            <div className="gdg-hero-stage" aria-label="Featured collectible products">
              {heroProduct ? (
                <Link href={`/product/${heroProduct.slug}`} className="gdg-hero-product-link" aria-label={`View ${heroProductTitle}`}>
                  <ProductImage product={heroProduct} size="hero" showBadges newArrivalDays={settings.newArrivalDays} />
                  <span className="gdg-hero-view-cue">
                    View product
                    <ChevronRight size={13} aria-hidden="true" />
                  </span>
                </Link>
              ) : (
                <div className="gdg-hero-placeholder">
                  <span>GameDayGrabs</span>
                  <strong>Premium Card Shop</strong>
                  <small>Published products will appear here.</small>
                </div>
              )}
            </div>
          </section>

          <HomepageAccountCta settings={settings} signedIn={accountSignedIn} />
        </>
      ) : null}

      {notice ? (
        <p className="gdg-toast">
          <Check size={16} /> {notice}
        </p>
      ) : null}

      {mode === "home" ? (
        <>
          <HomepageProductSection
            section={featuredSection}
            settings={settings}
            onAdded={onAdded}
            emptyTitle="No public listings yet"
            emptyDetail="Published inventory will appear here automatically."
          />

          <HomepageGrabbyTip />

          <section className="gdg-section">
            <div className="gdg-section-header">
              <div>
                <h2>Shop By Category</h2>
                <p>Jump straight to the product type you collect most.</p>
              </div>
              <Link href="/shop">View all</Link>
            </div>
            <div className="gdg-category-grid">
              {categoryCards.map(({ category: entry, imageUrl, subtitle, tone }) => {
                const isSports = entry === "Sports Cards";
                const link = isSports ? sportsCards : { href: categoryHref(entry), external: false };
                const card = (
                  <>
                    <span className={`gdg-category-image gdg-category-image-${tone}`}>
                      <CategoryVisual category={entry} imageUrl={imageUrl} />
                    </span>
                    <span className="gdg-category-copy">
                      <b>{publicCategoryLabel(entry)}</b>
                      <small>{subtitle}</small>
                    </span>
                    {link.external ? (
                      <span className="gdg-category-external">
                        <ExternalLink size={12} aria-hidden="true" />
                        Opens eBay
                      </span>
                    ) : null}
                  </>
                );

                return link.external ? (
                  <a key={entry} href={link.href} target="_blank" rel="noopener noreferrer" className="gdg-category-card">
                    {card}
                  </a>
                ) : (
                  <Link href={link.href} key={entry} className="gdg-category-card">
                    {card}
                  </Link>
                );
              })}
            </div>
          </section>

          <HomepageSupportStrip />
          <MarketplaceFeedbackSection />
        </>
      ) : (
        <section className="gdg-shop-area" id="shop">
          <button ref={filterSheetTriggerRef} className="gdg-mobile-filter-button" type="button" onClick={openShopFilters} aria-expanded={filterSheetOpen} aria-controls="gdg-shop-filters" aria-label={`Open shop filters${activeFilterCount ? `, ${activeFilterCount} active` : ""}`}>
            <Search size={16} aria-hidden="true" />
            Filters
            {activeFilterCount ? <span aria-label={`${activeFilterCount} active filters`}>{activeFilterCount}</span> : null}
          </button>
          <form className={`gdg-shop-filters ${filterSheetOpen ? "open" : ""}`} id="gdg-shop-filters" onSubmit={submitShopFilters} role={filterSheetOpen ? "dialog" : undefined} aria-modal={filterSheetOpen ? "true" : undefined} aria-labelledby="gdg-shop-filters-title" aria-describedby="gdg-shop-filter-summary">
            <div>
              <div className="gdg-shop-filter-heading">
                <h1 id="gdg-shop-filters-title">Shop Pokemon TCG products</h1>
                <button ref={filterSheetCloseRef} className="gdg-icon-button gdg-filter-close" type="button" onClick={closeShopFilters} aria-label="Close filters">
                  <X size={16} />
                </button>
              </div>
              <p>Browse sealed Pokemon products, booster bundles, tins, blisters, premium collections, and collectible card products.</p>
              <p id="gdg-shop-filter-summary" role="status" aria-live="polite">{shopLoading ? "Loading results..." : `Showing ${visibleProducts.length} of ${shopTotal} matching public listing${shopTotal === 1 ? "" : "s"}. ${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}.`}</p>
            </div>
            <label htmlFor="gdg-shop-search-input">
              Search
              <span>
                <Search size={15} aria-hidden="true" />
                <input
                  id="gdg-shop-search-input"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(normalizeStorefrontShopQuery(event.currentTarget.value))}
                  placeholder="Name, set, category, SKU, or UPC..."
                  enterKeyHint="search"
                  aria-describedby="gdg-shop-filter-summary"
                />
              </span>
            </label>
            <label htmlFor="gdg-shop-category-filter">
              Category / product type
              <select id="gdg-shop-category-filter" value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
                {categories.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry === "all" ? "All Products" : publicCategoryLabel(entry)}
                  </option>
                ))}
              </select>
            </label>
            {shopSets.length ? (
              <label htmlFor="gdg-shop-set-filter">
                Set / series
                <select id="gdg-shop-set-filter" value={setFilter} onChange={(event) => setSetFilter(event.currentTarget.value)}>
                  <option value="">All Sets</option>
                  {shopSets.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label htmlFor="gdg-shop-availability-filter">
              Availability
              <select
                id="gdg-shop-availability-filter"
                value={availability}
                onChange={(event) => setAvailability(event.currentTarget.value as StorefrontAvailabilityFilter)}
              >
                <option value="in-stock">In Stock</option>
                <option value="sold-out">Sold Out</option>
                <option value="all">All</option>
              </select>
            </label>
            <label htmlFor="gdg-shop-sort-filter">
              Sort
              <select id="gdg-shop-sort-filter" value={sort} onChange={(event) => setSort(event.currentTarget.value as StorefrontShopSort)} aria-describedby="gdg-shop-filter-summary">
                <option value="featured">Featured</option>
                <option value="newest">Newest</option>
                <option value="price-low">Price: Low to High</option>
                <option value="price-high">Price: High to Low</option>
                <option value="name">Name</option>
                <option value="availability">Availability</option>
              </select>
            </label>
            <div className="gdg-shop-filter-actions">
              <button type="submit" className="gdg-primary-button compact" aria-label="Apply shop filters">
                Apply Filters
              </button>
              <button type="button" className="gdg-filter-clear" onClick={resetShopFilters} aria-label="Reset shop filters">
                Reset
              </button>
            </div>
          </form>
          {filterSheetOpen ? <button type="button" className="gdg-filter-backdrop" aria-label="Close filters" onClick={closeShopFilters} /> : null}
          <div className="gdg-shop-list">
            <GrabbyCard
              variant="shop-guide"
              ctaHref={storefrontCollectionPath("new-arrivals")}
              compact
              className="grabby-helper-strip gdg-shop-grabby-strip"
            />
            <div className="gdg-shop-toolbar">
              <div>
                <p>Shop</p>
                <h2>{category === "all" ? "All Products" : category}</h2>
                <span role="status" aria-live="polite">{shopFilterSummary}</span>
              </div>
              {activeFilterCount ? <button type="button" className="gdg-filter-clear compact" onClick={resetShopFilters} aria-label={`Clear ${activeFilterCount} active shop filters`}>Clear {activeFilterCount}</button> : null}
            </div>
            {shopError ? <p className="gdg-error">{shopError}</p> : null}
            <div className="gdg-product-grid">
              {isSportsCardsCategory ? (
                <div className="gdg-empty gdg-ebay-empty">
                  <span className="gdg-ebay-icon">
                    <ExternalLink size={22} />
                  </span>
                  <h3>Sports card inventory is currently listed on our eBay store.</h3>
                  <p>Open GameDayGrabs sports card listings on eBay while the internal sports card catalog is being prepared.</p>
                  <a className="gdg-primary-button" href={sportsCards.href} target="_blank" rel="noopener noreferrer">
                    Open eBay Store
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </div>
              ) : visibleProducts.length ? (
                visibleProducts.map((product) => <ProductCard key={product.id} product={product} settings={settings} onAdded={onAdded} />)
              ) : (
                <div className="gdg-empty" role="status" aria-live="polite" aria-busy={shopLoading || undefined}>
                  <h3>{shopLoading ? "Loading products..." : "No matching products"}</h3>
                  <p>{shopLoading ? "Searching current public listings." : "Try another search, reset filters, or check back for new public listings."}</p>
                </div>
              )}
            </div>
            {!isSportsCardsCategory && shopHasMore ? (
              <div className="gdg-load-more-row">
                <button className="gdg-secondary-button" type="button" disabled={shopLoading} onClick={() => void runShopSearch(shopPage + 1, { append: true, history: "replace" })}>
                  {shopLoading ? "Loading..." : "Load More"}
                </button>
              </div>
            ) : null}
          </div>
        </section>
      )}
    </>
  );
}

export function StorefrontCollectionLanding({
  collection,
  products,
  relatedCollections,
  settings
}: {
  collection: StorefrontCollectionDefinition;
  products: PublicStoreProductDTO[];
  relatedCollections: StorefrontCollectionDefinition[];
  settings: StorefrontSettingsDTO;
}) {
  const [notice, setNotice] = useState("");

  function onAdded(product: PublicStoreProductDTO) {
    setNotice(`${cleanStorefrontTitle(product.title)} added. ${settings.checkoutConfigured ? "Open cart to checkout." : "Open cart to request an invoice."}`);
  }

  return (
    <>
      <section className="gdg-collection-hero">
        <nav className="gdg-breadcrumb" aria-label="Breadcrumb">
          <Link href="/shop">Home</Link>
          <ChevronRight size={13} />
          <Link href="/shop">Shop</Link>
          <ChevronRight size={13} />
          <span>{collection.shortTitle}</span>
        </nav>
        <div className="gdg-collection-hero-grid">
          <div>
            <p className="gdg-overline">GameDayGrabs collection</p>
            <h1>{collection.title}</h1>
            <p>{collection.intro}</p>
            <p>{collection.detail}</p>
          </div>
          <aside className="gdg-collection-note" aria-label="Collection shopping notes">
            <strong>Before checkout</strong>
            <span>Availability can change quickly.</span>
            <span>Items are confirmed before payment.</span>
            <span>Internal inventory quantity is not shown publicly.</span>
          </aside>
        </div>
        <GrabbyCard
          variant="category-guide"
          title="Grabby's tip"
          message={collectionGrabbyMessage(collection)}
          compact
          className="grabby-helper-strip gdg-collection-grabby-strip"
        />
        {relatedCollections.length ? (
          <div className="gdg-collection-links" aria-label="Related collections">
            <span>Related collections</span>
            {relatedCollections.map((related) => (
              <Link href={storefrontCollectionPath(related.slug)} key={related.slug}>
                {related.shortTitle}
              </Link>
            ))}
          </div>
        ) : null}
      </section>
      {notice ? (
        <p className="gdg-toast">
          <Check size={16} /> {notice}
        </p>
      ) : null}
      <section className="gdg-section gdg-collection-products">
        <div className="gdg-section-header">
          <div>
            <h2>{collection.shortTitle} products</h2>
            <p>Product cards link to canonical product pages. Sold-out items are clearly labeled when included.</p>
          </div>
          <Link href="/shop">Shop all</Link>
        </div>
        {products.length ? (
          <div className="gdg-product-grid">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} settings={settings} onAdded={onAdded} />
            ))}
          </div>
        ) : (
          <div className="gdg-empty">
            <h3>No matching products right now</h3>
            <p>Check back as new public listings are added, or browse all available products.</p>
            <Link href="/shop" className="gdg-primary-button">
              Shop all products
            </Link>
          </div>
        )}
      </section>
    </>
  );
}

export function ProductDetail({
  product,
  settings,
  relatedProducts = []
}: {
  product: PublicStoreProductDTO;
  settings: StorefrontSettingsDTO;
  relatedProducts?: PublicStoreProductDTO[];
}) {
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState("");
  const images = productImageCandidates(product);
  const [selectedImage, setSelectedImage] = useState(images[0] ?? null);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const isSoldOut = storefrontPrimaryActionDisabled(product);
  const actionLabel = checkoutModeLabel(settings);
  const soldOutActionLabel = isSoldOut ? "Sold Out" : actionLabel;
  const soldOutSecondaryLabel = isSoldOut ? "Sold Out" : settings.checkoutConfigured ? "Buy Now" : "Request Invoice Now";
  const publicDescription = cleanStorefrontDescription(product);
  const displayCategory = publicCategoryLabel(displayStorefrontCategory(product));
  const productTitle = cleanStorefrontTitle(product.title);
  const conditionLabel = cleanStorefrontTitle(product.condition) || "Collector-ready condition";
  const includedBullets = productIncludedBullets(product, displayCategory, conditionLabel);
  const sealedSignal = /\b(sealed|new)\b/i.test(conditionLabel);
  const soldOutNote = storefrontSoldOutNote();
  const visibleGalleryImages = images.filter((image) => !failedImages.includes(image));
  const preferredSelectedImage = selectedImage && images.includes(selectedImage) ? selectedImage : (images[0] ?? null);
  const visibleSelectedImage = preferredSelectedImage && visibleGalleryImages.includes(preferredSelectedImage) ? preferredSelectedImage : (visibleGalleryImages[0] ?? null);
  const availabilityLabel = storefrontAvailabilityLabel(product);
  const availabilityDetail = storefrontAvailabilityDetail(product);
  const purchaseLimitLabel = storefrontPurchaseLimitLabel(product);
  const effectiveMaxQuantity = storefrontEffectiveMaxQuantity(product);
  const quantityLimitReached = !isSoldOut && effectiveMaxQuantity > 0 && quantity >= effectiveMaxQuantity;
  const rewardEstimateLabel = storefrontRewardEstimateLabel(product, settings);
  const rewardProgramCopy = storefrontRewardsProgramCopy(settings);
  const fulfillmentLabel = product.shippingAvailable && product.localPickupEligible ? "Ships or Local Pickup" : product.localPickupEligible ? "Local Pickup available" : product.shippingAvailable ? "Shipping available" : "Fulfillment reviewed before checkout";
  const fulfillmentDetail = product.localPickupEligible
    ? "Pickup appears as an option in cart when this item is eligible."
    : product.shippingAvailable
      ? "Shipping is calculated from package details before payment."
      : "Contact support if fulfillment options are not shown.";

  useEffect(() => {
    trackStorefrontEvent("product_viewed", {
      productSlug: product.slug,
      productCategory: displayStorefrontCategory(product),
      productStatus: product.status
    });
  }, [product]);

  function addProductToCart(redirect = false) {
    if (isSoldOut || effectiveMaxQuantity <= 0) return;
    addToCart(product, quantity);
    setNotice(settings.checkoutConfigured ? "Added to cart." : "Added to invoice request.");
    if (redirect) window.location.href = "/cart";
  }

  return (
    <>
      <section className="gdg-detail">
        <nav className="gdg-breadcrumb" aria-label="Breadcrumb">
          <Link href="/shop">Home</Link>
          <ChevronRight size={13} />
          <Link href="/shop">Shop</Link>
          <ChevronRight size={13} />
          <span>{displayCategory}</span>
        </nav>
        <div className="gdg-detail-grid">
          <aside className={`gdg-gallery ${visibleGalleryImages.length > 1 ? "has-thumbs" : "single-image"}`}>
            <div className="gdg-gallery-main">
              <div className="gdg-image-badges gdg-image-badges-detail" aria-hidden="true">
                {storefrontImageBadges(product, settings.newArrivalDays).map((badge, index) => (
                  <span key={`${badge.variant}-${badge.label}-${index}`} className={`gdg-product-badge gdg-product-badge-${badge.variant}`}>
                    {badge.label}
                  </span>
                ))}
              </div>
              {visibleSelectedImage ? (
                <Image
                  src={visibleSelectedImage}
                  alt={productTitle}
                  width={900}
                  height={900}
                  sizes="(max-width: 768px) 92vw, 48vw"
                  unoptimized
                  onError={() => setFailedImages((current) => (current.includes(visibleSelectedImage) ? current : [...current, visibleSelectedImage]))}
                />
              ) : (
                <div className="gdg-image-placeholder" role="img" aria-label={`${productTitle} image unavailable`}>
                  <Package size={42} aria-hidden="true" />
                  <span>Image coming soon</span>
                </div>
              )}
            </div>
            {visibleGalleryImages.length > 1 ? (
              <div className="gdg-gallery-thumbs" aria-label="Product images">
                {visibleGalleryImages.slice(0, 5).map((image, index) => (
                  <button
                    type="button"
                    key={image}
                    className={image === visibleSelectedImage ? "active" : ""}
                    onClick={() => setSelectedImage(image)}
                    aria-label={`View ${productTitle} image ${index + 1}`}
                    aria-pressed={image === visibleSelectedImage}
                  >
                    <Image
                      src={image}
                      alt=""
                      width={82}
                      height={82}
                      sizes="82px"
                      unoptimized
                      onError={() => setFailedImages((current) => (current.includes(image) ? current : [...current, image]))}
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </aside>
          <section className="gdg-detail-info gdg-purchase-panel">
            <span className="gdg-product-category">{displayCategory}</span>
            <h1>{productTitle}</h1>
            <div className="gdg-detail-price">
              <strong>{money(product.price)}</strong>
              {product.compareAtPrice ? <s>{money(product.compareAtPrice)}</s> : null}
              <span className={isSoldOut ? "gdg-stock out" : "gdg-stock in"}>{availabilityLabel}</span>
            </div>
            <div className="gdg-detail-meta-row" aria-label="Product classification">
              {product.setName ? <span>Set: {product.setName}</span> : null}
              <span>{displayCategory}</span>
              <span>{conditionLabel}</span>
            </div>
            <p>{publicDescription}</p>
            <div className="gdg-detail-purchase-facts" aria-label="Buying details">
              <span>
                <Truck size={16} aria-hidden="true" />
                <b>{fulfillmentLabel}</b>
                <small>{fulfillmentDetail}</small>
              </span>
              <span>
                <CreditCard size={16} aria-hidden="true" />
                <b>{STOREFRONT_TAX_PAYMENT_COPY}</b>
                <small>Shipping and any required taxes appear before payment.</small>
              </span>
              {rewardEstimateLabel ? (
                <span>
                  <Trophy size={16} aria-hidden="true" />
                  <b>{rewardEstimateLabel}</b>
                  <small>{rewardProgramCopy} Estimated from merchandise subtotal only; excludes shipping and tax.</small>
                </span>
              ) : null}
            </div>
            <div className="gdg-product-status-list" aria-label="Product availability and purchase limits">
              <span>{availabilityDetail}</span>
              {purchaseLimitLabel ? <span>{purchaseLimitLabel}.</span> : null}
              <span>Condition: {conditionLabel}.</span>
            </div>
            {isSoldOut ? <p className="gdg-soldout-notice">{soldOutNote}</p> : null}
            <div className="gdg-quantity-control">
              <span>Quantity</span>
              <button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))} disabled={isSoldOut} aria-label={`Decrease ${productTitle} quantity`}>
                <Minus size={15} />
              </button>
              <b>{quantity}</b>
              <button
                type="button"
                disabled={isSoldOut || quantity >= effectiveMaxQuantity}
                aria-label={`Increase ${productTitle} quantity`}
                onClick={() => setQuantity((current) => Math.min(effectiveMaxQuantity, current + 1))}
              >
                <Plus size={15} />
              </button>
            </div>
            {quantityLimitReached ? <small className="gdg-limit-helper">Limit reached for this item.</small> : null}
            <div className="gdg-detail-actions">
              <button
                className="gdg-primary-button wide"
                type="button"
                disabled={isSoldOut}
                aria-label={`${soldOutActionLabel} ${productTitle}`}
                onClick={() => addProductToCart(false)}
              >
                {soldOutActionLabel}
              </button>
              <button
                className="gdg-secondary-button wide"
                type="button"
                disabled={isSoldOut}
                aria-label={`${soldOutSecondaryLabel} ${productTitle}`}
                onClick={() => addProductToCart(true)}
              >
                {soldOutSecondaryLabel}
              </button>
            </div>
            {notice ? (
              <p className="gdg-toast inline">
                <Check size={16} /> {notice}
              </p>
            ) : null}
            {!isSoldOut ? (
              <div className="gdg-detail-mobile-quick-action" aria-label="Mobile purchase shortcut">
                <span>
                  <b>{money(product.price)}</b>
                  <small>{availabilityLabel}</small>
                </span>
                <button className="gdg-primary-button compact" type="button" onClick={() => addProductToCart(false)} aria-label={`${actionLabel} ${productTitle}`}>
                  {actionLabel}
                </button>
              </div>
            ) : null}
            <div className="gdg-product-trust">
              {[
                ["Genuine products", "Sold by GameDayGrabs"],
                ["Carefully packaged", "Packed with protection"],
                ["Secure checkout", "Stripe handles payment"],
                ["Order support", "Questions answered by GameDayGrabs"]
              ].map(([title, text]) => (
                <span key={title}>
                  <ShieldCheck size={15} />
                  <b>{title}</b>
                  <small>{text}</small>
                </span>
              ))}
            </div>
            <GrabbyCard variant="product-helper" compact className="grabby-helper-strip gdg-product-grabby-card" />
          </section>
        </div>
      </section>
      <section className="gdg-description-section gdg-product-detail-sections">
        <article className="gdg-detail-card-wide">
          <h2>Product Description</h2>
          <p>{publicDescription}</p>
          {isSoldOut ? <p>{soldOutNote}</p> : null}
        </article>
        <article>
          <h2>What&apos;s included</h2>
          <ul>
            {includedBullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </article>
        <article>
          <h2>Product condition</h2>
          <p>Condition details are based on the listing information.</p>
          <ul>
            <li>Condition: {conditionLabel}.</li>
            {sealedSignal ? <li>Sealed/new status is shown when available in the listing.</li> : null}
          </ul>
        </article>
        <article>
          <h2>Product Details</h2>
          <ul>
            <li>Category: {displayCategory}.</li>
            <li>Condition: {conditionLabel}.</li>
            <li>Availability: {availabilityLabel}.</li>
            {purchaseLimitLabel ? <li>{purchaseLimitLabel}.</li> : null}
            <li>{GAMEDAYGRABS_PRODUCT_SELLER_DISCLOSURE}</li>
            <li>{settings.checkoutConfigured ? "Secure Stripe Checkout is available." : "Request Invoice mode is active until online checkout is configured."}</li>
            <li>Local pickup appears at checkout when available for this item.</li>
          </ul>
        </article>
        <article>
          <h2>Seller and authenticity</h2>
          <p>{GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE}</p>
          <ul>
            <li>{GAMEDAYGRABS_AUTHENTICITY_SOURCE_DISCLOSURE}</li>
            <li>{GAMEDAYGRABS_PRODUCT_SELLER_DISCLOSURE}</li>
            <li>Product names, brands, characters, and trademarks belong to their respective owners.</li>
          </ul>
        </article>
        <article>
          <h2>Shipping summary</h2>
          <p>Shipping is calculated from product weight and package size.</p>
          <ul>
            <li>Shipping is calculated in cart or checkout before payment.</li>
            <li>Displayed shipping may include the current packing and handling minimum.</li>
            <li>Final shipping is shown before payment.</li>
            {product.localPickupEligible ? <li>Local pickup may be available for this item.</li> : null}
            {settings.freeShippingThreshold ? <li>Free shipping threshold: {money(settings.freeShippingThreshold)}.</li> : null}
          </ul>
        </article>
        <article>
          <h2>Checkout hold</h2>
          <p>Items are held for 15 minutes once checkout starts.</p>
          <ul>
            <li>Availability is confirmed before payment.</li>
            <li>If checkout expires, the hold releases automatically.</li>
          </ul>
        </article>
        <article>
          <h2>Product issue support</h2>
          <p>{settings.returnPolicyText || "Sealed and collectible products are reviewed carefully before fulfillment. Returns are handled case by case, especially for sealed collectible items."}</p>
          <ul>
            <li>Listings show only customer-facing availability, condition, and checkout details.</li>
            <li>Contact GameDayGrabs before returning any collectible product.</li>
          </ul>
        </article>
      </section>
      {relatedProducts.length ? (
        <section className="gdg-section">
          <div className="gdg-section-header">
            <div>
              <h2>Related Products</h2>
              <p>More published products from GameDayGrabs.</p>
            </div>
            <Link href="/shop">View all</Link>
          </div>
          <div className="gdg-arrivals-row">
            {relatedProducts.slice(0, 4).map((entry) => (
              <ProductCard key={entry.id} product={entry} settings={settings} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function cartStockState(product: PublicStoreProductDTO & { requestedQuantity: number }) {
  if (isSoldOutProduct(product) || product.publicMaxQuantity <= 0) {
    return { label: "Sold Out", tone: "out", detail: "Remove this sold-out item to continue checkout." };
  }
  const effectiveMaxQuantity = storefrontEffectiveMaxQuantity(product);
  if (product.requestedQuantity > effectiveMaxQuantity) {
    const purchaseLimit = storefrontPurchaseLimitLabel(product);
    return { label: purchaseLimit ? "Purchase Limit" : "Stock Changed", tone: "warn", detail: "Update quantity before checkout." };
  }
  const purchaseLimit = storefrontPurchaseLimitLabel(product);
  if (product.availabilityLevel === "almost_gone") {
    return { label: "Almost gone", tone: "warn", detail: purchaseLimit ?? "Almost gone." };
  }
  if (product.availabilityLevel === "low_stock") {
    return { label: "Low Stock", tone: "limited", detail: purchaseLimit ?? "Small batch available." };
  }
  return { label: "In Stock", tone: "in", detail: purchaseLimit ?? "Ready for secure checkout." };
}

function cartHasBlockingStockIssue(products: Array<PublicStoreProductDTO & { requestedQuantity: number }>) {
  return products.some((product) => isSoldOutProduct(product) || product.publicMaxQuantity <= 0 || product.requestedQuantity > storefrontEffectiveMaxQuantity(product));
}

export function CartClient({ settings }: { settings: StorefrontSettingsDTO }) {
  const items = useSyncExternalStore(subscribeCart, getCartSnapshot, getServerCartSnapshot);
  const [products, setProducts] = useState<Array<PublicStoreProductDTO & { requestedQuantity: number }>>([]);
  const [message, setMessage] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"shipping" | "pickup">("shipping");
  const [destinationZip, setDestinationZip] = useState("");
  const [shippingQuote, setShippingQuote] = useState<ShippingQuoteResult | null>(null);
  const [shippingQuoteMessage, setShippingQuoteMessage] = useState("");
  const [quoteNow, setQuoteNow] = useState(() => Date.now());
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!items.length) {
      return;
    }
    fetch("/api/storefront/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items })
    })
      .then((response) => response.json())
      .then((payload) => {
        if (payload.error) throw new Error(payload.error);
        setProducts(payload.items);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Cart could not be loaded."));
  }, [items]);

  function updateQuantity(productId: string, quantity: number) {
    const product = products.find((entry) => entry.id === productId);
    const nextQuantity = product ? Math.min(storefrontEffectiveMaxQuantity(product), Math.max(1, quantity)) : Math.max(1, quantity);
    const next = items.map((item) => (item.id === productId ? { ...item, quantity: nextQuantity } : item));
    writeCart(next);
  }

  function removeItem(productId: string) {
    const product = products.find((entry) => entry.id === productId);
    const next = items.filter((item) => item.id !== productId);
    if (!next.length) setProducts([]);
    writeCart(next);
    if (product) {
      trackStorefrontEvent("product_removed_from_cart", {
        productSlug: product.slug,
        productCategory: displayStorefrontCategory(product),
        productStatus: product.status,
        quantity: product.requestedQuantity
      });
    }
  }

  const subtotal = products.reduce((sum, product) => sum + product.price * product.requestedQuantity, 0);
  const estimatedRewardPoints = settings.customerAccounts.enabled && settings.customerAccounts.rewardsEnabled ? Math.floor(Math.max(0, subtotal)) : 0;
  const shippingEstimate = calculateCartShipping(products, { subtotal, freeShippingThreshold: settings.freeShippingThreshold });
  const localPickupAvailable = shippingEstimate.localPickupEligible;
  const calculatedShippingEnabled = Boolean(settings.calculatedUspsShipping?.enabled);
  const shippingOption = fulfillmentMethod === "pickup" ? shippingEstimate.shippingOptions.find((option) => option.id === "local_pickup") ?? null : shippingEstimate.defaultShippingOption;
  const quotedShipping = fulfillmentMethod === "shipping" && shippingQuote ? shippingQuote.amount : null;
  const shipping = fulfillmentMethod === "pickup" ? 0 : quotedShipping ?? shippingOption?.amount ?? 0;
  const total = subtotal + shipping;
  const shippingSummary =
    fulfillmentMethod === "pickup"
      ? "Local Pickup - Free"
      : shippingQuote
        ? `${shippingQuote.service} - ${money(shippingQuote.amount)}`
        : shippingOption
          ? calculatedShippingEnabled
            ? "Enter ZIP for USPS quote"
            : `Estimated ${money(shipping)}`
          : "Final shipping shown before payment";
  const contactEmail = settings.contactEmail || "gamedaygrabs@outlook.com";
  const isStripeCheckout = settings.checkoutConfigured;
  const onlineTaxEnabled = settings.tax.features.onlineStripeTaxEnabled;
  const rewardProgramCopy = storefrontRewardsProgramCopy(settings);
  const hasBlockingStockIssue = cartHasBlockingStockIssue(products);
  const soldOutProducts = products.filter((product) => isSoldOutProduct(product) || product.publicMaxQuantity <= 0);
  const overQuantityProducts = products.filter((product) => product.requestedQuantity > storefrontEffectiveMaxQuantity(product) && product.publicMaxQuantity > 0);
  const quoteRequired = isStripeCheckout && calculatedShippingEnabled && fulfillmentMethod === "shipping";
  const quoteExpired = shippingQuote ? Date.parse(shippingQuote.expiresAt) <= quoteNow : false;
  const missingShippingQuote = quoteRequired && fulfillmentMethod === "shipping" && !hasBlockingStockIssue && (!shippingQuote || quoteExpired);
  const quoteResetKey = JSON.stringify({ items, fulfillmentMethod });
  const previousQuoteResetKey = useRef(quoteResetKey);
  const checkoutDisabled =
    busy ||
    quoteBusy ||
    hasBlockingStockIssue ||
    (quoteRequired && (!shippingQuote || quoteExpired)) ||
    (!isStripeCheckout && (!customerEmail.trim() || !customerName.trim()));
  const successMessage = message.toLowerCase().includes("received");
  const cartIsLoading = items.length > 0 && !products.length && !message;

  useEffect(() => {
    if (previousQuoteResetKey.current === quoteResetKey) return;
    const hadQuote = Boolean(shippingQuote);
    previousQuoteResetKey.current = quoteResetKey;
    setShippingQuote(null);
    setShippingQuoteMessage(hadQuote && fulfillmentMethod === "shipping" ? "Cart changed. Recalculate shipping." : "");
  }, [fulfillmentMethod, quoteResetKey, shippingQuote]);

  useEffect(() => {
    if (!localPickupAvailable && fulfillmentMethod === "pickup") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Keeps checkout fulfillment server-safe if the cart no longer supports pickup.
      setFulfillmentMethod("shipping");
    }
  }, [localPickupAvailable, fulfillmentMethod]);

  useEffect(() => {
    if (!shippingQuote) return undefined;
    const timer = window.setInterval(() => setQuoteNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [shippingQuote]);

  function updateDestinationZip(value: string) {
    setDestinationZip(value.replace(/\D/g, "").slice(0, 5));
    setShippingQuote(null);
    setShippingQuoteMessage("");
  }

  async function calculateUspsShippingQuote() {
    if (!/^\d{5}$/.test(destinationZip)) {
      setShippingQuoteMessage("Enter a valid 5-digit ZIP code.");
      return;
    }
    setQuoteBusy(true);
    setShippingQuoteMessage("");
    try {
      const response = await fetch("/api/storefront/shipping/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, destinationZip, country: "US" })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Shipping quote could not be calculated.");
      setShippingQuote(payload.quote);
      setQuoteNow(Date.now());
      setShippingQuoteMessage(payload.quote?.warning || "USPS shipping calculated.");
    } catch (error) {
      setShippingQuote(null);
      setShippingQuoteMessage(error instanceof Error ? error.message : "Shipping quote could not be calculated.");
    } finally {
      setQuoteBusy(false);
    }
  }

  function removeSoldOutItems() {
    const blockedIds = new Set(soldOutProducts.map((product) => product.id));
    const next = items.filter((item) => !blockedIds.has(item.id));
    setProducts(products.filter((product) => !blockedIds.has(product.id)));
    setMessage("");
    writeCart(next);
  }

  function syncChangedQuantities() {
    const next = items.map((item) => {
      const product = products.find((entry) => entry.id === item.id);
      if (!product) return item;
      return { ...item, quantity: Math.min(storefrontEffectiveMaxQuantity(product), Math.max(1, item.quantity)) };
    });
    writeCart(next);
    setMessage("Quantity updated because availability or purchase limits changed.");
  }

  async function checkout() {
    trackStorefrontEvent("checkout_started", {
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      fulfillmentMethod,
      checkoutMode: isStripeCheckout ? "stripe" : "invoice"
    });
    setBusy(true);
    setMessage("");
    try {
      const requestPayload: {
        items: CartItem[];
        fulfillmentMethod: "shipping" | "pickup";
        customerEmail?: string;
        customerName?: string;
        customerPhone?: string;
        customerNotes?: string;
        shippingQuoteToken?: string;
      } = {
        items,
        fulfillmentMethod
      };

      if (isStripeCheckout) {
        if (customerEmail.trim()) requestPayload.customerEmail = customerEmail.trim();
        if (customerName.trim()) requestPayload.customerName = customerName.trim();
        if (quoteRequired && shippingQuote?.quoteId) requestPayload.shippingQuoteToken = shippingQuote.quoteId;
      } else {
        requestPayload.customerEmail = customerEmail.trim();
        requestPayload.customerName = customerName.trim();
        if (customerPhone.trim()) requestPayload.customerPhone = customerPhone.trim();
        if (customerNotes.trim()) requestPayload.customerNotes = customerNotes.trim();
      }

      const response = await fetch(isStripeCheckout ? "/api/storefront/checkout/session" : "/api/storefront/invoice-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestPayload)
      });
      const responsePayload = (await response.json()) as { error?: string; requestId?: string; checkoutUrl?: string };
      if (!response.ok) {
        const reference = responsePayload.requestId ? ` Reference: ${responsePayload.requestId}.` : "";
        throw new Error(`${responsePayload.error || "Request could not start."}${reference}`);
      }
      if (isStripeCheckout) {
        if (!responsePayload.checkoutUrl) throw new Error("Checkout could not start.");
        window.location.href = responsePayload.checkoutUrl;
      } else {
        setMessage(`Thanks - we received your request and will contact you shortly at ${contactEmail}.`);
        setProducts([]);
        setCustomerNotes("");
        writeCart([]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request could not start.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gdg-cart-page">
      <div className="gdg-cart-header">
        <div>
          <h1>Review your cart <Sparkles size={28} aria-hidden="true" /></h1>
          <p>Confirm your items, choose shipping or pickup, then continue to secure checkout.</p>
        </div>
        <Link href="/shop" className="gdg-secondary-button">
          Continue Shopping
        </Link>
      </div>
      <div className="gdg-checkout-hero">
        <div className="gdg-checkout-trust-row" aria-label="Checkout trust points">
          <article>
            <ShieldCheck size={24} />
            <div>
              <strong>Secure Checkout</strong>
              <small>Your info is protected</small>
            </div>
          </article>
          <article>
            <Truck size={24} />
            <div>
              <strong>Fast Shipping</strong>
              <small>Packed and shipped quickly</small>
            </div>
          </article>
          <article>
            <Package size={24} />
            <div>
              <strong>Carefully Packaged</strong>
              <small>Handled like a collection</small>
            </div>
          </article>
          <article>
            <BadgeCheck size={24} />
            <div>
              <strong>Genuine products</strong>
              <small>Independent reseller</small>
            </div>
          </article>
        </div>
        <div className="gdg-cart-hero-visual" aria-hidden="true">
          <Sparkles size={22} />
          <ShoppingBag size={54} />
          <Star size={18} />
        </div>
      </div>
      {message ? <p className={successMessage ? "gdg-toast" : "gdg-error"}>{message}</p> : null}
      {cartIsLoading ? (
        <div className="gdg-empty gdg-cart-empty compact">
          <span>
            <ShoppingCart size={30} />
          </span>
          <h2>Loading your cart...</h2>
          <p>Checking current product availability before checkout.</p>
        </div>
      ) : products.length ? (
        <div className="gdg-cart-grid">
          <div className="gdg-cart-main">
            {hasBlockingStockIssue ? (
              <div className="gdg-cart-stock-warning">
                <div className="gdg-cart-stock-warning-copy">
                  <strong>Cart availability changed.</strong>
                  <small>Remove sold-out items or update changed quantities before checkout.</small>
                </div>
                <div className="gdg-card-actions">
                  {overQuantityProducts.length ? (
                    <button className="gdg-secondary-button" type="button" onClick={syncChangedQuantities}>
                      Update quantities
                    </button>
                  ) : null}
                  {soldOutProducts.length ? (
                    <button className="gdg-secondary-button gdg-stock-remove-button" type="button" onClick={removeSoldOutItems}>
                      {soldOutProducts.length === 1 ? "Remove sold-out item" : "Remove sold-out items"}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="gdg-cart-lines">
              {products.map((product) => {
                const stock = cartStockState(product);
                const title = cleanStorefrontTitle(product.title);
                const maxQuantity = storefrontEffectiveMaxQuantity(product);
                return (
                  <article className={`gdg-cart-line ${stock.tone === "out" || stock.tone === "warn" ? "attention" : ""}`} key={product.id}>
                    <ProductImage product={product} size="thumb" />
                    <div className="gdg-cart-line-copy">
                      <h2>{title}</h2>
                      <small>{publicCategoryLabel(displayStorefrontCategory(product))}</small>
                      <div className="gdg-cart-line-badges" aria-label={`Fulfillment options for ${title}`}>
                        {product.shippingAvailable ? <span>Ships</span> : null}
                        {product.localPickupEligible ? <span>Local Pickup</span> : null}
                      </div>
                      <span className={`gdg-cart-stock ${stock.tone}`}>
                        <Check size={13} />
                        {stock.label}
                      </span>
                      <small>{stock.detail}</small>
                      <div className="gdg-quantity-control compact" aria-label={`Quantity for ${title}`}>
                        <button type="button" disabled={product.requestedQuantity <= 1} onClick={() => updateQuantity(product.id, product.requestedQuantity - 1)} aria-label={`Decrease ${title} quantity`}>
                          <Minus size={14} />
                        </button>
                        <b>{product.requestedQuantity}</b>
                        <button type="button" disabled={product.publicMaxQuantity <= 0 || product.requestedQuantity >= maxQuantity} onClick={() => updateQuantity(product.id, product.requestedQuantity + 1)} aria-label={`Increase ${title} quantity`}>
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="gdg-cart-line-price">
                      <strong>{money(product.price * product.requestedQuantity)}</strong>
                      <small>{money(product.price)} each</small>
                    </div>
                    <button className="gdg-icon-button" type="button" onClick={() => removeItem(product.id)} aria-label={`Remove ${title}`}>
                      <Trash2 size={16} />
                    </button>
                  </article>
                );
              })}
            </div>
            {!isStripeCheckout ? (
              <div className="gdg-invoice-form-card">
                <div>
                  <span className="gdg-section-kicker">Request invoice</span>
                  <h2>Tell us where to send your invoice.</h2>
                  <p>No card is charged today. We will confirm availability and contact you at {contactEmail}.</p>
                </div>
                <div className="gdg-invoice-form-grid">
                  <label>
                    Name
                    <span className="gdg-checkout-field">
                      <User size={17} />
                      <input value={customerName} onChange={(event) => setCustomerName(event.currentTarget.value)} placeholder="Your name" />
                    </span>
                  </label>
                  <label>
                    Email
                    <span className="gdg-checkout-field">
                      <Mail size={17} />
                      <input value={customerEmail} onChange={(event) => setCustomerEmail(event.currentTarget.value)} placeholder="you@example.com" type="email" />
                    </span>
                  </label>
                  <label>
                    Phone <span>optional</span>
                    <span className="gdg-checkout-field">
                      <Phone size={17} />
                      <input value={customerPhone} onChange={(event) => setCustomerPhone(event.currentTarget.value)} placeholder="Optional phone number" type="tel" />
                    </span>
                  </label>
                  <label className="wide">
                    Notes <span>optional</span>
                    <span className="gdg-checkout-field textarea">
                      <MessageCircle size={17} />
                      <textarea value={customerNotes} onChange={(event) => setCustomerNotes(event.currentTarget.value)} placeholder="Questions, pickup request, or anything we should know?" rows={3} />
                    </span>
                  </label>
                </div>
              </div>
            ) : null}
          </div>
          <aside className="gdg-cart-summary gdg-checkout-panel">
            <div className="gdg-summary-heading">
              <ShieldCheck size={20} />
              <h2>Order Summary</h2>
            </div>
            <div className="gdg-summary-rows">
              <span>
                <b>Merchandise subtotal</b>
                {money(subtotal)}
              </span>
              {estimatedRewardPoints > 0 ? (
                <span>
                  <b>Estimated rewards</b>
                  <em>{estimatedRewardPoints.toLocaleString()} point{estimatedRewardPoints === 1 ? "" : "s"} on merchandise only. {rewardProgramCopy}</em>
                </span>
              ) : null}
              <span>
                <b>Shipping calculated at checkout / pickup</b>
                <em>{shippingSummary}</em>
              </span>
              <span>
                <b>{STOREFRONT_TAX_PAYMENT_COPY}</b>
                <em>Shipping stays separate from any required taxes.</em>
              </span>
              <strong>
                <b>Cart estimate</b>
                {money(total)}
              </strong>
            </div>
            {isStripeCheckout && (calculatedShippingEnabled || localPickupAvailable) ? (
              <div className="gdg-shipping-quote-card">
                {localPickupAvailable ? (
                  <div className="gdg-fulfillment-choice" role="group" aria-label="Fulfillment method">
                    <button
                      className={fulfillmentMethod === "shipping" ? "active" : ""}
                      type="button"
                      onClick={() => setFulfillmentMethod("shipping")}
                    >
                      Ship order
                    </button>
                    <button
                      className={fulfillmentMethod === "pickup" ? "active" : ""}
                      type="button"
                      onClick={() => {
                        setFulfillmentMethod("pickup");
                        trackStorefrontEvent("local_pickup_selected", {
                          itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
                          fulfillmentMethod: "pickup"
                        });
                      }}
                    >
                      Local Pickup - Free
                    </button>
                  </div>
                ) : null}
                {calculatedShippingEnabled && fulfillmentMethod === "shipping" ? (
                  <div className="gdg-usps-quote-form">
                    <label>
                      Calculate USPS shipping
                      <span>Enter ZIP code to calculate USPS shipping.</span>
                    </label>
                    <div className="gdg-usps-quote-controls">
                      <input
                        inputMode="numeric"
                        maxLength={5}
                        pattern="\\d{5}"
                        placeholder="ZIP code"
                        value={destinationZip}
                        onChange={(event) => updateDestinationZip(event.currentTarget.value)}
                      />
                      <button className="gdg-secondary-button" type="button" disabled={quoteBusy || destinationZip.length !== 5} onClick={calculateUspsShippingQuote}>
                        {quoteBusy ? "Calculating..." : "Calculate"}
                      </button>
                    </div>
                    {shippingQuote ? (
                      <p className={shippingQuote.fallbackUsed ? "gdg-shipping-quote-warning" : "gdg-shipping-quote-result"}>
                        <strong>{shippingQuote.fallbackUsed ? "Standard Shipping Estimate" : shippingQuote.service}</strong>
                        <span>{money(shippingQuote.amount)}</span>
                      </p>
                    ) : null}
                    {shippingQuoteMessage ? <small>{shippingQuoteMessage}</small> : null}
                    <small>Calculated using packed product weight and package size.</small>
                    <div className="gdg-cart-grabby-tip" aria-label="Grabby shipping tip">
                      <span className="gdg-cart-grabby-mark" aria-hidden="true">
                        <span>G</span>
                      </span>
                      <span className="gdg-cart-grabby-copy">
                        <strong>Grabby tip</strong>
                        <span>Enter your ZIP to see USPS shipping.</span>
                      </span>
                    </div>
                  </div>
                ) : null}
                {onlineTaxEnabled && fulfillmentMethod === "pickup" ? (
                  <p className="gdg-checkout-tax-note">Any required Local Pickup taxes are shown before payment.</p>
                ) : null}
              </div>
            ) : null}
            {hasBlockingStockIssue ? <p className="gdg-summary-warning compact">Please remove sold-out items or update changed quantities before checkout.</p> : null}
            {missingShippingQuote ? (
              <p className="gdg-summary-warning compact gdg-shipping-required-warning">{quoteExpired ? "Shipping quote expired. Enter ZIP for USPS shipping, or choose Local Pickup if available." : "Enter ZIP for USPS shipping, or choose Local Pickup if available."}</p>
            ) : null}
            <button className="gdg-primary-button wide gdg-checkout-button" type="button" disabled={checkoutDisabled} onClick={checkout}>
              <Lock size={17} />
              <span>
                {busy ? (isStripeCheckout ? "Holding items..." : "Working...") : isStripeCheckout ? "Proceed to Secure Checkout" : "Request Invoice"}
                <small>
                  {busy && isStripeCheckout
                    ? "Your items are held for 15 minutes while you complete checkout."
                    : isStripeCheckout
                      ? "Powered by Stripe"
                      : "No card is charged today."}
                </small>
              </span>
              <ChevronRight size={18} />
            </button>
            {!isStripeCheckout ? (
              <div className="gdg-payment-row" aria-label="Invoice request note">
                <CreditCard size={16} />
                <small>We will contact you shortly at {contactEmail}.</small>
              </div>
            ) : null}
            {isStripeCheckout ? (
              <p className="gdg-checkout-trust-line">
                <Lock size={15} aria-hidden="true" />
                Secure checkout by Stripe. Guest checkout available.
                {" "}{STOREFRONT_TAX_PAYMENT_COPY} Shipping and rewards stay separate.
              </p>
            ) : null}
            <details className="gdg-checkout-notes">
              <summary>Checkout notes</summary>
              <ul>
                <li>Shipping is calculated by ZIP before payment.</li>
                <li>Items are reserved when checkout starts.</li>
                <li>Guest checkout is available.</li>
                {settings.customerAccounts.enabled ? (
                  <li>
                    <Link href="/account/login" className="gdg-cart-account-link" onClick={() => trackStorefrontEvent("account_login_requested", { source: "cart" })}>
                      Create an account
                    </Link>{" "}
                    to track orders{settings.customerAccounts.rewardsEnabled ? " and rewards" : ""}.
                  </li>
                ) : null}
                <li>Questions? <a href={`mailto:${contactEmail}`}>{contactEmail}</a></li>
              </ul>
            </details>
          </aside>
        </div>
      ) : (
        <div className="gdg-empty gdg-cart-empty">
          <GrabbyCard
            variant="empty-cart"
            ctaHref={storefrontCollectionPath("new-arrivals")}
            ctaLabel="Shop New Arrivals"
            className="gdg-cart-grabby-card"
          />
          <p className="gdg-cart-empty-support-copy">Guest checkout stays available when you are ready to buy.</p>
          <div className="gdg-card-actions">
            <Link href={storefrontCollectionPath("pokemon-sealed-products")} className="gdg-primary-button">
              Shop Pok&eacute;mon
            </Link>
            <Link href={storefrontCollectionPath("new-arrivals")} className="gdg-secondary-button">
              View New Arrivals
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

export function CheckoutSuccessClient({
  orderReference = "",
  accountCtaEnabled = false,
  rewardsCtaEnabled = false
}: {
  orderReference?: string;
  accountCtaEnabled?: boolean;
  rewardsCtaEnabled?: boolean;
}) {
  useEffect(() => {
    writeCart([]);
    trackStorefrontEvent("purchase_completed", {
      source: "checkout_success",
      checkoutMode: "stripe",
      hasQuery: Boolean(orderReference)
    });
  }, [orderReference]);

  return (
    <section className="gdg-result-card">
      <span>
        <Check size={22} />
      </span>
      <h1>Payment received</h1>
      {orderReference ? <p className="gdg-order-reference">Order {orderReference}</p> : null}
      <p>Your order is being confirmed by Stripe. Inventory updates after the secure webhook confirms payment.</p>
      <p>Your confirmation email and order detail show merchandise, shipping, sales tax, and total separately.</p>
      {accountCtaEnabled ? (
        <div className="gdg-success-account-cta">
          <strong>Create an account to track this order{rewardsCtaEnabled ? " and earn rewards" : ""}.</strong>
          <span>{rewardsCtaEnabled ? "Track points in your account. Earn points now. Redemption coming soon." : "Account creation is optional and guest checkout remains available."}</span>
          <Link href="/account/login" className="gdg-secondary-button compact" onClick={() => trackStorefrontEvent("account_login_requested", { source: "checkout_success" })}>
            Create or Sign In
          </Link>
        </div>
      ) : null}
      <div className="gdg-result-actions">
        <Link href="/shop" className="gdg-primary-button">
          Back to Shop
        </Link>
        <Link href="/contact" className="gdg-secondary-button">
          Contact GameDayGrabs
        </Link>
      </div>
    </section>
  );
}
