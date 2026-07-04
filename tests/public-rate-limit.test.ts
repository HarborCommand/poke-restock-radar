import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  checkPublicRateLimit,
  disablePublicRateLimitTestStorage,
  enablePublicRateLimitTestStorage,
  PublicRateLimitExceededError,
  publicRateLimitCartIdentifier,
  publicRateLimitResponse,
  publicRateLimitTestRecords
} from "../src/lib/rate-limit";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function requestFor(path: string, ip = "203.0.113.10") {
  return new Request(`https://www.gamedaygrabs.com${path}`, {
    method: "POST",
    headers: {
      "x-forwarded-for": ip,
      "x-real-ip": "198.51.100.5",
      "user-agent": "public-rate-limit-test"
    }
  });
}

test("shipping quote limiter allows normal traffic and returns 429 over limit", async () => {
  const now = new Date("2026-07-04T12:00:00.000Z");
  enablePublicRateLimitTestStorage(() => now);
  try {
    const request = requestFor("/api/storefront/shipping/quote");
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await checkPublicRateLimit({ request, action: "shipping_quote" });
    }

    let error: unknown = null;
    try {
      await checkPublicRateLimit({ request, action: "shipping_quote" });
    } catch (caught) {
      error = caught;
    }

    assert.ok(error instanceof PublicRateLimitExceededError);
    const response = publicRateLimitResponse(error);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "600");
    assert.deepEqual(await response.json(), { error: "Too many requests. Please try again shortly." });
  } finally {
    disablePublicRateLimitTestStorage();
  }
});

test("checkout creation limiter allows normal traffic and blocks burst abuse", async () => {
  const now = new Date("2026-07-04T12:00:00.000Z");
  enablePublicRateLimitTestStorage(() => now);
  try {
    const request = requestFor("/api/storefront/checkout/session", "203.0.113.11");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await checkPublicRateLimit({ request, action: "checkout_creation" });
    }

    await assert.rejects(
      () => checkPublicRateLimit({ request, action: "checkout_creation" }),
      PublicRateLimitExceededError
    );
  } finally {
    disablePublicRateLimitTestStorage();
  }
});

test("contact, order lookup, login, and magic-link over-limit responses stay generic", async () => {
  const now = new Date("2026-07-04T12:00:00.000Z");
  enablePublicRateLimitTestStorage(() => now);
  try {
    const contact = requestFor("/api/storefront/contact", "203.0.113.12");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await checkPublicRateLimit({ request: contact, action: "contact_message" });
    }
    await assert.rejects(
      () => checkPublicRateLimit({ request: contact, action: "contact_message" }),
      PublicRateLimitExceededError
    );

    const orderLookup = requestFor("/api/storefront/order-status", "203.0.113.13");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await checkPublicRateLimit({
        request: orderLookup,
        action: "order_status_lookup",
        identifiers: [{ scope: "order", value: "GDD-ORDER-123" }]
      });
    }
    let orderError: unknown = null;
    try {
      await checkPublicRateLimit({
        request: orderLookup,
        action: "order_status_lookup",
        identifiers: [{ scope: "order", value: "GDD-ORDER-123" }]
      });
    } catch (caught) {
      orderError = caught;
    }
    assert.ok(orderError instanceof PublicRateLimitExceededError);
    assert.deepEqual(await publicRateLimitResponse(orderError).json(), {
      error: "Too many requests. Please try again shortly."
    });

    const login = requestFor("/api/account/login", "203.0.113.14");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await checkPublicRateLimit({ request: login, action: "customer_login" });
    }
    await assert.rejects(() => checkPublicRateLimit({ request: login, action: "customer_login" }), PublicRateLimitExceededError);

    const magicLink = requestFor("/api/account/magic-link/request", "203.0.113.15");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await checkPublicRateLimit({
        request: magicLink,
        action: "customer_magic_link",
        identifiers: [{ scope: "email", value: "buyer@example.com" }]
      });
    }
    await assert.rejects(
      () =>
        checkPublicRateLimit({
          request: magicLink,
          action: "customer_magic_link",
          identifiers: [{ scope: "email", value: "buyer@example.com" }]
        }),
      PublicRateLimitExceededError
    );
  } finally {
    disablePublicRateLimitTestStorage();
  }
});

