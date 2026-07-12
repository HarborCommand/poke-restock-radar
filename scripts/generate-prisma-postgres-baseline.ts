import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const schemaPath = ".prisma-postgres/schema.prisma";
const outputPath = resolve("prisma/baseline/20260711_initial_postgres.sql");
const checkOnly = process.argv.includes("--check");
const require = createRequire(import.meta.url);
const prismaCli = require.resolve("prisma/build/index.js");

function generateSql() {
  const result = spawnSync(
    process.execPath,
    [
      prismaCli,
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      schemaPath,
      "--script"
    ],
    { encoding: "utf8", env: process.env }
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.error?.message || "Prisma baseline generation failed.");
  }

  const sql = result.stdout.trim();
  for (const table of ["User", "InventoryItem", "StorefrontOrder", "CustomerAccount", "RewardLedgerEntry"]) {
    if (!sql.includes(`CREATE TABLE \"${table}\"`)) {
      throw new Error(`Generated baseline is missing required table ${table}.`);
    }
  }

  return [
    "-- Frozen Postgres schema baseline generated from commit 8834156cec16e1d2173441e74eb35f7ce3ce829b.",
    "-- This file is not an active Prisma migration and must never be executed against an existing database.",
    "-- Generate only for an owner-reviewed baseline cutover; normal schema changes require additive migrations.",
    "",
    sql,
    ""
  ].join("\n");
}

async function main() {
  const generated = generateSql();

  if (checkOnly) {
    const existing = await readFile(outputPath, "utf8");
    if (existing !== generated) {
      throw new Error("The checked-in Postgres baseline does not match the current baseline generator output.");
    }
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, generated, "utf8");
  }

  const digest = createHash("sha256").update(generated).digest("hex");
  console.log(`${checkOnly ? "Verified" : "Generated"} frozen Postgres baseline (${digest.slice(0, 12)}...).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
