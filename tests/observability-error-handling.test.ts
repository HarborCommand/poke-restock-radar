import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { safeMutationError } from "../src/lib/http";
import {
  logServerEvent,
  redactLogValue,
  requestCorrelationId,
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

test("correlation ids accept safe upstream ids and reject malformed values", () => {
  const supplied = requestCorrelationId(new Request("https://example.test", { headers: { "x-request-id": "request-safe-123" } }));
  const generated = requestCorrelationId(new Request("https://example.test", { headers: { "x-request-id": "bad id with spaces" } }));
  assert.equal(supplied, "request-safe-123");
  assert.match(generated, /^[a-f0-9-]{36}$/);
  assert.match(safeEntityRef("private-record-id") ?? "", /^[a-f0-9]{12}$/);
});

test("unexpected mutation errors return a safe envelope without stack or secret text", async () => {
  const response = safeMutationError(
    new Error("postgresql://user:password@private-db.example/db connection failed"),
    "request-safe-500",
    "The operation could not be completed."
  );
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.deepEqual(body, { error: "The operation could not be completed.", requestId: "request-safe-500" });
  assert.doesNotMatch(JSON.stringify(body), /postgres|private-db|password|stack/i);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
});

test("safe business errors remain actionable and carry a request id", async () => {
  const response = safeMutationError(new Error("Reward adjustments are disabled."), "request-safe-400");
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Reward adjustments are disabled.", requestId: "request-safe-400" });
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
      error: new Error("Failure for person@example.test using sk_private123456789")
    });
  } finally {
    console.error = original;
  }
  assert.match(captured, /request-log-123/);
  assert.match(captured, /errorCategory/);
  assert.doesNotMatch(captured, /person@example|sk_private/i);
});

test("health and high-risk routes propagate request ids and safe errors", () => {
  const health = readFileSync(path.join(root, "src/app/api/health/route.ts"), "utf8");
  const dashboard = readFileSync(path.join(root, "src/app/api/radar/dashboard/route.ts"), "utf8");
  const adjustment = readFileSync(path.join(root, "src/app/api/radar/rewards/adjustments/route.ts"), "utf8");
  const refund = readFileSync(path.join(root, "src/app/api/radar/pos/sales/[saleReference]/refund/route.ts"), "utf8");
  assert.match(health, /requestCorrelationId\(request\)/);
  assert.match(health, /withRequestId/);
  assert.match(dashboard, /internalServerError/);
  assert.doesNotMatch(dashboard, /detail:\s*message|console\.error/);
  assert.match(adjustment, /safeMutationError/);
  assert.match(refund, /safeEntityRef\(saleReference\)/);
});
