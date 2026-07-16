import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import ts from "typescript";
import { authorizeAdminMutation } from "../src/lib/admin-authorization";
import { validateDiscoverySourceUrl } from "../src/lib/product-discovery";
import { proxy } from "../src/proxy";
import { POST as monitorCronPost } from "../src/app/api/radar/monitor/cron/route";
import { POST as expireReservationsPost } from "../src/app/api/radar/storefront/reservations/expire/route";
import {
  backupImportSchema,
  inventoryProductImageCreateSchema,
  inventorySaleCreateSchema,
  orderFulfillmentUpdateSchema,
  posCustomerMatchSchema,
  posSaleCreateSchema,
  posSaleRefundSchema,
  posTaxQuoteSchema,
  productCreateSchema,
  releaseCreateSchema,
  rewardAdminAdjustmentSchema,
  shippingProfileCreateSchema,
  storeCreateSchema,
  storefrontOrderCancelRefundSchema
} from "../src/lib/validation";
import type { SessionUser } from "../src/types/radar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function user(role: "ADMIN" | "FRIEND") {
  return {
    id: `${role.toLowerCase()}-user`,
    email: `${role.toLowerCase()}@example.test`,
    name: role,
    role,
    sessionVersion: 1
  } as SessionUser;
}

test("admin mutation guard rejects non-admin sessions", async () => {
  const response = authorizeAdminMutation(new Request("https://admin.example.test/api/radar/inventory", { method: "POST" }), user("FRIEND"));
  assert.equal(response?.status, 403);
  assert.deepEqual(await response?.json(), { error: "Admin access required" });
});

test("admin mutation guard rejects cross-site browser requests", async () => {
  const response = authorizeAdminMutation(
    new Request("https://admin.example.test/api/radar/inventory", {
      method: "POST",
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }
    }),
    user("ADMIN")
  );
  assert.equal(response?.status, 403);
  assert.match(response?.headers.get("cache-control") ?? "", /no-store/);
});

test("admin mutation guard rejects requests without browser origin evidence", async () => {
  const response = authorizeAdminMutation(
    new Request("https://admin.example.test/api/radar/inventory", { method: "POST" }),
    user("ADMIN")
  );
  assert.equal(response?.status, 403);
});

test("admin mutation guard accepts an admin same-origin request", () => {
  const response = authorizeAdminMutation(
    new Request("https://admin.example.test/api/radar/inventory", {
      method: "POST",
      headers: { origin: "https://admin.example.test", "sec-fetch-site": "same-origin" }
    }),
    user("ADMIN")
  );
  assert.equal(response, null);
});

test("radar proxy rejects missing or cross-site origin evidence and allows same-origin requests", () => {
  const unauthenticated = proxy(new NextRequest("https://admin.example.test/api/radar/products", { method: "POST" }));
  assert.equal(unauthenticated.headers.get("x-middleware-next"), "1");

  const missing = proxy(new NextRequest("https://admin.example.test/api/radar/products", {
    method: "POST",
    headers: { cookie: "poke_radar_session=test-session" }
  }));
  assert.equal(missing.status, 403);

  const crossSite = proxy(new NextRequest("https://admin.example.test/api/radar/products", {
    method: "POST",
    headers: { cookie: "poke_radar_session=test-session", origin: "https://attacker.example", "sec-fetch-site": "cross-site" }
  }));
  assert.equal(crossSite.status, 403);

  const sameOrigin = proxy(new NextRequest("https://admin.example.test/api/radar/products", {
    method: "POST",
    headers: { cookie: "poke_radar_session=test-session", origin: "https://admin.example.test", "sec-fetch-site": "same-origin" }
  }));
  assert.equal(sameOrigin.headers.get("x-middleware-next"), "1");
});

test("signed job routes bypass browser origin checks but reject unsigned calls", async () => {
  const monitorProxy = proxy(new NextRequest("https://admin.example.test/api/radar/monitor/cron", { method: "POST" }));
  const reservationProxy = proxy(new NextRequest("https://admin.example.test/api/radar/storefront/reservations/expire", { method: "POST" }));
  assert.equal(monitorProxy.headers.get("x-middleware-next"), "1");
  assert.equal(reservationProxy.headers.get("x-middleware-next"), "1");

  const previousMonitorSecret = process.env.MONITOR_JOB_SECRET;
  const previousCronSecret = process.env.CRON_SECRET;
  delete process.env.MONITOR_JOB_SECRET;
  delete process.env.CRON_SECRET;
  try {
    assert.equal((await monitorCronPost(new Request("https://admin.example.test/api/radar/monitor/cron", { method: "POST" }))).status, 401);
    assert.equal((await expireReservationsPost(new Request("https://admin.example.test/api/radar/storefront/reservations/expire", { method: "POST" }))).status, 401);
  } finally {
    if (previousMonitorSecret === undefined) delete process.env.MONITOR_JOB_SECRET;
    else process.env.MONITOR_JOB_SECRET = previousMonitorSecret;
    if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCronSecret;
  }
});

