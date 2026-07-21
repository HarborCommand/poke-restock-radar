export const GAMEDAYGRABS_DOMAIN = "gamedaygrabs.com";
export const GAMEDAYGRABS_WWW_DOMAIN = "www.gamedaygrabs.com";
export const GAMEDAYGRABS_PUBLIC_URL = `https://${GAMEDAYGRABS_DOMAIN}`;
export const GAMEDAYGRABS_CANONICAL_PUBLIC_URL = `https://${GAMEDAYGRABS_WWW_DOMAIN}`;
export const POKE_RESTOCK_RADAR_PRODUCTION_HOST = "poke-restock-radar.vercel.app";
export const POKE_RESTOCK_RADAR_PRODUCTION_URL = `https://${POKE_RESTOCK_RADAR_PRODUCTION_HOST}`;
export const GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL = "gamedaygrabs@outlook.com";
export const GAMEDAYGRABS_SPORTS_CARDS_URL = "https://www.ebay.com/str/a1rbreaks";
export const LEGACY_PUBLIC_CONTACT_EMAIL = "ariverah7@gmail.com";

export function normalizedHost(host: string | null | undefined) {
  return (host || "").toLowerCase().split(":")[0]?.trim() || "";
}

export function isGameDayGrabsHost(host: string | null | undefined) {
  const normalized = normalizedHost(host);
  return normalized === GAMEDAYGRABS_DOMAIN || normalized === GAMEDAYGRABS_WWW_DOMAIN;
}

export function isRawProductionVercelHost(host: string | null | undefined) {
  return normalizedHost(host) === POKE_RESTOCK_RADAR_PRODUCTION_HOST;
}

export function isBranchPreviewVercelHost(host: string | null | undefined) {
  const normalized = normalizedHost(host);
  return normalized.endsWith(".vercel.app") && normalized !== POKE_RESTOCK_RADAR_PRODUCTION_HOST;
}

export function isPublicStorefrontPath(pathname: string) {
  return (
    pathname === "/shop" ||
    pathname === "/cart" ||
    pathname === "/about" ||
    pathname === "/contact" ||
    pathname === "/policies" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname === "/product-feed.xml" ||
    pathname === "/sitemap.xml" ||
    pathname === "/robots.txt" ||
    pathname.startsWith("/product/") ||
    pathname.startsWith("/shop/product/") ||
    pathname.startsWith("/collections/") ||
    pathname.startsWith("/policies/")
  );
}

export function isRoutingBypassPath(pathname: string) {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/account/") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/offline.html" ||
    pathname.startsWith("/brand/")
  );
}

const safeRedirectQueryKeys = new Set(["q", "category", "set", "availability", "sort", "page", "ref"]);

export function safeStorefrontRedirectUrl(pathname: string, searchParams: URLSearchParams) {
  const target = new URL(pathname, GAMEDAYGRABS_CANONICAL_PUBLIC_URL);
  for (const [key, value] of searchParams.entries()) {
    const normalizedKey = key.toLowerCase();
    if (safeRedirectQueryKeys.has(normalizedKey) || normalizedKey.startsWith("utm_")) {
      target.searchParams.append(key, value);
    }
  }
  return target;
}

export function storefrontContactEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === LEGACY_PUBLIC_CONTACT_EMAIL) {
    return GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;
  }
  return normalized;
}

export function storefrontSportsCardsUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized.toLowerCase() === "https://www.ebay.com/str/gamedaygrabs") {
    return GAMEDAYGRABS_SPORTS_CARDS_URL;
  }
  return normalized;
}
