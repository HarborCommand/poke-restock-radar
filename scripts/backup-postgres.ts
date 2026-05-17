import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function postgresUrl() {
  const url = process.env.POSTGRES_BACKUP_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url || !url.startsWith("postgres")) {
    throw new Error("Set POSTGRES_BACKUP_URL, DATABASE_URL_UNPOOLED, or DATABASE_URL to an unpooled Postgres URL.");
  }
  if (url.includes("-pooler.")) {
    throw new Error("Use an unpooled Neon URL for pg_dump. Set DATABASE_URL_UNPOOLED or POSTGRES_BACKUP_URL.");
  }
  return url;
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function main() {
  const outputPath = resolve(process.argv[2] || `backups/poke-restock-radar-${timestamp()}.dump`);
  await mkdir(dirname(outputPath), { recursive: true });
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", outputPath, postgresUrl()]);
  console.log(`Postgres backup written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
