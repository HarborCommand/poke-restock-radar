import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertSameOriginRequest, AuthOriginError } from "../src/lib/auth-origin";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("large frontend files stay below documented growth ceilings", () => {
  const limits = [
    { file: "src/components/RadarApp.tsx", maxBytes: 1_350_000 },
    { file: "src/app/globals.css", maxBytes: 700_000 }
  ];
  for (const limit of limits) {
    const bytes = statSync(path.join(root, limit.file)).size;
    assert.ok(bytes <= limit.maxBytes, `${limit.file} is ${bytes} bytes; split shared modules before exceeding ${limit.maxBytes}.`);
  }
});

test("customer workspace search debounces and aborts stale requests", () => {
  const source = readFileSync(path.join(root, "src/components/RadarApp.tsx"), "utf8");
  const panel = source.slice(source.indexOf("function CustomersRewardsPanel"), source.indexOf("function CustomerRewardKpi"));
  assert.match(source, /function useDebouncedValue<T>/);
  assert.match(panel, /useDebouncedValue\(search, 300\)/);
  assert.match(panel, /const effectiveSearch = submittedSearch === search \? submittedSearch : debouncedSearch/);
  assert.match(panel, /function handleSearchKeyDown|const handleSearchKeyDown/);
  assert.match(panel, /event\.key !== "Enter"/);
  assert.match(panel, /submitSearchNow\(event\.currentTarget\.value\)/);
  assert.match(panel, /customerRequestRef\.current\?\.abort\(\)/);
  assert.match(panel, /ledgerRequestRef\.current\?\.abort\(\)/);
  assert.match(panel, /signal: controller\.signal/);
  assert.match(panel, /requestWasAborted\(error\)/);
});

test("customer workspace tabs expose complete keyboard semantics", () => {
  const source = readFileSync(path.join(root, "src/components/RadarApp.tsx"), "utf8");
  const panel = source.slice(source.indexOf("function CustomersRewardsPanel"), source.indexOf("function CustomerRewardKpi"));
  assert.match(panel, /role="tablist"/);
  assert.match(panel, /role="tab"/);
  assert.match(panel, /aria-selected=\{activeView === view\}/);
  assert.match(panel, /role="tabpanel"/);
  assert.match(panel, /event\.key === "ArrowRight"/);
  assert.match(panel, /event\.key === "Home"/);
});

test("customer auth trusts a browser same-origin POST behind a reverse proxy", () => {
  const request = new Request("https://internal-deployment.vercel.app/api/account/magic-link/verify", {
    method: "POST",
    headers: {
      origin: "https://gamedaygrabs.com",
      "sec-fetch-site": "same-origin"
    }
  });

  assert.doesNotThrow(() => assertSameOriginRequest(request));
});

test("customer auth accepts the public forwarded origin behind Vercel when fetch metadata is unavailable", () => {
  const request = new Request("https://internal-deployment.vercel.app/api/account/magic-link/verify", {
    method: "POST",
    headers: {
      origin: "https://gamedaygrabs.com",
      "x-forwarded-host": "gamedaygrabs.com",
      "x-forwarded-proto": "https"
    }
  });

  assert.doesNotThrow(() => assertSameOriginRequest(request));
});

test("customer auth still rejects cross-site POSTs", () => {
  const request = new Request("https://internal-deployment.vercel.app/api/account/magic-link/verify", {
    method: "POST",
    headers: {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
      "x-forwarded-host": "gamedaygrabs.com",
      "x-forwarded-proto": "https"
    }
  });

  assert.throws(() => assertSameOriginRequest(request), AuthOriginError);
});

test("POS customer invitations open account creation instead of magic-link login", () => {
  const button = readFileSync(path.join(root, "src/app/pos/PosCustomerInviteButton.tsx"), "utf8");
  const route = readFileSync(path.join(root, "src/app/api/radar/pos/customer-invite/route.ts"), "utf8");

  assert.match(button, /\/api\/radar\/pos\/customer-invite/);
  assert.doesNotMatch(button, /\/api\/account\/magic-link\/request/);
  assert.match(route, /searchParams\.set\("mode", "create"\)/);
  assert.match(route, /subject: "Create your GameDayGrabs account"/);
  assert.doesNotMatch(route, /magic-link\/verify/);
});