test("dangerous request schemas reject unknown fields", () => {
  const cases = [
    () => inventorySaleCreateSchema.parse({ quantitySold: 1, actualSalePrice: 10, unexpectedRole: "ADMIN" }),
    () => posSaleCreateSchema.parse({ idempotencyKey: "pos-test-123", items: [{ inventoryItemId: "item-1", quantity: 1 }], paymentMethod: "cash", rewardPoints: 999 }),
    () => posSaleRefundSchema.parse({ idempotencyKey: "refund-test-123", reason: "customer_return", customerAccountId: "other" }),
    () => posTaxQuoteSchema.parse({ items: [{ inventoryItemId: "item-1", quantity: 1 }], clientTax: 999 }),
    () => rewardAdminAdjustmentSchema.parse({ customerAccountId: "customer-1", action: "add", points: 10, reason: "Test adjustment", idempotencyKey: "adjust-test-123", availablePoints: 999 }),
    () => storefrontOrderCancelRefundSchema.parse({ reason: "customer_requested", refundType: "none", returnItemsToStock: false, sendCustomerEmail: false, idempotencyKey: "cancel-test-123", amount: 999 }),
    () => orderFulfillmentUpdateSchema.parse({ status: "paid", customerAccountId: "other" })
  ];
  for (const parse of cases) assert.throws(parse, /Unrecognized key/);
});

test("previously omitted admin route schemas reject privilege-bearing extras", () => {
  const cases = [
    () => productCreateSchema.parse({ name: "Test product", retailerId: "retailer-1", url: "https://example.test/product", role: "ADMIN" }),
    () => storeCreateSchema.parse({ retailerId: "retailer-1", storeName: "Test store", address: "1 Main St", city: "Miami", state: "FL", typicalRestockDays: "Friday", typicalRestockTimeWindow: "Morning", role: "ADMIN" }),
    () => releaseCreateSchema.parse({ setName: "Test set", productTypes: "ETB", role: "ADMIN" }),
    () => shippingProfileCreateSchema.parse({ name: "Box", packageType: "box", defaultWeightOz: 16, role: "ADMIN" }),
    () => inventoryProductImageCreateSchema.parse({ url: "https://example.test/image.png", customerAccountId: "other" }),
    () => posCustomerMatchSchema.parse({ customerEmail: "customer@example.test", rewardPoints: 500 })
  ];
  for (const parse of cases) assert.throws(parse, /Unrecognized key/);
});

test("backup import is bounded, explicit, and excludes credential-bearing tables", () => {
  assert.throws(() => backupImportSchema.parse({ version: 1, tables: {} }), /confirm/);
  assert.throws(
    () => backupImportSchema.parse({ version: 1, confirm: "RESTORE_OPERATIONAL_DATA", tables: { users: [] } }),
    /Unrecognized key/
  );
  assert.doesNotThrow(() => backupImportSchema.parse({ version: 1, confirm: "RESTORE_OPERATIONAL_DATA", tables: { products: [] } }));
});

test("discovery URL validation rejects lookalike hosts and non-HTTPS URLs", () => {
  assert.doesNotThrow(() => validateDiscoverySourceUrl("Target", "https://www.target.com/s/pokemon"));
  assert.throws(() => validateDiscoverySourceUrl("Target", "https://eviltarget.com/s/pokemon"), /public website/);
  assert.throws(() => validateDiscoverySourceUrl("Target", "http://target.com/s/pokemon"), /public website/);
});

test("dangerous routes enforce the centralized mutation guard", () => {
  const routes = [
    "src/app/api/radar/inventory/route.ts",
    "src/app/api/radar/inventory/[itemId]/route.ts",
    "src/app/api/radar/inventory/[itemId]/sales/route.ts",
    "src/app/api/radar/inventory/[itemId]/sales/[saleId]/route.ts",
    "src/app/api/radar/inventory/[itemId]/stock-lots/[lotId]/route.ts",
    "src/app/api/radar/inventory/[itemId]/store-listing/route.ts",
    "src/app/api/radar/inventory/import/route.ts",
    "src/app/api/radar/inventory/store-listing/bulk/route.ts",
    "src/app/api/radar/inventory/tcgcsv/matches/[itemId]/route.ts",
    "src/app/api/radar/inventory/tcgcsv/sync/route.ts",
    "src/app/api/radar/pos/tax-quote/route.ts",
    "src/app/api/radar/pos/sales/route.ts",
    "src/app/api/radar/pos/sales/[saleReference]/refund/route.ts",
    "src/app/api/radar/rewards/adjustments/route.ts",
    "src/app/api/radar/customers/[customerAccountId]/route.ts",
    "src/app/api/auth/admin/account/route.ts",
    "src/app/api/auth/admin/password/route.ts",
    "src/app/api/radar/invites/route.ts",
    "src/app/api/radar/invites/[inviteId]/route.ts",
    "src/app/api/radar/users/[userId]/route.ts",
    "src/app/api/radar/admin/reset/route.ts",
    "src/app/api/radar/storefront/orders/[orderId]/route.ts",
    "src/app/api/radar/storefront/orders/[orderId]/cancel-refund/route.ts",
    "src/app/api/radar/storefront/settings/route.ts",
    "src/app/api/radar/tax-settings/route.ts",
    "src/app/api/radar/tax-go-live/route.ts"
  ];
  for (const route of routes) {
    const source = readFileSync(path.join(root, route), "utf8");
    assert.match(source, /authorizeAdminMutation\(request, user\)/, route);
  }
});

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const file = path.join(directory, name);
    return statSync(file).isDirectory() ? routeFiles(file) : name === "route.ts" ? [file] : [];
  });
}

