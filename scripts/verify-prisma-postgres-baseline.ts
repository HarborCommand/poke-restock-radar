import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type BaselineManifest = {
  name: string;
  sqlFile: string;
  sha256: string;
  absorbedMigrations: string[];
};

const schemaPath = ".prisma-postgres/schema.prisma";
const manifestPath = resolve("prisma/baseline/20260711_postgres_baseline.json");
const migrationsPath = resolve("prisma/migrations");
const confirmation = "ci-disposable-empty-database";
const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma/build/index.js");

function redact(output: string) {
  return output
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted database url]")
    .replace(
      /Datasource \"db\": PostgreSQL database \"[^\"]+\", schema \"[^\"]+\" at \"[^\"]+\"/g,
      "Datasource \"db\": PostgreSQL database [redacted]"
    );
}

function runPrisma(args: string[], allowedStatuses = [0]) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    encoding: "utf8",
    env: process.env
  });
  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
  const status = result.status ?? 1;

  if (!allowedStatuses.includes(status)) {
    throw new Error(`prisma ${args.join(" ")} failed:\n${redact(output)}`);
  }

  if (output.trim()) {
    console.log(redact(output.trim()));
  }

  return { output, status };
}

function assertDisposableTarget() {
  if (process.env.PRISMA_BASELINE_BOOTSTRAP_CONFIRM !== confirmation) {
    throw new Error(`Set PRISMA_BASELINE_BOOTSTRAP_CONFIRM=${confirmation}.`);
  }
  if (process.env.CI !== "true" || process.env.NODE_ENV !== "test") {
    throw new Error("Baseline verification is restricted to CI test environments.");
  }
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Baseline verification is forbidden in Vercel Production.");
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error("DATABASE_URL is required for the disposable baseline test database.");
  }

  const databaseUrl = new URL(rawUrl);
  if (!['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname)) {
    throw new Error("Baseline verification only accepts a local disposable Postgres host.");
  }
  if (databaseUrl.pathname.replace(/^\//, "") !== "poke_radar_baseline_ci") {
    throw new Error("Baseline verification requires the exact database name poke_radar_baseline_ci.");
  }
}

async function executeSql(sql: string) {
  const directory = await mkdtemp(join(tmpdir(), "poke-radar-baseline-"));
  const file = join(directory, "check.sql");
  try {
    await writeFile(file, sql, "utf8");
    runPrisma(["db", "execute", "--schema", schemaPath, "--file", file]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function main() {
  assertDisposableTarget();

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BaselineManifest;
  const baselinePath = resolve(manifest.sqlFile);
  const baselineSql = await readFile(baselinePath, "utf8");
  const digest = createHash("sha256").update(baselineSql).digest("hex");
  if (digest !== manifest.sha256) {
    throw new Error("Baseline SQL checksum does not match the reviewed manifest.");
  }

  const migrationDirectories = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const missingAbsorbed = manifest.absorbedMigrations.filter((name) => !migrationDirectories.includes(name));
  if (missingAbsorbed.length > 0) {
    throw new Error(`Reviewed migrations are missing from prisma/migrations: ${missingAbsorbed.join(", ")}`);
  }

  await executeSql(`
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
  ) THEN
    RAISE EXCEPTION 'baseline target must be an empty database';
  END IF;
END $$;
`);

  runPrisma(["db", "execute", "--schema", schemaPath, "--file", baselinePath]);
  for (const migration of manifest.absorbedMigrations) {
    runPrisma(["migrate", "resolve", "--applied", migration, "--schema", schemaPath]);
  }

  runPrisma(["migrate", "deploy", "--schema", schemaPath]);
  const status = runPrisma(["migrate", "status", "--schema", schemaPath]);
  if (!/Database schema is up to date/i.test(status.output)) {
    throw new Error("Prisma did not report an up-to-date baseline database.");
  }

  const diff = runPrisma([
    "migrate",
    "diff",
    "--from-schema-datasource",
    schemaPath,
    "--to-schema-datamodel",
    schemaPath,
    "--exit-code"
  ], [0, 2]);
  if (diff.status !== 0) {
    throw new Error("Bootstrapped database differs from the current Postgres Prisma schema.");
  }

  console.log(`Verified ${manifest.name} against an empty disposable Postgres database.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
