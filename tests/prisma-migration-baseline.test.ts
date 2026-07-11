import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Postgres baseline repair stays isolated and guarded", async () => {
  const [manifestSource, verifier, workflow, documentation, attributes] = await Promise.all([
    readFile("prisma/baseline/20260711_postgres_baseline.json", "utf8"),
    readFile("scripts/verify-prisma-postgres-baseline.ts", "utf8"),
    readFile(".github/workflows/prisma-baseline-bootstrap.yml", "utf8"),
    readFile("docs/prisma-migration-baseline-repair.md", "utf8"),
    readFile(".gitattributes", "utf8")
  ]);
  const manifest = JSON.parse(manifestSource) as { absorbedMigrations: string[]; sha256: string };

  assert.equal(manifest.absorbedMigrations.length, 25);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.match(verifier, /ci-disposable-empty-database/);
  assert.match(verifier, /poke_radar_baseline_ci/);
  assert.match(verifier, /VERCEL_ENV === "production"/);
  assert.match(verifier, /baseline target must be an empty database/);
  assert.match(workflow, /postgres:16-alpine/);
  assert.match(workflow, /npm run prisma:baseline:verify/);
  assert.match(documentation, /does not change the active `prisma\/migrations` history/);
  assert.match(documentation, /No `prisma db push` against Production/);
  assert.match(attributes, /prisma\/baseline\/\*\.sql text eol=lf/);
});
