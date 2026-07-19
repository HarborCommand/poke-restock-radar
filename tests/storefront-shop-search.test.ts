import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  STOREFRONT_SHOP_MAX_CANDIDATES,
  STOREFRONT_SHOP_MAX_PAGE_SIZE,
  STOREFRONT_SHOP_MAX_QUERY_LENGTH,
  normalizeStorefrontShopAvailability,
  normalizeStorefrontShopPage,
  normalizeStorefrontShopPageSize,
  normalizeStorefrontShopQuery,
  normalizeStorefrontShopSort,
  storefrontShopSearchParams
} from "../src/lib/storefront-shop-query";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function sourceSlice(source: string, startNeedle: string, endNeedle?: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing source start: ${startNeedle}`);
  if (!endNeedle) return source.slice(start);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing source end: ${endNeedle}`);
  return source.slice(start, end);
}

const client = readProjectFile("src/components/StorefrontClient.tsx");
const css = readProjectFile("src/app/globals.css");
const storefront = readProjectFile("src/lib/storefront.ts");
const shopApiRoute = readProjectFile("src/app/api/storefront/shop/search/route.ts");
const shopPage = readProjectFile("src/app/shop/page.tsx");
const serverViews = readProjectFile("src/components/StorefrontServerViews.tsx");
const productGrid = sourceSlice(client, "export function ProductGrid", "export function CartClient");
const searchTextHelper = sourceSlice(storefront, "function publicProductSearchText", "function publicProductAvailabilityScore");
const sortHelper = sourceSlice(storefront, "function sortPublicProductsForShop", "function storefrontMatchesShopAvailability");
const shopSearch = sourceSlice(storefront, "export async function searchPublicStoreProducts", "export async function getPublicStoreProduct");

test("shop search parameter normalization is bounded and deterministic", () => {
  assert.equal(STOREFRONT_SHOP_MAX_CANDIDATES, 240);
  assert.equal(normalizeStorefrontShopQuery(` ${"q".repeat(120)}\n\t `).length, STOREFRONT_SHOP_MAX_QUERY_LENGTH);
  assert.equal(normalizeStorefrontShopSort("availability"), "availability");
  assert.equal(normalizeStorefrontShopSort("stock"), "featured");
  assert.equal(normalizeStorefrontShopAvailability("sold-out"), "sold-out");
  assert.equal(normalizeStorefrontShopAvailability("unknown"), "in-stock");
  assert.equal(normalizeStorefrontShopPage("-4"), 1);
  assert.equal(normalizeStorefrontShopPage("4.9"), 4);
  assert.equal(normalizeStorefrontShopPage("500"), 100);
  assert.equal(normalizeStorefrontShopPageSize("999"), STOREFRONT_SHOP_MAX_PAGE_SIZE);

  assert.deepEqual(storefrontShopSearchParams({ q: "  Evolving   skies  ", sort: "name", availability: "all", page: "2", pageSize: "8" }), {
    q: "Evolving skies",
    category: "",
    set: "",
    availability: "all",
    sort: "name",
    page: 2,
    pageSize: 8
  });
});

