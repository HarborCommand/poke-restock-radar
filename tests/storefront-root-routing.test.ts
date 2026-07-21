import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";

import { proxy } from "../src/proxy";
import {
  GAMEDAYGRABS_CANONICAL_PUBLIC_URL,
  POKE_RESTOCK_RADAR_PRODUCTION_URL,
  isBranchPreviewVercelHost,
  isGameDayGrabsHost,
  isPublicStorefrontPath,
  isRawProductionVercelHost,
  isRoutingBypassPath,
  safeStorefrontRedirectUrl
} from "../src/lib/storefront-routing";

function proxyGet(url: string) {
  return proxy(new NextRequest(url, { method: "GET", headers: { host: new URL(url).host } }));
}

test("root routing distinguishes custom storefront, raw production, and branch preview hosts", () => {
  assert.equal(isGameDayGrabsHost("gamedaygrabs.com"), true);
  assert.equal(isGameDayGrabsHost("www.gamedaygrabs.com"), true);
  assert.equal(isGameDayGrabsHost("poke-restock-radar.vercel.app"), false);

  assert.equal(isRawProductionVercelHost("poke-restock-radar.vercel.app"), true);
  assert.equal(isRawProductionVercelHost("poke-restock-radar-git-feature-harbor-commands-projects.vercel.app"), false);
  assert.equal(isBranchPreviewVercelHost("poke-restock-radar-git-feature-harbor-commands-projects.vercel.app"), true);
  assert.equal(isBranchPreviewVercelHost("poke-restock-radar.vercel.app"), false);
});

test("raw production redirect scope covers storefront paths but bypasses API, assets, and auth callbacks", () => {
  for (const pathname of [
    "/shop",
    "/cart",
    "/about",
    "/contact",
    "/policies",
    "/privacy",
    "/terms",
    "/product/pitch-black",
    "/shop/product/pitch-black",
    "/collections/new-arrivals",
    "/policies/shipping",
    "/product-feed.xml",
    "/sitemap.xml",
    "/robots.txt"
  ]) {
    assert.equal(isPublicStorefrontPath(pathname), true, `${pathname} should be a public storefront path`);
    assert.equal(isRoutingBypassPath(pathname), false, `${pathname} should not bypass storefront redirect handling`);
  }

  for (const pathname of ["/", "/app", "/dashboard", "/login"]) {
    assert.equal(isPublicStorefrontPath(pathname), false, `${pathname} should stay private on the raw production host`);
    assert.equal(isRoutingBypassPath(pathname), false, `${pathname} should still use normal private app routing`);
  }

  for (const pathname of ["/api/health", "/api/storefront/cart", "/_next/static/chunk.js", "/auth/callback", "/account/login", "/brand/gamedaygrabs-logo-horizontal.png"]) {
    assert.equal(isRoutingBypassPath(pathname), true, `${pathname} should bypass storefront redirect handling`);
  }
});

test("storefront redirect preserves only safe public query parameters", () => {
  const params = new URLSearchParams({
    q: "booster",
    category: "blisters",
    sort: "price_asc",
    token: "secret",
    code: "oauth-code",
    callbackUrl: "/admin",
    payment_intent_client_secret: "pi_secret",
    utm_source: "email"
  });

  const redirectUrl = safeStorefrontRedirectUrl("/shop", params);

  assert.equal(redirectUrl.origin, GAMEDAYGRABS_CANONICAL_PUBLIC_URL);
  assert.equal(redirectUrl.pathname, "/shop");
  assert.equal(redirectUrl.searchParams.get("q"), "booster");
  assert.equal(redirectUrl.searchParams.get("category"), "blisters");
  assert.equal(redirectUrl.searchParams.get("sort"), "price_asc");
  assert.equal(redirectUrl.searchParams.get("utm_source"), "email");
  assert.equal(redirectUrl.searchParams.has("token"), false);
  assert.equal(redirectUrl.searchParams.has("code"), false);
  assert.equal(redirectUrl.searchParams.has("callbackUrl"), false);
  assert.equal(redirectUrl.searchParams.has("payment_intent_client_secret"), false);
});

test("proxy keeps exact-host redirects narrow and noindexes redirected raw production responses", () => {
  const proxy = fs.readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");

  assert.match(proxy, /isRawProductionVercelHost\(request\.headers\.get\("host"\)\)/);
  assert.match(proxy, /isPublicStorefrontPath\(request\.nextUrl\.pathname\)/);
  assert.match(proxy, /isRoutingBypassPath\(request\.nextUrl\.pathname\)/);
  assert.match(proxy, /NextResponse\.redirect\(safeStorefrontRedirectUrl\(request\.nextUrl\.pathname, request\.nextUrl\.searchParams\), 308\)/);
  assert.match(proxy, /response\.headers\.set\("X-Robots-Tag", "noindex, nofollow"\)/);
  assert.doesNotMatch(proxy, /\.endsWith\("\\.vercel\.app"\).*redirect/s);
  assert.doesNotMatch(proxy, /isBranchPreviewVercelHost[\s\S]*NextResponse\.redirect/);
  assert.doesNotMatch(proxy, /request\.nextUrl\.pathname === "\/"[\s\S]*NextResponse\.redirect/);
});

