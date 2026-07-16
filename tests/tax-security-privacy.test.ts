import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  posSaleCreateSchema,
  posSaleRefundSchema,
  posTaxQuoteSchema,
  storefrontCheckoutSchema,
  storefrontOrderCancelRefundSchema,
  taxAdminSettingsSchema
} from "../src/lib/validation";
import { privateNoStoreHeaders } from "../src/lib/http";
import { authorizeAdminMutation } from "../src/lib/admin-authorization";
import type { SessionUser } from "../src/types/radar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const posItem = { inventoryItemId: "item-1", quantity: 1 };

test("tax-sensitive responses use explicit private no-store policy", () => {
  assert.match(privateNoStoreHeaders["Cache-Control"], /private/);
  assert.match(privateNoStoreHeaders["Cache-Control"], /no-store/);
  for (const file of [
    "src/app/api/radar/pos/tax-quote/route.ts",
    "src/app/api/radar/pos/sales/route.ts",
    "src/app/api/radar/pos/customer-match/route.ts",
    "src/app/api/radar/pos/sales/[saleReference]/refund/route.ts",
    "src/app/api/radar/storefront/orders/[orderId]/cancel-refund/route.ts",
    "src/app/api/radar/tax-settings/route.ts"
  ]) {
    const source = read(file);
    assert.match(source, /privateOk|withPrivateNoStore/, `${file} must opt into private responses`);
    assert.match(source, /withRequestId/, `${file} must preserve a request ID`);
  }
});

test("admin tax mutations require authenticated same-origin authorization", () => {
  for (const file of [
    "src/app/api/radar/pos/tax-quote/route.ts",
    "src/app/api/radar/pos/sales/route.ts",
    "src/app/api/radar/pos/customer-match/route.ts",
    "src/app/api/radar/pos/sales/[saleReference]/refund/route.ts",
    "src/app/api/radar/storefront/orders/[orderId]/cancel-refund/route.ts"
  ]) {
    const source = read(file);
    assert.match(source, /requireUser/);
    assert.match(source, /authorizeAdminMutation/);
  }
});

test("checkout and POS schemas reject every browser-controlled tax authority field", () => {
  for (const [field, value] of Object.entries({
    taxCents: 0,
    taxRate: 0,
    jurisdiction: "Injected",
    taxableSubtotalCents: 100,
    finalTotalCents: 100,
    taxExempt: true,
    refundedTaxCents: 0,
    providerReference: "provider-controlled",
    stripeTaxReady: true,
    liveTaxEnabled: true,
    unknownSensitiveField: "injected"
  })) {
    assert.throws(
      () => storefrontCheckoutSchema.parse({ items: [{ id: "item-1", quantity: 1 }], [field]: value }),
      `${field} must not be accepted at checkout`
    );
  }
  for (const [field, value] of Object.entries({
    taxCents: 0,
    taxRate: 0,
    jurisdiction: "Injected",
    taxableSubtotalCents: 100,
    finalTotalCents: 100,
    refundedTaxCents: 0,
    providerReference: "provider-controlled",
    stripeTaxReady: true,
    liveTaxEnabled: true,
    unknownSensitiveField: "injected"
  })) {
    assert.throws(
      () => posTaxQuoteSchema.parse({ idempotencyKey: "quote-sec-1234", items: [posItem], [field]: value }),
      `${field} must not be accepted in a POS quote`
    );
  }
  assert.throws(() => posSaleCreateSchema.parse({
    idempotencyKey: "pos-sec-1234",
    quoteId: "q".repeat(80),
    items: [posItem],
    paymentMethod: "cash",
    stateRateBasisPoints: 0
  }));
  assert.throws(() => posSaleCreateSchema.parse({
    idempotencyKey: "pos-sec-5678",
    quoteId: "q".repeat(80),
    items: [{ ...posItem, taxCents: 0 }],
    paymentMethod: "cash"
  }));
  const settingsInput = {
    storeCountry: "US",
    storeState: "FL",
    storeCounty: "Orange",
    stateRateBasisPoints: 600,
    countyRateBasisPoints: 50,
    effectiveDate: "2026-07-15",
    sourceNote: "Approved public rate source",
    onlineTaxProfileEnabled: false,
    posTaxEnabled: false,
    taxExemptSalesEnabled: false,
    taxReportingProfileEnabled: false,
    localPickupTaxTreatment: "pending_review",
    exemptionReferenceRequired: true,
    exemptionReasonRequired: true,
    defaultTaxCategory: "general_tangible_goods",
    defaultStripeTaxCode: "txcd_99999999",
    defaultReportingPeriod: "monthly",
    registrationConfirmed: false,
    storeAddressConfirmed: false,
    countyConfirmed: false,
    defaultCodeConfirmed: false,
    previewOnlinePassed: false,
    previewPickupPassed: false,
    previewPosPassed: false,
    receiptVerified: false,
    refundVerified: false,
    reportReconciled: false,
    ownerApproved: false
  } as const;
  for (const field of ["stripeSecret", "providerReference", "stripeTaxLive", "registrationNumber", "unknownSensitiveField"]) {
    assert.throws(() => taxAdminSettingsSchema.parse({ ...settingsInput, [field]: "injected" }));
  }
  const auth = read("src/lib/auth.ts");
  assert.match(auth, /Authentication required" \}, \{ status: 401 \}/);
  const nonAdmin = {
    id: "different-workspace-user",
    email: "staff@example.test",
    name: "Staff",
    role: "FRIEND",
    sessionVersion: 1
  } as SessionUser;
  assert.equal(
    authorizeAdminMutation(new Request("https://admin.example.test/api/radar/pos/customer-match", {
      method: "POST",
      headers: { origin: "https://admin.example.test", "sec-fetch-site": "same-origin" }
    }), nonAdmin)?.status,
    403
  );
  const admin = { ...nonAdmin, role: "ADMIN" } as SessionUser;
  assert.equal(
    authorizeAdminMutation(new Request("https://admin.example.test/api/radar/pos/customer-match", {
      method: "POST",
      headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }
    }), admin)?.status,
    403
  );
});

