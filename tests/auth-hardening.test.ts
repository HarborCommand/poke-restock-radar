import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { AuthOriginError, assertSameOriginRequest, safeAuthBaseUrl } from "../src/lib/auth-origin";
import { createSessionToken, verifySessionToken } from "../src/lib/auth";
import {
  checkPublicRateLimit,
  disablePublicRateLimitTestStorage,
  enablePublicRateLimitTestStorage,
  publicRateLimitRules,
  publicRateLimitTestRecords,
  PublicRateLimitExceededError
} from "../src/lib/rate-limit";
import type { SessionUser } from "../src/types/radar";

const projectRoot = process.cwd();
const readProjectFile = (file: string) => fs.readFileSync(path.join(projectRoot, file), "utf8");

const adminUser: SessionUser = {
  id: "admin-auth-test",
  email: "admin@example.test",
  name: "Admin",
  role: "ADMIN",
  canAddSightings: true,
  canAddComps: true,
  canRunChecks: true,
  canReceivePushAlerts: true,
  sessionVersion: 3
};

test("authentication mutations reject cross-site origins", () => {
  assert.doesNotThrow(() =>
    assertSameOriginRequest(
      new Request("https://preview.example.test/api/auth/login", {
        method: "POST",
        headers: { origin: "https://preview.example.test", "sec-fetch-site": "same-origin" }
      })
    )
  );
  assert.throws(
    () =>
      assertSameOriginRequest(
        new Request("https://preview.example.test/api/auth/login", {
          method: "POST",
          headers: { origin: "https://attacker.example", "sec-fetch-site": "cross-site" }
        })
      ),
    AuthOriginError
  );
  assert.doesNotThrow(() =>
    assertSameOriginRequest(
      new Request("https://preview.example.test/api/auth/login", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" }
      })
    )
  );
  assert.throws(
    () => assertSameOriginRequest(new Request("https://preview.example.test/api/auth/login", { method: "POST" })),
    AuthOriginError
  );
  assert.throws(
    () =>
      assertSameOriginRequest(
        new Request("https://preview.example.test/api/auth/login", {
          method: "POST",
          headers: { referer: "https://attacker.example/login" }
        })
      ),
    AuthOriginError
  );
});

