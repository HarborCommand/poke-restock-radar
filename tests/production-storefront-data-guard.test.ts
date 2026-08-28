import assert from "node:assert/strict";
import test from "node:test";
import { evaluateProductionStorefrontDataGuard } from "../src/lib/production-storefront-data-guard";

test("production storefront data guard accepts a populated production catalog", () => {
  const result = evaluateProductionStorefrontDataGuard({
    publicProductCount: 8,
    adminUserCount: 1,
    env: { VERCEL_ENV: "production" }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("production storefront data guard rejects an empty public catalog", () => {
  const result = evaluateProductionStorefrontDataGuard({
    publicProductCount: 0,
    adminUserCount: 1,
    env: { VERCEL_ENV: "production" }
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /No public storefront products exist/);
});

test("production storefront data guard rejects missing admin users", () => {
  const result = evaluateProductionStorefrontDataGuard({
    publicProductCount: 3,
    adminUserCount: 0,
    env: { VERCEL_ENV: "production" }
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /No Admin users exist/);
});

test("production storefront data guard can be explicitly overridden for empty catalog recovery only", () => {
  const result = evaluateProductionStorefrontDataGuard({
    publicProductCount: 0,
    adminUserCount: 1,
    env: { VERCEL_ENV: "production", ALLOW_EMPTY_STOREFRONT_IN_PRODUCTION: "true" }
  });

  assert.equal(result.ok, true);
  assert.match(result.warnings.join("\n"), /ALLOW_EMPTY_STOREFRONT_IN_PRODUCTION=true/);
});

test("production storefront data guard skips outside production", () => {
  const result = evaluateProductionStorefrontDataGuard({
    publicProductCount: 0,
    adminUserCount: 0,
    env: { VERCEL_ENV: "preview" }
  });

  assert.equal(result.shouldRun, false);
  assert.equal(result.ok, true);
});