test("refund schemas reject client tax and customer ownership fields", () => {
  const online = {
    reason: "customer_requested",
    refundType: "full",
    returnItemsToStock: true,
    sendCustomerEmail: false,
    idempotencyKey: "refund-sec-1234"
  };
  assert.throws(() => storefrontOrderCancelRefundSchema.parse({ ...online, refundedTaxCents: 0 }));
  assert.throws(() => storefrontOrderCancelRefundSchema.parse({ ...online, customerAccountId: "other-owner" }));
  const pos = { idempotencyKey: "refund-pos-1234", refundType: "full", reason: "customer_return", restoreInventory: true };
  assert.throws(() => posSaleRefundSchema.parse({ ...pos, refundTax: 0 }));
  assert.throws(() => posSaleRefundSchema.parse({ ...pos, taxRate: 0 }));
});

test("POS customer matching is owner-scoped and route cannot trust a customer id globally", () => {
  const helper = read("src/lib/pos-customer.ts");
  const workspace = read("src/lib/customer-workspace.ts");
  const route = read("src/app/api/radar/pos/customer-match/route.ts");
  const customerListRoute = read("src/app/api/radar/customers/route.ts");
  const rewardsAdmin = read("src/lib/rewards-admin.ts");
  const sale = read("src/lib/radar-service.ts");
  assert.match(helper, /workspaceCustomerWhereWithLegacy\(client, ownerUserId\)/);
  assert.match(workspace, /return \{ userId: ownerUserId \}/);
  assert.match(workspace, /legacyWorkspaceCustomerIds/);
  assert.match(workspace, /c\."userId" IS NULL/);
  assert.match(workspace, /o\."userId" = \$\{ownerUserId\}/);
  assert.match(workspace, /s\."userId" = \$\{ownerUserId\}/);
  assert.doesNotMatch(workspace, /phone/);
  assert.match(route, /resolvePosCustomerMatch\(input, user\.id\)/);
  assert.match(customerListRoute, /listAdminCustomerRewards\(user\.id,/);
  assert.match(rewardsAdmin, /workspaceCustomerWhereWithLegacy\(prisma, ownerUserId\)/);
  assert.match(sale, /\}, currentUser\.id, tx\)/);
});