test("authentication links use a configured origin without preserving injected paths", () => {
  const mutableEnv = process.env as Record<string, string | undefined>;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousStoreBaseUrl = process.env.STORE_BASE_URL;
  const previousAppUrl = process.env.APP_URL;
  try {
    mutableEnv.NODE_ENV = "production";
    process.env.APP_URL = "https://admin.gamedaygrabs.com/private/path";
    process.env.STORE_BASE_URL = "https://www.gamedaygrabs.com/untrusted/path?next=bad";
    assert.equal(safeAuthBaseUrl("https://attacker.example/reset"), "https://admin.gamedaygrabs.com");
    assert.equal(safeAuthBaseUrl("https://attacker.example/reset", "store"), "https://www.gamedaygrabs.com");
    process.env.APP_URL = "";
    process.env.STORE_BASE_URL = "http://www.gamedaygrabs.com";
    assert.throws(() => safeAuthBaseUrl(), /must use HTTPS/);
  } finally {
    if (previousNodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previousNodeEnv;
    if (previousStoreBaseUrl === undefined) delete process.env.STORE_BASE_URL;
    else process.env.STORE_BASE_URL = previousStoreBaseUrl;
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});

test("admin session tokens rotate and omit email and role claims", () => {
  const first = createSessionToken(adminUser);
  const second = createSessionToken(adminUser);
  assert.notEqual(first, second);
  assert.ok(verifySessionToken(first));
  assert.ok(verifySessionToken(second));
  const payload = JSON.parse(Buffer.from(first.split(".")[0]!, "base64url").toString("utf8"));
  assert.equal(payload.email, undefined);
  assert.equal(payload.role, undefined);
  assert.equal(typeof payload.jti, "string");
  assert.equal(typeof payload.iat, "number");
  assert.equal(verifySessionToken(`${first}tampered`), null);
  assert.equal(verifySessionToken(`${first}.extra`), null);
});

test("admin rate limit normalizes email casing and whitespace", async () => {
  enablePublicRateLimitTestStorage(() => new Date("2026-07-11T12:00:00.000Z"));
  const request = new Request("https://preview.example.test/api/auth/login", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.69" }
  });
  try {
    for (const email of [
      " Admin@Example.Test ",
      "admin@example.test",
      "ADMIN@EXAMPLE.TEST",
      "  admin@example.test  ",
      "Admin@Example.Test"
    ]) {
      await checkPublicRateLimit({ request, action: "admin_login", identifiers: [{ scope: "email", value: email }] });
    }
    await assert.rejects(
      () => checkPublicRateLimit({
        request,
        action: "admin_login",
        identifiers: [{ scope: "email", value: "admin@example.test" }]
      }),
      PublicRateLimitExceededError
    );
    const emailRecords = publicRateLimitTestRecords().filter((record) => record.scope === "email");
    assert.equal(emailRecords.length, 1);
    assert.equal(emailRecords[0]?.attemptCount, 6);
  } finally {
    disablePublicRateLimitTestStorage();
  }
});

test("admin authentication routes apply rate limits origin checks and generic responses", () => {
  for (const action of ["admin_login", "admin_forgot_password", "admin_reset_password", "admin_invite_accept"] as const) {
    assert.ok(publicRateLimitRules[action].length >= 2);
  }

  const login = readProjectFile("src/app/api/auth/login/route.ts");
  const forgot = readProjectFile("src/app/api/auth/forgot-password/route.ts");
  const reset = readProjectFile("src/app/api/auth/reset-password/route.ts");
  const invite = readProjectFile("src/app/api/auth/invite/accept/route.ts");
  const combined = [login, forgot, reset, invite].join("\n");
  assert.match(combined, /assertSameOriginRequest\(request\)/);
  assert.match(combined, /checkPublicRateLimit/);
  assert.match(login, /adminDummyPasswordHash/);
  assert.match(login, /bcrypt\.compare\(input\.password, user\?\.passwordHash \?\? adminDummyPasswordHash\)/);
  assert.doesNotMatch(login, /This private account is disabled/);
  assert.doesNotMatch(forgot, /emailConfigured/);
  assert.match(combined, /privateJson|withPrivateNoStore/);
});

test("forgot password form keeps a stable form reference across async submission", () => {
  const app = readProjectFile("src/components/RadarApp.tsx");
  const forgotHandlerStart = app.indexOf("async function handleForgotPassword");
  const forgotHandlerEnd = app.indexOf("async function handleResetPassword");
  const forgotHandler = app.slice(forgotHandlerStart, forgotHandlerEnd);

  assert.match(forgotHandler, /const form = event\.currentTarget;/);
  assert.match(forgotHandler, /const payload = formJson\(form\);/);
  assert.match(forgotHandler, /body: JSON\.stringify\(payload\)/);
  assert.match(forgotHandler, /form\.reset\(\);/);
  assert.doesNotMatch(forgotHandler, /await[\s\S]*event\.currentTarget\.reset\(\)/);
});

test("one-time authentication records are invalidated on reissue and atomically claimed", () => {
  const customerAuth = readProjectFile("src/lib/customer-account-auth.ts");
  const adminReset = readProjectFile("src/lib/password-reset.ts");
  const invite = readProjectFile("src/lib/access.ts");

  assert.match(customerAuth, /customerMagicLinkToken\.updateMany[\s\S]*usedAt: now/);
  assert.match(customerAuth, /customerPasswordResetToken\.updateMany[\s\S]*usedAt: now/);
  assert.match(customerAuth, /claimed\.count !== 1/);
  assert.match(customerAuth, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(customerAuth, /const parts = token\.split\("\."\);[\s\S]*parts\.length !== 2/);
  assert.match(adminReset, /passwordResetToken\.updateMany[\s\S]*expiresAt: \{ gt: now \}/);
  assert.match(adminReset, /claimed\.count !== 1/);
  assert.match(invite, /friendInvite\.updateMany[\s\S]*acceptedAt: null[\s\S]*expiresAt: \{ gt: acceptedAt \}/);
});

test("authentication cookies stay host-only secure and high priority", () => {
  const adminAuth = readProjectFile("src/lib/auth.ts");
  const customerAuth = readProjectFile("src/lib/customer-account-auth.ts");
  for (const source of [adminAuth, customerAuth]) {
    assert.match(source, /httpOnly: true/);
    assert.match(source, /sameSite: "lax"/);
    assert.match(source, /secure: process\.env\.NODE_ENV === "production"/);
    assert.match(source, /path: "\/"/);
    assert.match(source, /priority: "high"/);
  }
  assert.match(adminAuth, /__Host-poke_radar_session/);
  assert.match(customerAuth, /__Host-gdg_customer_session/);
});

test("authentication sources do not log or return raw credential material", () => {
  const sources = [
    "src/app/api/auth/login/route.ts",
    "src/app/api/auth/forgot-password/route.ts",
    "src/app/api/auth/reset-password/route.ts",
    "src/lib/password-reset.ts",
    "src/lib/customer-account-auth.ts"
  ].map(readProjectFile).join("\n");
  assert.doesNotMatch(sources, /console\.(log|error)\([^)]*(password|token|secret|hash)/i);
  assert.doesNotMatch(sources, /summary:\s*`[^`]*\$\{normalizedEmail\}/);
  assert.doesNotMatch(sources, /emailConfigured:\s*result\.emailSent/);
});
