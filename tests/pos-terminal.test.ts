import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { stripeTerminalTestModeConfig } from "../src/lib/stripe-terminal";

function readSource(path: string) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

function sourceSlice(source: string, startNeedle: string, endNeedle?: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing source start: ${startNeedle}`);
  if (!endNeedle) return source.slice(start);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing source end: ${endNeedle}`);
  return source.slice(start, end);
}

test("Stripe Terminal test mode is feature-flagged and rejects live secret keys", () => {
  assert.deepEqual(stripeTerminalTestModeConfig({ STRIPE_TERMINAL_TEST_MODE_ENABLED: "false", STRIPE_SECRET_KEY: "sk_test_terminal" }), {
    enabled: false,
    secretKeyConfigured: true,
    secretKeyMode: "test",
    ready: false
  });
  assert.equal(stripeTerminalTestModeConfig({ STRIPE_TERMINAL_TEST_MODE_ENABLED: "true", STRIPE_SECRET_KEY: "sk_test_terminal" }).ready, true);
  assert.equal(stripeTerminalTestModeConfig({ STRIPE_TERMINAL_TEST_MODE_ENABLED: "true", STRIPE_SECRET_KEY: "sk_live_terminal" }).ready, false);

  const terminal = readSource("../src/lib/stripe-terminal.ts");
  assert.match(terminal, /STRIPE_TERMINAL_TEST_MODE_ENABLED/);
  assert.match(terminal, /secretKeyMode !== "test"/);
  assert.match(terminal, /Live Stripe Terminal payments are not enabled/);
  assert.doesNotMatch(terminal, /sk_live_/);
});

test("Terminal APIs are admin-only and expose no live payment route", () => {
  const routes = [
    "../src/app/api/radar/pos/terminal/connection-token/route.ts",
    "../src/app/api/radar/pos/terminal/payment-intents/route.ts",
    "../src/app/api/radar/pos/terminal/complete/route.ts",
    "../src/app/api/radar/pos/terminal/cancel/route.ts"
  ].map(readSource);

  for (const route of routes) {
    assert.match(route, /requireUser/);
    assert.match(route, /requireAdmin/);
    assert.doesNotMatch(route, /STRIPE_SECRET_KEY|clientSecret|token\.secret/);
  }

  assert.match(routes[1], /posTerminalPaymentIntentCreateSchema\.parse/);
  assert.match(routes[2], /posTerminalCompleteSchema\.parse/);
  assert.match(routes[3], /posTerminalCancelSchema\.parse/);
});