test("limiter stores only hashed client, email, order, and cart identifiers", async () => {
  const now = new Date("2026-07-04T12:00:00.000Z");
  enablePublicRateLimitTestStorage(() => now);
  try {
    await checkPublicRateLimit({
      request: requestFor("/api/storefront/order-status", "203.0.113.16"),
      action: "order_status_lookup",
      identifiers: [
        { scope: "order", value: "GDD-ORDER-SECRET-123" },
        { scope: "email", value: "buyer@example.com" }
      ]
    });
    await checkPublicRateLimit({
      request: requestFor("/api/storefront/shipping/quote", "203.0.113.17"),
      action: "shipping_quote",
      identifiers: [
        {
          scope: "cart",
          value: publicRateLimitCartIdentifier([{ id: "private-product-id", quantity: 2 }], { destinationZip: "33135" })
        },
        { scope: "zip", value: "33135" }
      ]
    });

    const records = publicRateLimitTestRecords();
    assert.ok(records.length >= 5);
    for (const record of records) {
      assert.match(record.keyHash, /^[a-f0-9]{64}$/);
    }
    const serialized = JSON.stringify(records);
    for (const rawValue of [
      "203.0.113.16",
      "203.0.113.17",
      "198.51.100.5",
      "buyer@example.com",
      "GDD-ORDER-SECRET-123",
      "private-product-id",
      "33135"
    ]) {
      assert.doesNotMatch(serialized, new RegExp(rawValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  } finally {
    disablePublicRateLimitTestStorage();
  }
});

test("longer public limiter blocks carry across rolling bucket boundaries", async () => {
  let now = new Date("2026-07-04T12:14:50.000Z");
  enablePublicRateLimitTestStorage(() => now);
  try {
    const request = requestFor("/api/account/register", "203.0.113.18");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await checkPublicRateLimit({ request, action: "customer_registration" });
    }
    await assert.rejects(
      () => checkPublicRateLimit({ request, action: "customer_registration" }),
      PublicRateLimitExceededError
    );

    now = new Date("2026-07-04T12:15:10.000Z");
    let error: unknown = null;
    try {
      await checkPublicRateLimit({ request, action: "customer_registration" });
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof PublicRateLimitExceededError);
    assert.ok(error.retryAfterSeconds > 1700);
  } finally {
    disablePublicRateLimitTestStorage();
  }
});

test("public route wiring protects selected endpoints and excludes webhooks/admin routes", () => {
  const protectedRoutes = [
    ["src/app/api/storefront/shipping/quote/route.ts", "shipping_quote"],
    ["src/app/api/storefront/checkout/session/route.ts", "checkout_creation"],
    ["src/app/api/storefront/checkout/route.ts", "checkout_creation"],
    ["src/app/api/storefront/contact/route.ts", "contact_message"],
    ["src/app/api/storefront/order-status/route.ts", "order_status_lookup"],
    ["src/app/api/storefront/invoice-request/route.ts", "invoice_request"],
    ["src/app/api/storefront/cart/route.ts", "cart_lookup"],
    ["src/app/api/account/login/route.ts", "customer_login"],
    ["src/app/api/account/magic-link/request/route.ts", "customer_magic_link"],
    ["src/app/api/account/register/route.ts", "customer_registration"],
    ["src/app/api/account/forgot-password/route.ts", "customer_forgot_password"],
    ["src/app/api/account/reset-password/route.ts", "customer_reset_password"]
  ] as const;

  for (const [path, action] of protectedRoutes) {
    const source = readProjectFile(path);
    assert.match(source, /checkPublicRateLimit/);
    assert.match(source, new RegExp(`action:\\s*"${action}"`));
    assert.match(source, /PublicRateLimitExceededError/);
    assert.match(source, /publicRateLimitResponse/);
  }

  for (const path of [
    "src/app/api/storefront/webhook/stripe/route.ts",
    "src/app/api/storefront/stripe/webhook/route.ts"
  ]) {
    const source = readProjectFile(path);
    assert.match(source, /handleStripeWebhook/);
    assert.doesNotMatch(source, /checkPublicRateLimit|PublicRateLimitExceededError/);
  }

  const adminUpload = readProjectFile("src/app/api/radar/inventory/images/upload/route.ts");
  assert.match(adminUpload, /requireUser\(\)/);
  assert.match(adminUpload, /requireAdmin\(user\)/);
  assert.doesNotMatch(adminUpload, /checkPublicRateLimit/);
});

test("public limiter schema and migration are additive, indexed, and privacy safe", () => {
  const schema = readProjectFile("prisma/schema.prisma");
  const migration = readProjectFile("prisma/migrations/20260704053000_public_storefront_rate_limits/migration.sql");
  const sqliteInit = readProjectFile("prisma/init-sqlite.ts");
  const limiter = readProjectFile("src/lib/rate-limit.ts");
  const model = schema.slice(schema.indexOf("model PublicRateLimit"), schema.indexOf("model CustomerSession"));
  const sqliteTable = sqliteInit.slice(sqliteInit.indexOf('CREATE TABLE IF NOT EXISTS "PublicRateLimit"'), sqliteInit.indexOf('CREATE TABLE IF NOT EXISTS "CustomerSavedAddress"'));
  const sqliteIndexes = sqliteInit.slice(sqliteInit.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS "PublicRateLimit_action_rule_keyHash_windowStart_key"'), sqliteInit.indexOf('CREATE INDEX IF NOT EXISTS "CustomerSavedAddress_customerAccountId_idx"'));

  assert.match(model, /model PublicRateLimit \{/);
  assert.match(model, /action\s+String/);
  assert.match(model, /rule\s+String/);
  assert.match(model, /scope\s+String/);
  assert.match(model, /keyHash\s+String/);
  assert.match(model, /windowStart\s+DateTime/);
  assert.match(model, /blockedUntil\s+DateTime\?/);
  assert.match(model, /@@unique\(\[action, rule, keyHash, windowStart\]\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "PublicRateLimit"/);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS "PublicRateLimit_action_rule_keyHash_windowStart_key"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "PublicRateLimit_blockedUntil_idx"/);
  assert.match(sqliteTable, /CREATE TABLE IF NOT EXISTS "PublicRateLimit"/);
  assert.match(sqliteIndexes, /CREATE INDEX IF NOT EXISTS "PublicRateLimit_keyHash_idx"/);
  assert.match(limiter, /createHmac\("sha256", rateLimitSecret\(\)\)/);
  assert.match(limiter, /x-forwarded-for/);
  assert.match(limiter, /x-real-ip/);
  assert.match(limiter, /x-vercel-forwarded-for/);
  assert.match(limiter, /Retry-After/);
  assert.match(limiter, /deleteMany\(\{ where: \{ windowStart: \{ lt: cutoff \} \} \}\)/);
  assert.doesNotMatch(migration, /\bDROP\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|\bUPDATE\s+"|ALTER COLUMN|SET NOT NULL/i);
  assert.doesNotMatch(model + migration + sqliteTable + sqliteIndexes, /rawIp|ipAddress|email\s+String|orderNumber|cartJson|password|tokenHash|cardNumber|cvc|payment_method_details|raw Stripe|webhook body/i);
});
