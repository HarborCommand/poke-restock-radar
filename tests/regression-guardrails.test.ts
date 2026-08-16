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
  assert.match(shell, /gamedaygrabs-pos-square-pending-v1/);
  assert.match(shell, /Finish or cancel the current Square payment before leaving Checkout/);
  assert.match(shell, /url\.searchParams\.has\("data"\)/);
  assert.match(shell, /new KeyboardEvent\("keydown", \{ key: "Enter"/);
  assert.match(presentation, /\.pos-add-button/);
  assert.match(presentation, /dataset\.posCardTappable/);
  assert.match(presentation, /interactiveDescendant/);
  assert.doesNotMatch(presentation, /fetch\(|\/api\//);
  assert.match(overflowCss, /\.pos-cart-lines:not\(\.is-empty\)/);
  assert.match(overflowCss, /overflow-y: auto !important/);
  assert.match(overflowCss, /grid-template-columns: 48px minmax\(0, 1fr\) 108px 34px !important/);
  assert.match(overflowCss, /> \.pos-cart-line-copy/);
  assert.match(overflowCss, /> \.pos-cart-quantity/);
  assert.match(overflowCss, /> \.pos-line-total/);
  assert.match(overflowCss, /> \.icon-button\.small/);
  assert.match(overflowCss, /\.pos-customer-results/);
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
