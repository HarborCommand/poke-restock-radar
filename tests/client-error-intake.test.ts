import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseClientErrorPayload } from "../src/lib/client-error-intake";
import { POST } from "../src/app/api/client-errors/route";
import { disablePublicRateLimitTestStorage, enablePublicRateLimitTestStorage } from "../src/lib/rate-limit";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://preview.example.test/api/client-errors", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://preview.example.test",
      "sec-fetch-site": "same-origin",
      ...headers
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

test("client error sanitization strips contact data tokens and URL query parameters", () => {
  const parsed = parseClientErrorPayload({
    event: "route_error",
    message: "Failure for owner@example.test using Bearer private-token",
    stack: "at route 305-555-1212 https://example.test/account?token=private",
    component: "AccountRoute",
    url: "https://example.test/account?token=private#section",
    browser: { name: "Browser", version: "1", platform: "Desktop" },
    requestId: "request-client-123"
  });
  const serialized = JSON.stringify(parsed);
  assert.doesNotMatch(serialized, /owner@example|private-token|305-555|\?token=|#section/i);
  assert.equal(parsed.url, "https://example.test/account");
  assert.equal(parsed.requestId, "request-client-123");
});

test("client error payload rejects unknown fields", () => {
  assert.throws(
    () => parseClientErrorPayload({ event: "route_error", message: "Safe failure", cookies: "private" }),
    /Unrecognized key/
  );
});

test("client error intake accepts a bounded same-origin report", async () => {
  enablePublicRateLimitTestStorage();
  const original = console.warn;
  console.warn = () => undefined;
  try {
    const response = await POST(
      request(
        { event: "route_error", message: "Safe failure", requestId: "request-client-456" },
        { "x-request-id": "request-client-456" }
      )
    );
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("x-request-id"), "request-client-456");
    assert.deepEqual(await response.json(), { ok: true, requestId: "request-client-456" });
  } finally {
    console.warn = original;
    disablePublicRateLimitTestStorage();
  }
});

test("client error intake rejects cross-origin and oversized submissions", async () => {
  enablePublicRateLimitTestStorage();
  const original = console.warn;
  console.warn = () => undefined;
  try {
    const crossOrigin = await POST(request({ event: "route_error", message: "Safe" }, { origin: "https://attacker.test", "sec-fetch-site": "cross-site" }));
    assert.equal(crossOrigin.status, 403);
    const oversized = await POST(request("x".repeat(9_000), { "content-length": "9000" }));
    assert.equal(oversized.status, 413);
    assert.doesNotMatch(JSON.stringify(await oversized.json()), /x{20}/);
  } finally {
    console.warn = original;
    disablePublicRateLimitTestStorage();
  }
});

test("client error intake rate limits repeated reports", async () => {
  enablePublicRateLimitTestStorage(() => new Date("2026-07-11T12:00:00.000Z"));
  const original = console.warn;
  console.warn = () => undefined;
  try {
    let response: Response | null = null;
    for (let index = 0; index < 21; index += 1) {
      response = await POST(request({ event: "route_error", message: `Safe failure ${index}` }));
    }
    assert.equal(response?.status, 429);
    assert.match(response?.headers.get("retry-after") ?? "", /^\d+$/);
  } finally {
    console.warn = original;
    disablePublicRateLimitTestStorage();
  }
});

test("admin diagnostics are bounded private and do not select sensitive audit fields", () => {
  const route = readFileSync(path.join(root, "src/app/api/admin/diagnostics/route.ts"), "utf8");
  assert.match(route, /requireUser\(\)/);
  assert.match(route, /requireAdmin\(user\)/);
  assert.match(route, /privateOk/);
  assert.match(route, /take:\s*50/);
  assert.match(route, /select:\s*\{\s*action:\s*true,\s*entityType:\s*true,\s*createdAt:\s*true\s*\}/s);
  assert.doesNotMatch(route, /actorEmail:\s*true|metadata:\s*true|summary:\s*true|entityId:\s*true/);
});
