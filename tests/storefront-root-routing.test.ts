import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  GAMEDAYGRABS_CANONICAL_PUBLIC_URL,
  isBranchPreviewVercelHost,
  isGameDayGrabsHost,
  isPublicStorefrontPath,
  isRawProductionVercelHost,
  isRoutingBypassPath,
  safeStorefrontRedirectUrl
} from "../src/lib/storefront-routing";

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
  for (const pathname of ["/", "/shop", "/cart", "/product/pitch-black", "/collections/new-arrivals", "/policies/shipping", "/product-feed.xml", "/sitemap.xml", "/robots.txt"]) {
    assert.equal(isPublicStorefrontPath(pathname), true, `${pathname} should be a public storefront path`);
    assert.equal(isRoutingBypassPath(pathname), false, `${pathname} should not bypass storefront redirect handling`);
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
});

test("private root and customer-account routes remain noindexed", () => {
  const homePage = fs.readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const nextConfig = fs.readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");

  assert.match(homePage, /canonical: GAMEDAYGRABS_CANONICAL_ORIGIN/);
  assert.match(homePage, /robots:\s*\{\s*index: false,\s*follow: false\s*\}/);
  assert.match(nextConfig, /source: "\/account\/:path\*"/);
  assert.match(nextConfig, /X-Robots-Tag", value: "noindex, nofollow"/);
});

test("unsupported official or authorized retailer claims are absent from customer-facing root copy", () => {
  const radarApp = fs.readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const storefrontClient = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
  const publicCopy = `${radarApp}\n${storefrontClient}`;

  assert.match(publicCopy, /Trusted retailer source pages only/);
  assert.doesNotMatch(publicCopy, /Official retailer pages only|authorized Pok.mon retailer|approved retailer|certified retailer/i);
});