test("every radar mutation is authenticated and covered by the centralized origin proxy", () => {
  const proxySource = readFileSync(path.join(root, "src/proxy.ts"), "utf8");
  assert.match(proxySource, /matcher:\s*["']\/api\/(?:radar\/)?\:path\*["']/);
  assert.match(proxySource, /mutationMethods/);
  assert.match(proxySource, /signedJobPaths/);

  const mutationRoutes = routeFiles(path.join(root, "src/app/api/radar")).filter((file) => {
    const source = readFileSync(file, "utf8");
    return /export async function (POST|PUT|PATCH|DELETE)/.test(source);
  });
  assert.equal(mutationRoutes.length, 91);
  for (const file of mutationRoutes) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /requireUser\(|currentUser\(|cronAuthorized\(|authorizeAdminMutation\(/, path.relative(root, file));
  }
});

test("image routes constrain uploads and physical blob deletion", () => {
  const upload = readFileSync(path.join(root, "src/app/api/radar/inventory/images/upload/route.ts"), "utf8");
  const deletion = readFileSync(path.join(root, "src/app/api/radar/inventory/[itemId]/images/[imageId]/route.ts"), "utf8");
  assert.match(upload, /maxUploadBytes/);
  assert.match(upload, /allowedContentTypes/);
  assert.match(upload, /safeFilename/);
  assert.match(deletion, /isOwnedUploadedBlob/);
  assert.match(deletion, /\.public\.blob\.vercel-storage\.com/);
});

test("operational backup source excludes authentication and delivery secrets", () => {
  const service = readFileSync(path.join(root, "src/lib/radar-service.ts"), "utf8");
  const start = service.indexOf("export async function exportBackup");
  const end = service.indexOf("function toDate", start);
  assert.ok(start >= 0 && end > start);
  const exportSource = service.slice(start, end);
  for (const forbidden of [
    "prisma.user.findMany",
    "passwordHash",
    "friendInvite",
    "passwordResetToken",
    "browserPushSubscription",
    "notificationSettings",
    "notificationDeliveryLog",
    "auditLog"
  ]) {
    assert.doesNotMatch(exportSource, new RegExp(forbidden), forbidden);
  }
});

test("business GET handlers contain no persistent write calls", () => {
  const allowedWriteGetRoutes = new Set([
    "src/app/api/account/magic-link/verify/route.ts",
    "src/app/api/radar/inventory/market-sync/cron/route.ts",
    "src/app/api/radar/monitor/cron/route.ts",
    "src/app/api/radar/releases/sync/cron/route.ts",
    "src/app/api/radar/storefront/reservations/expire/route.ts"
  ]);
  const writePrefix = /^(create|update|upsert|delete|backfill|ensure|refresh|sync|run|expire|reset|import|seed|consume|verify|revoke|award|refund|cancel|attach)/i;

  for (const file of routeFiles(path.join(root, "src/app/api"))) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    if (allowedWriteGetRoutes.has(relative)) continue;
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    for (const statement of sourceFile.statements) {
      if (!ts.isFunctionDeclaration(statement) || statement.name?.text !== "GET" || !statement.body) continue;
      const riskyCalls: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const expression = node.expression;
          const name = ts.isIdentifier(expression)
            ? expression.text
            : ts.isPropertyAccessExpression(expression)
              ? expression.name.text
              : "";
          if (writePrefix.test(name) || name === "$transaction") riskyCalls.push(name);
        }
        ts.forEachChild(node, visit);
      };
      visit(statement.body);
      assert.deepEqual(riskyCalls, [], `${relative}: ${riskyCalls.join(", ")}`);
    }
  }
});

test("dashboard reads do not invoke persistent backfill or derived-state writes", () => {
  const service = readFileSync(path.join(root, "src/lib/radar-service.ts"), "utf8");
  const start = service.indexOf("export async function listDashboard");
  const end = service.indexOf("export async function createProduct", start);
  assert.ok(start >= 0 && end > start);
  const listDashboard = service.slice(start, end);
  for (const forbidden of [
    "ensureProductionInventoryMetadataColumns",
    "ensureInventoryProductImageTable",
    "autoLinkInventoryProducts",
    "backfillMissingMsrpInventoryCosts",
    "backfillInventoryProductImages",
    "ensureNotificationSettings",
    "ensureInvestmentSettings",
    "refreshReleaseAlerts",
    "productPriorityScore.deleteMany",
    "productPriorityScore.createMany"
  ]) {
    assert.doesNotMatch(listDashboard, new RegExp(forbidden.replaceAll(".", "\\.")), forbidden);
  }
  assert.match(listDashboard, /notificationSettings\.findUnique/);
  assert.match(listDashboard, /investmentSettings\.findUnique/);
});