test("Terminal PaymentIntent is created from trusted POS cart totals only", () => {
  const terminal = readSource("../src/lib/stripe-terminal.ts");
  const createIntent = sourceSlice(terminal, "export async function createTerminalPosPaymentIntent", "export async function completeTerminalPosSale");
  const validation = readSource("../src/lib/validation.ts");

  assert.match(createIntent, /getTrustedPosSaleQuote\(currentUser, input\)/);
  assert.match(createIntent, /amount:?\s*,/);
  assert.match(createIntent, /payment_method_types: \["card_present"\]/);
  assert.match(createIntent, /capture_method: "manual"/);
  assert.match(createIntent, /metadata: terminalPaymentMetadata/);
  assert.match(createIntent, /idempotencyKey: `pos-terminal:/);
  assert.doesNotMatch(createIntent, /input\.total|input\.subtotal|input\.tax|input\.unitPrice|input\.price/);
  assert.match(validation, /export const posTerminalPaymentIntentCreateSchema/);
  assert.doesNotMatch(sourceSlice(validation, "export const posTerminalPaymentIntentCreateSchema", "export const posTerminalCompleteSchema"), /total|subtotal|tax|unitPrice|price/);
});

test("Terminal success verifies Stripe state, captures, completes POS sale, and stores PaymentIntent ID", () => {
  const terminal = readSource("../src/lib/stripe-terminal.ts");
  const service = readSource("../src/lib/radar-service.ts");
  const schema = readSource("../prisma/schema.prisma");
  const complete = sourceSlice(terminal, "export async function completeTerminalPosSale", "export async function cancelTerminalPosPaymentIntent");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");
  const createPosLine = sourceSlice(service, "async function createPosInventorySaleLine", "export async function createPosSale");

  assert.match(complete, /paymentIntents\.retrieve\(input\.paymentIntentId\)/);
  assert.match(complete, /verifyTerminalPaymentIntent/);
  assert.match(complete, /intent\.status !== "requires_capture" && intent\.status !== "succeeded"/);
  assert.match(complete, /paymentIntents\.capture\(intent\.id/);
  assert.match(complete, /createPosSale\(currentUser/);
  assert.match(complete, /refunds\.create/);
  assert.match(complete, /pos_sale_completion_failed/);
  assert.match(complete, /paymentMethod: "card_terminal"/);
  assert.match(complete, /stripePaymentIntentId: intent\.id/);
  assert.match(createPosSale, /paymentMethod === "card_terminal" && !stripePaymentIntentId/);
  assert.match(createPosLine, /stripePaymentIntentId: sale\.stripePaymentIntentId \?\? null/);
  assert.match(schema, /stripePaymentIntentId\s+String\?/);
});

test("Terminal cancel and failure paths do not deduct inventory", () => {
  const terminal = readSource("../src/lib/stripe-terminal.ts");
  const app = readSource("../src/components/RadarApp.tsx");
  const cancel = sourceSlice(terminal, "export async function cancelTerminalPosPaymentIntent");
  const completeTerminalSale = sourceSlice(app, "async function completeTerminalSale", "return (");

  assert.doesNotMatch(cancel, /createPosSale|inventoryStockLot|remainingQuantity|inventorySale\.create/);
  assert.match(cancel, /paymentIntents\.cancel\(intent\.id\)/);
  assert.match(completeTerminalSale, /await cancelTerminalPayment\(terminalPayment\.paymentIntentId\)/);
  assert.match(completeTerminalSale, /throw new Error\(collected\.error\?\.message/);
  assert.match(completeTerminalSale, /throw new Error\(processed\.error\?\.message/);
  assert.match(completeTerminalSale, /setTerminalStatus\(canceled \? "canceled" : "failed"\)/);
});

test("Terminal duplicate submit is idempotent and does not bypass POS oversell guards", () => {
  const terminal = readSource("../src/lib/stripe-terminal.ts");
  const service = readSource("../src/lib/radar-service.ts");
  const complete = sourceSlice(terminal, "export async function completeTerminalPosSale", "export async function cancelTerminalPosPaymentIntent");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");

  assert.match(terminal, /idempotencyKey: `pos-terminal:/);
  assert.match(terminal, /idempotencyKey: `pos-terminal-capture:/);
  assert.match(complete, /createPosSale\(currentUser/);
  assert.match(createPosSale, /receiptForExistingPosSale\(prisma, currentUser, saleReference\)/);
  assert.match(createPosSale, /receiptForExistingPosSale\(tx, currentUser, saleReference\)/);
  assert.match(createPosSale, /cartItem\.quantity > dto\.quantityOwned/);
  assert.match(service, /remainingQuantity: \{ gte: quantityFromLot \}/);
});

test("POS card reader option is hidden unless Terminal test mode is ready", () => {
  const app = readSource("../src/components/RadarApp.tsx");
  const posPanel = sourceSlice(app, "function PosPanel", "function PosReceipt");

  assert.match(app, /STRIPE_TERMINAL_SCRIPT_URL = "https:\/\/js\.stripe\.com\/terminal\/v1\/"/);
  assert.match(posPanel, /terminalReady = Boolean\(dashboard\.health\?\.providers\.stripe\.terminalTestModeReady\)/);
  assert.match(posPanel, /POS_PAYMENT_METHOD_VALUES\.filter\(\(method\) => terminalReady \|\| method !== "card_terminal"\)/);
  assert.match(posPanel, /paymentMethod === "card_terminal"/);
  assert.match(posPanel, /\/api\/radar\/pos\/terminal\/payment-intents/);
  assert.match(posPanel, /\/api\/radar\/pos\/terminal\/complete/);
  assert.match(posPanel, /\/api\/radar\/pos\/terminal\/cancel/);
});

test("Manual POS route remains separate from Terminal and cannot fake card reader payment", () => {
  const route = readSource("../src/app/api/radar/pos/sales/route.ts");
  const service = readSource("../src/lib/radar-service.ts");
  const createPosSale = sourceSlice(service, "export async function createPosSale", "export async function updateInventorySale");

  assert.doesNotMatch(route, /terminal|payment-intents|connection-token|Stripe/i);
  assert.match(createPosSale, /Card reader sales must be completed through the Stripe Terminal flow/);
  assert.match(createPosSale, /paymentMethod !== "card_terminal" && stripePaymentIntentId/);
});