test("POS Square card flow requires a verified completed Square payment", () => {
  const client = readFileSync(path.join(root, "src/app/pos/PosSquarePayment.tsx"), "utf8");
  const saleRoute = readFileSync(path.join(root, "src/app/api/radar/pos/sales/route.ts"), "utf8");
  const squareService = readFileSync(path.join(root, "src/lib/square-pos.ts"), "utf8");

  assert.match(client, /square-commerce-v1:\/\/payment\/create/);
  assert.match(client, /supported_tender_types: \["CREDIT_CARD"\]/);
  assert.match(client, /clear_default_fees: true/);
  assert.match(client, /auto_return: true/);
  assert.match(client, /skip_receipt: true/);
  assert.match(client, /setCartSignature/);
  assert.match(client, /cartSignature === pending\.cartSignature/);
  assert.match(client, /document\.addEventListener\("input", schedule, true\)/);
  assert.doesNotMatch(client, /SQUARE_ACCESS_TOKEN/);
  assert.match(saleRoute, /input\.paymentMethod === "external_card"/);
  assert.match(saleRoute, /verifySquarePosPayment/);
  assert.match(saleRoute, /paymentReference: squareReference/);
  assert.match(saleRoute, /existingSquareUse/);
  assert.match(saleRoute, /existingSquareUse\.saleReference !== intendedSaleReference/);
  assert.match(squareService, /\/v2\/orders\//);
  assert.match(squareService, /\/v2\/payments\//);
  assert.match(squareService, /payment\.status !== "COMPLETED"/);
  assert.match(squareService, /amountCents !== expectedAmountCents/);
  assert.match(squareService, /payment\.location_id !== config\.locationId/);
});

test("private admin entry keeps inventory location controls mounted for admins", () => {
  const entry = readFileSync(path.join(root, "src/components/PrivateRadarAppEntry.tsx"), "utf8");
  assert.match(entry, /AdminInventoryLocationTools/);
  assert.match(entry, /String\(user\.role\) === "ADMIN" \? <AdminInventoryLocationTools \/>/);
});

test("POS register shell preserves checkout safeguards and keeps browse views read-only", () => {
  const shell = readFileSync(path.join(root, "src/app/pos/PosRegisterShell.tsx"), "utf8");
  const layout = readFileSync(path.join(root, "src/app/pos/layout.tsx"), "utf8");
  const presentation = readFileSync(path.join(root, "src/app/pos/PosCheckoutPresentation.tsx"), "utf8");
  const overflowCss = readFileSync(path.join(root, "src/app/pos/pos-ipad-cart-overflow.module.css"), "utf8");
  const historyRoute = readFileSync(path.join(root, "src/app/api/radar/pos/history/route.ts"), "utf8");
  const productsRoute = readFileSync(path.join(root, "src/app/api/radar/pos/products/route.ts"), "utf8");

  assert.match(layout, /<PosRegisterShell>\{children\}<\/PosRegisterShell>/);
  assert.match(layout, /<PosCheckoutPresentation \/>/);
  assert.match(layout, /pos-square-register\.module\.css/);
  assert.match(layout, /pos-ipad-cart-overflow\.module\.css/);
  assert.match(layout, /overflowStyles\.cartOverflowFix/);
  assert.match(shell, /"checkout".*"products".*"customers".*"sales"/s);
  assert.match(shell, /data-pos-authenticated=\{user \? "true" : "false"\}/);
  assert.match(shell, /data-pos-checkout-host=\{user \? "true" : undefined\}/);
  assert.match(shell, /data-pos-square-flow-mode=\{user && view === "checkout" \? "sale" : undefined\}/);
  assert.match(shell, /gamedaygrabs-pos-square-pending-v1/);
  assert.match(shell, /Finish or cancel the current Square payment before leaving Checkout/);
  assert.match(shell, /url\.searchParams\.has\("data"\)/);
  assert.match(shell, /new KeyboardEvent\("keydown", \{ key: "Enter"/);
  assert.match(presentation, /\.pos-add-button/);
  assert.match(presentation, /dataset\.posCardTappable/);
  assert.match(presentation, /interactiveDescendant/);
  assert.match(presentation, /querySelectorAll\("\.pos-cart-lines > \.pos-cart-line"\)\.length/);
  assert.doesNotMatch(presentation, /cartCountFromHeading/);
  assert.doesNotMatch(presentation, /fetch\(|\/api\//);
  assert.match(overflowCss, /\.pos-cart-panel\)[\s\S]*display: flex !important/);
  assert.match(overflowCss, /\.pos-cart-panel\)[\s\S]*overflow: hidden !important/);
  assert.match(overflowCss, /\.pos-cart-lines:not\(\.is-empty\)[\s\S]*flex: 1 1 auto !important/);
  assert.match(overflowCss, /\.pos-cart-lines:not\(\.is-empty\)[\s\S]*overflow-y: auto !important/);
  assert.doesNotMatch(overflowCss, /Current Sale uses ONE vertical scroll surface/);
  assert.doesNotMatch(overflowCss, /\.pos-cart-lines:not\(\.is-empty\)[\s\S]*overflow: visible !important/);
  assert.match(overflowCss, /grid-template-columns: 48px minmax\(0, 1fr\) 108px 34px !important/);
  assert.match(overflowCss, /> \.pos-cart-line-copy/);
  assert.match(overflowCss, /> \.pos-cart-quantity/);
  assert.match(overflowCss, /> \.pos-line-total/);
  assert.match(overflowCss, /> \.icon-button\.small/);
  assert.match(overflowCss, /\.pos-customer-results/);
  assert.match(overflowCss, /\.pos-cart-header[\s\S]*position: relative !important/);
  assert.match(overflowCss, /\.pos-search-panel[\s\S]*overflow: hidden !important/);
  assert.match(overflowCss, /\.pos-result-grid[\s\S]*overflow-y: auto !important/);
  assert.match(overflowCss, /-webkit-overflow-scrolling: touch/);
  assert.match(historyRoute, /export async function GET\(\)/);
  assert.doesNotMatch(historyRoute, /export async function POST/);
  assert.match(historyRoute, /platform: "pos"/);
  assert.match(productsRoute, /listInventoryPhysicalLocationBalances/);
  assert.match(productsRoute, /inStoreQuantity/);
  assert.match(productsRoute, /isPosSellableInventoryItem/);
  assert.match(productsRoute, /quantityOwned: balance\.inStoreQuantity/);
  assert.doesNotMatch(productsRoute, /averageCost|profitLoss|costBasis/);
  assert.equal(existsSync(path.join(root, "src/app/pos-review/page.tsx")), false);
});

test("POS Square-style flow keeps Charge reachable and separates customer/payment screens", () => {
  const layout = readFileSync(path.join(root, "src/app/pos/layout.tsx"), "utf8");
  const flow = readFileSync(path.join(root, "src/app/pos/PosSquareLikeFlow.tsx"), "utf8");
  const flowCss = readFileSync(path.join(root, "src/app/pos/PosSquareLikeFlow.module.css"), "utf8");
  const page = readFileSync(path.join(root, "src/app/pos/page.tsx"), "utf8");
  const nextConfig = readFileSync(path.join(root, "next.config.mjs"), "utf8");
  const pwaGuard = readFileSync(path.join(root, "src/app/pos/PosPwaCacheGuard.tsx"), "utf8");
  const serviceWorker = readFileSync(path.join(root, "public/sw.js"), "utf8");
  const posManifest = readFileSync(path.join(root, "public/manifest-pos.webmanifest"), "utf8");
  const posViewportQa = readFileSync(path.join(root, "scripts/pos-viewport-qa.ts"), "utf8");
  const storeModeCss = readFileSync(path.join(root, "src/app/pos/pos-store-mode.module.css"), "utf8");
  const saleViewportGuard = readFileSync(path.join(root, "src/app/pos/PosSaleViewportGuard.tsx"), "utf8");
  const saleViewportGuardCss = readFileSync(path.join(root, "src/app/pos/pos-sale-viewport-guard.module.css"), "utf8");
  const posViewport = readFileSync(path.join(root, "src/app/pos/posViewport.ts"), "utf8");

  assert.match(layout, /<PosSquareLikeFlow \/>/);
  assert.match(layout, /<PosPwaCacheGuard \/>/);
  assert.match(page, /data-pos-store-mode="true"/);
  assert.match(nextConfig, /source: "\/sw\.js"/);
  assert.match(nextConfig, /Service-Worker-Allowed/);
  assert.match(nextConfig, /source: "\/manifest-pos\.webmanifest"/);
  assert.match(layout, /"apple-mobile-web-app-capable": "yes"/);
  assert.match(posManifest, /"start_url": "\/pos\?source=pos-pwa"/);
  assert.match(posManifest, /"scope": "\/pos"/);
  assert.match(posManifest, /"display_override": \["standalone"\]/);
  assert.match(nextConfig, /source: "\/pos"/);
  assert.match(nextConfig, /source: "\/pos\/:path\*"/);
  assert.match(nextConfig, /private, no-store, no-cache/);
  assert.match(serviceWorker, /posShouldBypassCache/);
  assert.match(serviceWorker, /fetchFresh\(request, request\.mode === "navigate" \? "\/offline\.html" : null\)/);
  assert.match(serviceWorker, /poke-radar-sw-2026-08-29-pos-install-v10/);
  assert.match(serviceWorker, /refreshPosClients/);
  assert.match(serviceWorker, /client\.navigate\(url\.toString\(\)\)/);
  assert.match(pwaGuard, /display-mode: standalone/);
  assert.match(pwaGuard, /CLEAR_APP_CACHE/);
  assert.match(pwaGuard, /storageSet\(window\.localStorage, POS_PWA_CACHE_VERSION_KEY, version\)/);
  assert.match(pwaGuard, /window\.location\.replace/);
  assert.match(pwaGuard, /posPwaRefresh/);
  assert.match(posViewportQa, /\/pos\?source=pos-pwa/);
  assert.match(posViewportQa, /body\.position === "fixed"/);
  assert.doesNotMatch(posViewportQa, /expected fixed/);
  assert.match(posViewport, /export function getUsableViewportHeight/);
  assert.match(posViewport, /export function getUsableViewportWidth/);
  assert.match(posViewport, /export function isPosHomeScreenMode/);
  assert.match(posViewport, /Math\.min\(\.\.\.availableHeights\)/);
  assert.match(posViewport, /Math\.min\(\.\.\.availableWidths\)/);
  assert.doesNotMatch(posViewport, /Math\.max\(window\.innerHeight/);
  assert.match(saleViewportGuard, /function viewportHeight/);
  assert.match(saleViewportGuard, /getUsableViewportHeight/);
  assert.doesNotMatch(saleViewportGuard, /function isHomeScreenMode/);
  assert.doesNotMatch(saleViewportGuard, /Math\.max\(window\.innerHeight, viewport\.height\)/);
  assert.doesNotMatch(saleViewportGuard, /viewport\.offsetTop \+ viewport\.height/);
  assert.match(flow, /data\.posSquareFlowMode = mode/);
  assert.match(flow, /useLayoutEffect/);
  assert.match(flow, /getUsableViewportHeight/);
  assert.match(flow, /getUsableViewportWidth/);
  assert.match(flow, /setMode\("payment"\)/);
  assert.match(flow, /setMode\("customer"\)/);
  assert.match(flow, /hasActiveSquarePending/);
  assert.match(flow, /url\.searchParams\.has\("data"\)/);
  assert.match(flow, /elementIsCheckoutVisible/);
  assert.match(flow, /floatingDockStyleForCartPanel/);
  assert.match(flow, /"--pos-checkout-dock-left"/);
  assert.match(flow, /"--pos-checkout-dock-right"/);
  assert.match(flow, /"--pos-checkout-dock-width"/);
  assert.match(flow, /style=\{floatingActionStyle\}/);
  assert.doesNotMatch(flow, /aria-label="Pinned checkout action"/);
  assert.match(flow, /aria-label="Pinned complete sale action"/);
  assert.match(flow, /completeButtonIsDisabled/);
  assert.match(flowCss, /data-pos-square-flow-mode="sale"[\s\S]*\.pos-cart-panel[\s\S]*overflow: hidden !important/);
  assert.match(flowCss, /data-pos-square-flow-mode="sale"[\s\S]*\.pos-cart-lines[\s\S]*overflow-y: auto !important/);
  assert.match(flowCss, /\.chargeBar[\s\S]*position: sticky/);
  assert.match(flowCss, /\.chargeBar[\s\S]*bottom: 0/);
  assert.match(flowCss, /data-pos-square-flow-mode="sale"[\s\S]*\.pos-payment-panel[\s\S]*display: none !important/);
  assert.match(flowCss, /data-pos-square-flow-mode="payment"[\s\S]*\.pos-payment-panel[\s\S]*display: block !important/);
  assert.match(flowCss, /data-pos-square-flow-mode="payment"[\s\S]*\.pos-complete-button[\s\S]*position: sticky !important/);
  assert.match(flowCss, /data-pos-square-flow-mode="customer"[\s\S]*\.pos-customer-panel[\s\S]*display: block !important/);
  assert.match(flowCss, /\.floatingActionDock[\s\S]*position: fixed/);
  assert.match(flowCss, /\.floatingActionDock[\s\S]*bottom: max\(32px, calc\(env\(safe-area-inset-bottom\) \+ 24px\)\)/);
  assert.match(saleViewportGuardCss, /\.pos-search-panel\)[\s\S]*display: flex !important/);
  assert.match(saleViewportGuardCss, /\.saleViewportGuard \{[\s\S]*height: var\(--pos-visible-height, 100dvh\)/);
  assert.match(saleViewportGuardCss, /\.saleViewportGuard \{[\s\S]*overflow: hidden/);
  assert.match(saleViewportGuardCss, /body\[data-pos-viewport-locked="true"\]\)[\s\S]*position: static !important/);
  assert.doesNotMatch(saleViewportGuardCss, /body\[data-pos-viewport-locked="true"\]\)[\s\S]*position: fixed !important/);
  assert.match(saleViewportGuardCss, /body\[data-pos-viewport-locked="true"\]\[data-pos-home-screen="true"\]\)[\s\S]*position: static !important/);
  assert.match(saleViewportGuardCss, /\.pos-result-grid\)[\s\S]*overflow-y: auto !important/);
  assert.match(saleViewportGuardCss, /\.pos-cart-panel\)[\s\S]*overflow: hidden !important/);
  assert.match(saleViewportGuardCss, /\[data-pos-register-view="checkout"\]\[data-pos-authenticated="true"\]\)[\s\S]*overflow: hidden !important/);
  assert.match(saleViewportGuardCss, /\[data-pos-checkout-host="true"\][\s\S]*overflow: hidden !important/);
  assert.match(saleViewportGuardCss, /\[data-pos-store-mode="true"\][\s\S]*overflow: hidden !important/);
  assert.match(saleViewportGuardCss, /\.pos-cart-lines:not\(\.is-empty\)[\s\S]*flex: 1 1 auto !important/);
  assert.match(saleViewportGuardCss, /\.pos-cart-lines:not\(\.is-empty\)[\s\S]*overflow-y: auto !important/);
  assert.match(saleViewportGuardCss, /\.pos-cart-panel > \[aria-label="Checkout action"\][\s\S]*position: sticky !important/);
  assert.match(saleViewportGuardCss, /\.pos-cart-panel > \[aria-label="Checkout action"\][\s\S]*bottom: 0 !important/);
  assert.match(saleViewportGuardCss, /\.pos-cart-panel > \[aria-label="Checkout action"\][\s\S]*width: 100% !important/);
  assert.doesNotMatch(saleViewportGuardCss, /\.pos-cart-panel > \[aria-label="Checkout action"\][\s\S]*position: fixed !important/);
  assert.match(saleViewportGuardCss, /@media \(min-width: 740px\) and \(max-width: 999px\)[\s\S]*\.pos-workspace\)[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(320px, 0\.82fr\) !important/);
  assert.match(saleViewportGuardCss, /@media \(max-width: 739px\)[\s\S]*\.pos-workspace\)[\s\S]*grid-template-rows: minmax\(0, 1fr\) minmax\(300px, 46%\) !important/);
  assert.match(saleViewportGuardCss, /\.pos-cart-line\)[\s\S]*grid-template-rows: minmax\(52px, auto\) minmax\(64px, auto\) auto !important/);
  assert.match(saleViewportGuardCss, /\.pos-cart-line\)[\s\S]*overflow: visible !important/);
  assert.match(saleViewportGuardCss, /\.pos-cart-line > \.pos-cart-line-copy\)[\s\S]*overflow: visible !important/);
  assert.match(saleViewportGuard, /const WORKSPACE_VARIABLE = "--pos-sale-workspace-height"/);
  assert.match(saleViewportGuard, /const ROOT_VARIABLE = "--pos-sale-root-height"/);
  assert.match(saleViewportGuard, /const BOTTOM_GAP = 64/);
  assert.match(saleViewportGuard, /workspace\.style\.setProperty\(WORKSPACE_VARIABLE/);
  assert.match(saleViewportGuardCss, /Last-word iPad app frame/);
  assert.match(saleViewportGuardCss, /height: var\(--pos-sale-workspace-height, 100%\) !important/);
  assert.match(storeModeCss, /\.storeMode[\s\S]*height: 100%/);
  assert.match(storeModeCss, /\.storeMode :global\(\.app-main\)[\s\S]*overflow: hidden !important/);
  assert.match(storeModeCss, /\.storeMode :global\(\.pos-cart-panel\)[\s\S]*position: relative !important/);
  assert.doesNotMatch(storeModeCss, /\.storeMode :global\(\.pos-cart-panel\)[\s\S]*position: sticky !important/);
});

