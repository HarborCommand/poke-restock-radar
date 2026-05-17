import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { importBackup } from "@/lib/radar-service";

function usage() {
  return "Usage: npm run restore:json -- <backup-file.json> --yes";
}

async function main() {
  const args = process.argv.slice(2);
  const backupFile = args.find((arg) => !arg.startsWith("--"));
  const confirmed = args.includes("--yes");

  if (!backupFile) throw new Error(usage());
  if (!confirmed) {
    throw new Error(`Restore replaces all app data. Re-run with --yes to continue.\n${usage()}`);
  }

  const fullPath = resolve(backupFile);
  const payload = JSON.parse(await readFile(fullPath, "utf8")) as { tables?: Record<string, unknown[]> };
  if (!payload.tables || typeof payload.tables !== "object") {
    throw new Error("Backup file is missing a valid tables object.");
  }

  await importBackup({ tables: payload.tables });
  console.log(`JSON backup restored from ${fullPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
