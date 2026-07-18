export const STOREFRONT_SHOP_PAGE_SIZE = 24;
export const STOREFRONT_SHOP_MAX_PAGE_SIZE = 48;
export const STOREFRONT_SHOP_MAX_CANDIDATES = 240;
export const STOREFRONT_SHOP_MAX_QUERY_LENGTH = 80;
export const STOREFRONT_SHOP_MAX_FILTER_LENGTH = 80;

export const storefrontShopSortOptions = ["featured", "newest", "price-low", "price-high", "name", "availability"] as const;
export type StorefrontShopSort = (typeof storefrontShopSortOptions)[number];

export const storefrontShopAvailabilityOptions = ["in-stock", "sold-out", "all"] as const;
export type StorefrontShopAvailability = (typeof storefrontShopAvailabilityOptions)[number];

function cleanText(value: string | null | undefined, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function normalizeStorefrontShopQuery(value: string | null | undefined) {
  return cleanText(value, STOREFRONT_SHOP_MAX_QUERY_LENGTH);
}

export function normalizeStorefrontShopFilter(value: string | null | undefined) {
  return cleanText(value, STOREFRONT_SHOP_MAX_FILTER_LENGTH);
}

export function normalizeStorefrontShopSort(value: string | null | undefined): StorefrontShopSort {
  return storefrontShopSortOptions.includes(value as StorefrontShopSort) ? (value as StorefrontShopSort) : "featured";
}

export function normalizeStorefrontShopAvailability(value: string | null | undefined): StorefrontShopAvailability {
  return storefrontShopAvailabilityOptions.includes(value as StorefrontShopAvailability) ? (value as StorefrontShopAvailability) : "in-stock";
}

export function normalizeStorefrontShopPage(value: string | number | null | undefined) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? "1"), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

export function normalizeStorefrontShopPageSize(value: string | number | null | undefined) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? STOREFRONT_SHOP_PAGE_SIZE), 10);
  if (!Number.isFinite(parsed)) return STOREFRONT_SHOP_PAGE_SIZE;
  return Math.min(STOREFRONT_SHOP_MAX_PAGE_SIZE, Math.max(1, Math.floor(parsed)));
}

export function storefrontShopSearchParams(input: {
  q?: string | null;
  category?: string | null;
  set?: string | null;
  availability?: string | null;
  sort?: string | null;
  page?: string | number | null;
  pageSize?: string | number | null;
}) {
  return {
    q: normalizeStorefrontShopQuery(input.q),
    category: normalizeStorefrontShopFilter(input.category),
    set: normalizeStorefrontShopFilter(input.set),
    availability: normalizeStorefrontShopAvailability(input.availability),
    sort: normalizeStorefrontShopSort(input.sort),
    page: normalizeStorefrontShopPage(input.page),
    pageSize: normalizeStorefrontShopPageSize(input.pageSize)
  };
}
