import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDbDir = mkdtempSync(path.join(tmpdir(), "gdg-auth-hardening-"));
const testDbPath = path.join(testDbDir, "auth-hardening.sqlite");
process.env.DATABASE_URL = `file:${testDbPath}`;
process.env.CUSTOMER_ACCOUNTS_ENABLED = "true";
process.env.CUSTOMER_SESSION_TIMEOUTS_ENABLED = "true";
process.env.AUTH_SECRET = "local-auth-hardening-test-secret-with-at-least-32-characters";

execFileSync(process.execPath, [path.join(projectRoot, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], {
  cwd: projectRoot,
  env: { ...process.env, DATABASE_URL: `file:${testDbPath}` },
  stdio: "pipe"
});

const dbModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/db.ts")).href);
const authModule = await import(pathToFileURL(path.join(projectRoot, "src/lib/customer-account-auth.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const {
  hashCustomerMagicLinkToken,
  hashCustomerPasswordResetToken,
  resetCustomerPassword,
  verifyCustomerMagicLink
} = authModule as typeof import("../src/lib/customer-account-auth");

test.after(async () => {
  await prisma.$disconnect();
  rmSync(testDbDir, { recursive: true, force: true });
});

let sequence = 0;

async function createCustomer() {
  sequence += 1;
  const email = `auth-hardening-${sequence}@example.test`;
  return prisma.customerAccount.create({
    data: {
      email,
      normalizedEmail: email,
      status: "active",
      emailVerifiedAt: new Date()
    }
  });
}

test("customer magic links are atomically single-use and reject replay expiry and malformed values", async () => {
  const customer = await createCustomer();
  const token = "preview-magic-link-token";
  const record = await prisma.customerMagicLinkToken.create({
    data: {
      customerAccountId: customer.id,
      email: customer.email,
      tokenHash: hashCustomerMagicLinkToken(token),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    }
  });

  const [first, second] = await Promise.all([verifyCustomerMagicLink(token), verifyCustomerMagicLink(token)]);
  assert.equal([first, second].filter((result) => result.ok).length, 1);
  assert.equal([first, second].filter((result) => !result.ok && result.reason === "invalid").length, 1);
  assert.equal((await prisma.customerMagicLinkToken.findUniqueOrThrow({ where: { id: record.id } })).usedAt instanceof Date, true);
  assert.deepEqual(await verifyCustomerMagicLink(token), { ok: false, reason: "invalid", account: null });

  const expiredToken = "preview-expired-magic-link-token";
  await prisma.customerMagicLinkToken.create({
    data: {
      customerAccountId: customer.id,
      email: customer.email,
      tokenHash: hashCustomerMagicLinkToken(expiredToken),
      expiresAt: new Date(Date.now() - 1_000)
    }
  });
  assert.deepEqual(await verifyCustomerMagicLink(expiredToken), { ok: false, reason: "expired", account: null });
  assert.deepEqual(await verifyCustomerMagicLink("malformed"), { ok: false, reason: "invalid", account: null });
});

test("customer password reset consumes its token once and revokes prior sessions", async () => {
  const customer = await createCustomer();
  const token = "preview-password-reset-token";
  await prisma.customerPasswordResetToken.create({
    data: {
      customerAccountId: customer.id,
      tokenHash: hashCustomerPasswordResetToken(token),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    }
  });

  const first = await resetCustomerPassword({
    token,
    password: "Preview-only-password-123!",
    confirmPassword: "Preview-only-password-123!"
  });
  assert.equal(first.ok, true);
  const replay = await resetCustomerPassword({
    token,
    password: "Preview-only-password-456!",
    confirmPassword: "Preview-only-password-456!"
  });
  assert.deepEqual(replay, { ok: false, reason: "invalid", account: null });

  const updated = await prisma.customerAccount.findUniqueOrThrow({ where: { id: customer.id } });
  assert.ok(updated.passwordHash);
  assert.ok(updated.sessionRevokedBefore);
});