test("core safety regression suites remain part of the default test command", () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts.test ?? "", /tests\/\*\.test/);
  assert.equal(packageJson.scripts["test:guardrails"], "tsx --test tests/regression-guardrails.test.ts");
});

test("production configuration contains no automatic Vercel jobs", () => {
  const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8")) as {
    crons?: unknown[];
  };

  assert.ok(
    !Array.isArray(vercel.crons) || vercel.crons.length === 0,
    "Do not add automatic Vercel cron jobs: they can wake Neon and create charges while the app is unused."
  );
});

test("production deploys guard against wrong or empty storefront databases", () => {
  const build = readFileSync(path.join(root, "scripts/vercel-build.ts"), "utf8");
  const databaseGuard = readFileSync(path.join(root, "src/lib/production-database-guard.ts"), "utf8");
  const storefrontDataGuard = readFileSync(path.join(root, "src/lib/production-storefront-data-guard.ts"), "utf8");
  const storefrontDataScript = readFileSync(path.join(root, "scripts/guard-production-storefront-data.ts"), "utf8");

  assert.match(build, /scripts\/guard-production-database\.ts/);
  assert.match(build, /scripts\/guard-production-storefront-data\.ts/);
  assert.match(databaseGuard, /quickz/i);
  assert.match(databaseGuard, /harbor\[_-\]\?command/i);
  assert.match(storefrontDataGuard, /No public storefront products exist/);
  assert.match(storefrontDataGuard, /No Admin users exist/);
  assert.match(storefrontDataScript, /poke_restock_radar_prod/);
  assert.match(storefrontDataScript, /unrelated apps, preview, QA, or empty databases/);
});
