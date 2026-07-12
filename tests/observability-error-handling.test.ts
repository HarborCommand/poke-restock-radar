import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { safeMutationError } from "../src/lib/http";
import {
  currentRequestId,
  logServerEvent,
  normalizeRequestId,
  observabilitySnapshot,
  redactLogValue,
  resetObservabilityForTests,
  requestCorrelationId,
  runWithRequestContext,
  safeEntityRef,
  sanitizeLogText
} from "../src/lib/observability";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("structured logging redacts secrets contact data and database URLs", () => {
  const redacted = redactLogValue({
    email: "customer@example.test",
    passwordHash: "private-hash",
    nested: {
      authorization: "Bearer secret-token",
      error: "postgresql://user:password@private-db.example/db failed for owner@example.test"
    }
  });
  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(serialized, /customer@example|private-hash|secret-token|private-db|owner@example/i);
  assert.match(serialized, /REDACTED/);
  assert.equal(sanitizeLogText("Bearer abcdefghijklmnop"), "Bearer [REDACTED]");
});

test("recursive redaction handles mixed casing arrays errors headers and stringified JSON", () => {
  const value = redactLogValue({
    Headers: { AUTHORIZATION: "Bearer private-token", Cookie: "session=private" },
    rows: [
      { InternalNote: "private note", IDEMPOTENCYkey: "rewards:private-key" },
      new Error("Failed for 305-555-1212 at https://example.test/path?token=private")
    ],
    payload: JSON.stringify({ CustomerEmail: "owner@example.test", ApiKEY: "private-api-key" })
  });
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /private-token|session=|private note|private-key|305-555|owner@example|private-api-key|\?token=/i);
  assert.match(serialized, /REDACTED/);
  assert.doesNotMatch(
    sanitizeLogText("password=hunter2 customerId=cm123456789012345678901 paymentReference=private-ref"),
    /hunter2|cm123|private-ref/i
  );
});

test("correlation ids accept safe upstream ids and reject malformed values", () => {
  const supplied = requestCorrelationId(new Request("https://example.test", { headers: { "x-request-id": "request-safe-123" } }));
  const generated = requestCorrelationId(new Request("https://example.test", { headers: { "x-request-id": "bad id with spaces" } }));
  const injected = normalizeRequestId("request-ok\r\ninjected");
  const oversized = requestCorrelationId(new Request("https://example.test", { headers: { "x-request-id": "x".repeat(65) } }));
  assert.equal(supplied, "request-safe-123");
  assert.match(generated, /^[a-f0-9-]{36}$/);
  assert.equal(injected, null);
  assert.match(oversized, /^[a-f0-9-]{36}$/);
  assert.match(safeEntityRef("private-record-id") ?? "", /^[a-f0-9]{16}$/);
});

test("request context propagates the same id to nested logs", () => {
  resetObservabilityForTests();
  const original = console.info;
  let captured = "";
  console.info = (value?: unknown) => { captured = String(value ?? ""); };
  try {
    runWithRequestContext("request-context-123", () => {
      assert.equal(currentRequestId(), "request-context-123");
      logServerEvent({ route: "internal:test", operation: "nested.operation", status: 200 });
    });
  } finally {
    console.info = original;
  }
  assert.match(captured, /request-context-123/);
  assert.equal(observabilitySnapshot().recent[0]?.requestId, "request-context-123");
});

test("unexpected mutation errors return a safe envelope without stack or secret text", async () => {
  const response = safeMutationError(
    new Error("postgresql://user:password@private-db.example/db connection failed"),
    "request-safe-500",
    "The operation could not be completed."
  );
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.deepEqual(body, {
    error: "The operation could not be completed.",
    code: "INTERNAL_ERROR",
    requestId: "request-safe-500",
    retryable: false
  });
  assert.doesNotMatch(JSON.stringify(body), /postgres|private-db|password|stack/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("safe business errors remain actionable and carry a request id", async () => {
  const response = safeMutationError(new Error("Reward adjustments are disabled."), "request-safe-400");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Reward adjustments are disabled.",
    code: "BUSINESS_RULE_REJECTED",
    requestId: "request-safe-400",
    retryable: false
  });
});

test("Prisma conflict details stay server-side and produce stable safe envelopes", async () => {
  const conflict = Object.assign(new Error("Unique constraint failed on private customer data"), { code: "P2002", meta: { target: "email" } });
  const response = safeMutationError(conflict, "request-conflict-123");
  assert.equal(response.status, 409);
  const serialized = JSON.stringify(await response.json());
  assert.match(serialized, /CONFLICT/);
  assert.doesNotMatch(serialized, /P2002|private customer|email|meta/i);
});

test("structured event output contains correlation data but not raw sensitive fields", () => {
  const original = console.error;
  let captured = "";
  console.error = (value?: unknown) => { captured = String(value ?? ""); };
  try {
    logServerEvent({
      requestId: "request-log-123",
      route: "/api/test",
      operation: "test.failure",
      status: 500,
      entityRef: "raw-private-entity-id",
      error: new Error("Failure for person@example.test using sk_private123456789")
    });
  } finally {
    console.error = original;
  }
  assert.match(captured, /request-log-123/);
  assert.match(captured, /errorCategory/);
  assert.doesNotMatch(captured, /person@example|sk_private|raw-private-entity-id/i);
});

test("a logging sink failure never escapes into business code", () => {
  const original = console.error;
  console.error = () => { throw new Error("log sink unavailable"); };
  try {
    assert.doesNotThrow(() => {
      logServerEvent({ requestId: "request-log-fail", route: "/api/test", operation: "test.failure", status: 500 });
    });
  } finally {
    console.error = original;
  }
});

test("health and high-risk routes propagate request ids and safe errors", () => {
  const health = readFileSync(path.join(root, "src/app/api/health/route.ts"), "utf8");
  const dashboard = readFileSync(path.join(root, "src/app/api/radar/dashboard/route.ts"), "utf8");
  const adjustment = readFileSync(path.join(root, "src/app/api/radar/rewards/adjustments/route.ts"), "utf8");
  const refund = readFileSync(path.join(root, "src/app/api/radar/pos/sales/[saleReference]/refund/route.ts"), "utf8");
  const link = readFileSync(path.join(root, "src/app/api/radar/customers/[customerAccountId]/attach-order/route.ts"), "utf8");
  const cancelRefund = readFileSync(path.join(root, "src/app/api/radar/storefront/orders/[orderId]/cancel-refund/route.ts"), "utf8");
  const proxy = readFileSync(path.join(root, "src/proxy.ts"), "utf8");
  assert.match(health, /requestCorrelationId\(request\)/);
  assert.match(health, /withRequestId/);
  assert.match(dashboard, /internalServerError/);
  assert.doesNotMatch(dashboard, /detail:\s*message|console\.error/);
  assert.match(adjustment, /safeMutationError/);
  assert.match(adjustment, /runWithRequestContext/);
  assert.match(refund, /safeEntityRef\(saleReference\)/);
  assert.match(link, /customer_link\.apply/);
  assert.match(cancelRefund, /storefront_order\.cancel_refund/);
  assert.match(proxy, /requestHeaders\.set\("x-request-id"/);
  assert.match(proxy, /matcher:\s*"\/api\/:path\*"/);
});