test("shop search API is read-only, public-safe, cacheable, and returns safe errors", () => {
  assert.match(shopApiRoute, /export async function GET\(request: Request\)/);
  assert.match(shopApiRoute, /searchPublicStoreProducts\(\{[\s\S]*?q: url\.searchParams\.get\("q"\),[\s\S]*?pageSize: url\.searchParams\.get\("pageSize"\)[\s\S]*?\}\)/);
  assert.match(shopApiRoute, /"Cache-Control": "public, max-age=30, stale-while-revalidate=60"/);
  assert.match(shopApiRoute, /SHOP_SEARCH_FAILED/);
  assert.match(shopApiRoute, /requestId/);
  assert.doesNotMatch(shopApiRoute, /prisma\.(customer|reward|storefrontOrder|inventorySale|payment|refund|tax)/i);
  assert.doesNotMatch(shopApiRoute, /(POST|PUT|PATCH|DELETE)\(/);
});

test("server-side shop search only returns public listings from a bounded candidate set", () => {
  assert.match(shopSearch, /prisma\.inventoryItem\.findMany\(\{[\s\S]*?publishToStore: true/);
  assert.match(shopSearch, /storeStatus: \{ in: \[\.\.\.PUBLIC_STOREFRONT_VISIBLE_STATUSES\] \}/);
  assert.match(shopSearch, /publicPrice: \{ not: null \}/);
  assert.match(shopSearch, /publicSlug: \{ not: null \}/);
  assert.match(shopSearch, /take: STOREFRONT_SHOP_MAX_CANDIDATES/);
  assert.match(shopSearch, /publicProductSearchText\(product\)\.includes\(q\)/);
  assert.match(searchTextHelper, /product\.sku/);
  assert.match(searchTextHelper, /product\.upc/);
  assert.match(searchTextHelper, /product\.setName/);
  assert.match(shopSearch, /storefrontMatchesShopAvailability\(product, applied\.availability\)/);
  assert.doesNotMatch(shopSearch, /customer|reward|payment|refund|metadata|idempotencyKey/i);
});

test("shop search supports the required customer-facing filters and stable sort options", () => {
  for (const option of ["featured", "newest", "price-low", "price-high", "name", "availability"]) {
    assert.match(sortHelper, new RegExp(`sort === "${option}"|return availabilityDelta`));
    assert.match(productGrid, new RegExp(`<option value="${option}"`));
  }

  for (const label of ["Name, set, category, SKU, or UPC", "Category / product type", "Set / series", "Availability", "Apply Filters", "Reset"]) {
    assert.match(productGrid, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(productGrid, /Load More/);
  assert.match(productGrid, /Showing \$\{visibleProducts\.length\} of \$\{shopTotal\}/);
  assert.match(productGrid, /\$\{shopTotal\} result/);
});

test("shop page and server render use normalized URL params for first paint", () => {
  for (const param of ["q", "category", "set", "sort", "availability", "page"]) {
    assert.match(shopPage, new RegExp(`${param}=\\{firstParam\\(params\\.${param}\\)\\}`));
  }
  assert.match(serverViews, /searchPublicStoreProducts\(\{ q, category, set, sort, availability, page \}\)/);
  assert.match(serverViews, /initialShopResult=\{shopResult\}/);
  assert.match(serverViews, /initialQuery=\{shopResult\.applied\.q\}/);
  assert.match(serverViews, /initialSet=\{shopResult\.applied\.set\}/);
});

test("client search avoids stale requests and keeps browser history navigable", () => {
  assert.match(productGrid, /const activeShopRequest = useRef<AbortController \| null>\(null\)/);
  assert.match(productGrid, /const shopRequestSeq = useRef\(0\)/);
  assert.match(productGrid, /activeShopRequest\.current\?\.abort\(\)/);
  assert.match(productGrid, /signal: controller\.signal/);
  assert.match(productGrid, /sequence !== shopRequestSeq\.current/);
  assert.match(productGrid, /currentShopFilterState\(options\.state\)/);
  assert.match(productGrid, /window\.history\.pushState/);
  assert.match(productGrid, /window\.history\.replaceState/);
  assert.match(productGrid, /window\.addEventListener\("popstate", handlePopState\)/);
  assert.match(productGrid, /runShopSearch\(nextPage, \{ history: "replace", state: nextState \}\)/);
});

test("responsive filters use a mobile drawer without horizontal overflow pressure", () => {
  assert.match(productGrid, /className="gdg-mobile-filter-button"/);
  assert.match(productGrid, /ref=\{filterSheetTriggerRef\}/);
  assert.match(productGrid, /aria-expanded=\{filterSheetOpen\}/);
  assert.match(productGrid, /ref=\{filterSheetCloseRef\}/);
  assert.match(productGrid, /event\.key === "Escape"/);
  assert.match(productGrid, /setFilterSheetOpen\(false\)/);
  assert.match(productGrid, /restoreTarget\?\.focus\(\)/);
  assert.match(productGrid, /document\.activeElement === first/);
  assert.match(productGrid, /document\.activeElement === last/);
  assert.match(productGrid, /className=\{`gdg-shop-filters \$\{filterSheetOpen \? "open" : ""\}`\}/);
  assert.match(productGrid, /className="gdg-filter-backdrop"/);
  assert.match(css, /\.gdg-mobile-filter-button\s*\{[\s\S]*?display: none;/);
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.gdg-mobile-filter-button\s*\{[\s\S]*?display: inline-flex;/);
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.gdg-filter-backdrop\s*\{[\s\S]*?position: fixed;/);
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.gdg-shop-filters\s*\{[\s\S]*?position: fixed;[\s\S]*?max-height: min\(86vh, 720px\);[\s\S]*?overflow-y: auto;/);
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.gdg-shop-filters\.open\s*\{[\s\S]*?transform: translateY\(0\);/);
  assert.match(css, /@media \(max-width: 1120px\)\s*\{[\s\S]*?\.gdg-shop-filters\s*\{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
});
