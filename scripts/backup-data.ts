import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "@/lib/db";
import { exportBackup } from "@/lib/radar-service";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const outputPath = resolve(process.argv[2] || `backups/poke-restock-radar-${timestamp()}.json`);
  const backup = await exportBackup();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(backup, null, 2)}\n`, "utf8");
  console.log(`JSON backup written to ${outputPath}`);
  console.log("Keep this file private. It includes users, alert settings, and push subscription metadata.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
