import assert from "node:assert/strict";
import test from "node:test";
import {
  formatProductionDatabaseGuardResult,
  validateProductionDatabaseConfig
} from "../src/lib/production-database-guard";

test("production database guard accepts the expected production database", () => {
  const result = validateProductionDatabaseConfig({
    VERCEL_ENV: "production",
    DATABASE_URL:
      "postgresql://poke_restock_radar_owner:secret@ep-ancient-smoke-aphe97bg-pooler.c-7.us-east-1.aws.neon.tech/poke_restock_radar_prod?sslmode=require",
    DATABASE_URL_UNPOOLED:
      "postgresql://poke_restock_radar_owner:secret@ep-ancient-smoke-aphe97bg.c-7.us-east-1.aws.neon.tech/poke_restock_radar_prod?sslmode=require"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test("production database guard rejects preview database targets", () => {
  const result = validateProductionDatabaseConfig({
    VERCEL_ENV: "production",
    DATABASE_URL:
      "postgresql://poke_radar_preview_owner:secret@ep-broad-recipe-atmfu4uu-pooler.c-9.us-east-1.aws.neon.tech/poke_radar_preview?sslmode=require"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /preview\/test database target/i);
  assert.match(result.errors.join("\n"), /expected poke_restock_radar_prod/i);
});

test("production database guard rejects empty or PR databases in production", () => {
  const result = validateProductionDatabaseConfig({
    VERCEL_ENV: "production",
    DATABASE_URL:
      "postgresql://owner:secret@ep-damp-star-atiwwh71-pooler.c-7.us-east-1.aws.neon.tech/pr89_empty_20260716?sslmode=require"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /preview\/test database target/i);
});

test("production database guard rejects unrelated Quickz or Harbor Command database targets", () => {
  const result = validateProductionDatabaseConfig({
    VERCEL_ENV: "production",
    DATABASE_URL:
      "postgresql://quickz_owner:secret@ep-quickz-example-pooler.c-7.us-east-1.aws.neon.tech/quickz_prod?sslmode=require",
    DATABASE_URL_UNPOOLED:
      "postgresql://harbor_command_owner:secret@ep-harbor-example.c-7.us-east-1.aws.neon.tech/harbor_command_prod?sslmode=require"
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /preview\/test database target/i);
  assert.match(result.errors.join("\n"), /quickz/i);
  assert.match(result.errors.join("\n"), /harbor_command/i);
});

test("production database guard output redacts passwords", () => {
  const result = validateProductionDatabaseConfig({
    VERCEL_ENV: "production",
    DATABASE_URL:
      "postgresql://poke_radar_preview_owner:super-secret-password@ep-broad-recipe-atmfu4uu-pooler.c-9.us-east-1.aws.neon.tech/poke_radar_preview?sslmode=require"
  });
  const formatted = formatProductionDatabaseGuardResult(result);

  assert.doesNotMatch(formatted, /super-secret-password/);
  assert.match(formatted, /poke_radar_preview_owner@ep-broad-recipe/);
});

test("production database guard skips outside production", () => {
  const result = validateProductionDatabaseConfig({
    VERCEL_ENV: "preview",
    DATABASE_URL: "file:./prisma/dev.db"
  });

  assert.equal(result.shouldRun, false);
  assert.equal(result.ok, true);
});