test("Stripe webhooks are signature-first retry-safe private and redacted", () => {
  const storefront = read("src/lib/storefront.ts");
  const routeHelper = read("src/lib/stripe-webhook-route.ts");
  const concurrency = read("src/lib/tax-refund-concurrency.ts");
  const verification = storefront.indexOf("webhooks.constructEvent(rawBody, signature, secret)");
  const claim = storefront.indexOf("await claimProviderEvent", verification);
  assert.ok(verification >= 0 && claim > verification);
  assert.match(routeHelper, /const rawBody = await request\.text\(\)/);
  assert.match(routeHelper, /request\.headers\.get\("stripe-signature"\)/);
  assert.match(routeHelper, /Stripe webhook could not be verified or processed\./);
  assert.match(routeHelper, /privateNoStoreHeaders/);
  const logCall = routeHelper.slice(routeHelper.indexOf("logServerEvent({"), routeHelper.indexOf("});", routeHelper.indexOf("logServerEvent({")));
  assert.doesNotMatch(logCall, /message:\s*error|payload:\s*rawBody|signature\s*:/);
  assert.match(concurrency, /eventType: `processing:\$\{input\.eventType\}`/);
  assert.match(concurrency, /abandonProviderEvent/);
});

test("tax report and CSV remain owner-scoped admin-only read-only and PII-free", () => {
  const route = read("src/app/api/radar/tax-report/route.ts");
  const reporting = read("src/lib/tax-reporting.ts");
  assert.match(route, /requireUser/);
  assert.match(route, /requireAdmin/);
  assert.match(route, /privateNoStoreHeaders/);
  assert.match(reporting, /userId: currentUser\.id/);
  assert.match(reporting, /5_000/);
  assert.doesNotMatch(route + reporting, /customerEmail|customerPhone|shippingLine1|billingLine1|taxExemptionReference/);
  assert.doesNotMatch(route, /\.create\(|\.update\(|\.upsert\(|\.delete\(/);
});

test("private tax order and receipt surfaces cannot enter the service-worker cache", () => {
  const worker = read("public/sw.js");
  const accountPage = read("src/app/account/orders/[orderNumber]/page.tsx");
  const adminReportPage = read("src/app/admin/tax-reports/page.tsx");
  for (const route of [
    "src/app/api/radar/storefront/orders/route.ts",
    "src/app/api/radar/storefront/orders/[orderId]/route.ts",
    "src/app/api/storefront/order-status/route.ts"
  ]) {
    assert.match(read(route), /privateOk|withPrivateNoStore/, `${route} must be private/no-store`);
  }
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/account\/"\)/);
  assert.match(worker, /cacheControl\.includes\("private"\)/);
  assert.match(worker, /cacheControl\.includes\("no-store"\)/);
  assert.match(accountPage, /noStore\(\)/);
  assert.match(accountPage, /robots:[\s\S]*index:\s*false/);
  assert.match(adminReportPage, /robots:\s*\{\s*index:\s*false/);
});

test("webhook routes share the hardened handler and do not return provider errors", () => {
  for (const file of [
    "src/app/api/storefront/webhook/stripe/route.ts",
    "src/app/api/storefront/stripe/webhook/route.ts"
  ]) {
    const source = read(file);
    assert.match(source, /handleStripeWebhookRequest\(request\)/);
    assert.doesNotMatch(source, /error instanceof Error|error\.message/);
  }
});

test("authorization matrix covers every required tax surface", () => {
  const matrix = read("docs/tax-security-privacy-review.md");
  for (const column of [
    "Route / surface", "Method", "Caller", "Authentication", "Role", "Same-origin requirement",
    "Webhook / secret requirement", "Accepted fields", "Authoritative server fields", "Audit", "Idempotency",
    "Cache policy", "PII exposure"
  ]) {
    assert.match(matrix, new RegExp(`\\| ${column.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")} \\|`));
  }
  for (const surface of [
    "checkout", "webhook", "tax quote", "pos finalize", "tax settings", "readiness", "exemption", "receipts",
    "order/sale detail", "full online refund", "partial online refund", "pos refund", "tax report", "reconciliation",
    "csv export", "customer lookup/match", "local pickup", "manual/provider jobs"
  ]) {
    assert.match(matrix.toLowerCase(), new RegExp(surface));
  }
  for (const guarantee of [
    "cross-owner", "no customer/link/reward write", "signature", "spreadsheet injection", "service worker",
    "noindex", "raw request/provider body", "historical `not_recorded`", "rewards redemption remain disabled"
  ]) {
    assert.match(matrix.toLowerCase(), new RegExp(guarantee.toLowerCase().replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")));
  }
  assert.match(matrix, /No Production configuration or data was changed/);
});