test("proxy redirects raw production storefront paths without taking over private root or previews", () => {
  const rawShop = proxyGet("https://poke-restock-radar.vercel.app/shop?q=booster&token=secret&utm_source=email");
  assert.equal(rawShop.status, 308);
  assert.equal(rawShop.headers.get("location"), "https://www.gamedaygrabs.com/shop?q=booster&utm_source=email");
  assert.equal(rawShop.headers.get("X-Robots-Tag"), "noindex, nofollow");

  const rawRoot = proxyGet("https://poke-restock-radar.vercel.app/");
  assert.notEqual(rawRoot.status, 308);
  assert.equal(rawRoot.headers.get("location"), null);

  for (const path of ["/app", "/dashboard", "/login"]) {
    const response = proxyGet(`https://poke-restock-radar.vercel.app${path}`);
    assert.notEqual(response.status, 308, `${path} should not redirect away from the raw private host`);
    assert.equal(response.headers.get("location"), null);
  }

  const branchPreview = proxyGet("https://poke-restock-radar-git-feature-harbor-commands-projects.vercel.app/shop");
  assert.notEqual(branchPreview.status, 308);
  assert.equal(branchPreview.headers.get("location"), null);

  const canonicalStorefront = proxyGet("https://www.gamedaygrabs.com/shop");
  assert.notEqual(canonicalStorefront.status, 308);
  assert.equal(canonicalStorefront.headers.get("location"), null);
});

test("private root, aliases, and customer-account routes remain noindexed", () => {
  const homePage = fs.readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const appPage = fs.readFileSync(new URL("../src/app/app/page.tsx", import.meta.url), "utf8");
  const dashboardPage = fs.readFileSync(new URL("../src/app/dashboard/page.tsx", import.meta.url), "utf8");
  const loginPage = fs.readFileSync(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
  const privateEntry = fs.readFileSync(new URL("../src/components/PrivateRadarAppEntry.tsx", import.meta.url), "utf8");
  const nextConfig = fs.readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");

  assert.match(homePage, /canonical: GAMEDAYGRABS_CANONICAL_ORIGIN/);
  assert.match(homePage, /robots:\s*\{\s*index: false,\s*follow: false\s*\}/);
  assert.match(homePage, /<PrivateRadarAppEntry \/>/);
  for (const source of [appPage, dashboardPage, loginPage]) {
    assert.match(source, /PrivateRadarAppEntry/);
    assert.match(source, /robots:\s*\{\s*index: false,\s*follow: false\s*\}/);
  }
  assert.match(privateEntry, /isGameDayGrabsHost\(host\)/);
  assert.match(privateEntry, /redirect\(POKE_RESTOCK_RADAR_PRODUCTION_URL\)/);
  assert.match(privateEntry, /<RadarApp \/>/);
  assert.equal(POKE_RESTOCK_RADAR_PRODUCTION_URL, "https://poke-restock-radar.vercel.app");
  assert.match(nextConfig, /source: "\/account\/:path\*"/);
  for (const source of ['source: "/app"', 'source: "/dashboard"', 'source: "/login"']) {
    assert.match(nextConfig, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(nextConfig, /X-Robots-Tag", value: "noindex, nofollow"/);
});

test("public discovery documents stay canonical and exclude raw private admin URLs", () => {
  const sitemap = fs.readFileSync(new URL("../src/app/sitemap.ts", import.meta.url), "utf8");
  const productFeed = fs.readFileSync(new URL("../src/lib/storefront-product-feed.ts", import.meta.url), "utf8");
  const robots = fs.readFileSync(new URL("../src/app/robots.ts", import.meta.url), "utf8");

  assert.match(sitemap, /GAMEDAYGRABS_CANONICAL_ORIGIN/);
  assert.match(productFeed, /GAMEDAYGRABS_CANONICAL_ORIGIN|productCanonicalUrl/);
  assert.match(robots, /GAMEDAYGRABS_CANONICAL_ORIGIN/);
  for (const source of [sitemap, productFeed]) {
    assert.doesNotMatch(source, /poke-restock-radar\.vercel\.app/);
    assert.doesNotMatch(source, /\/app|\/dashboard|\/login/);
  }
  assert.doesNotMatch(robots, /poke-restock-radar\.vercel\.app/);
  assert.match(robots, /"\/app"/);
  assert.match(robots, /"\/dashboard"/);
  assert.match(robots, /"\/login"/);
});

test("unsupported official or authorized retailer claims are absent from customer-facing root copy", () => {
  const radarApp = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const storefrontClient = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const publicCopy = `${radarApp}\n${storefrontClient}`;

  assert.match(publicCopy, /Trusted retailer source pages only/);
  assert.doesNotMatch(publicCopy, /Official retailer pages only|authorized Pok.mon retailer|approved retailer|certified retailer/i);
});
