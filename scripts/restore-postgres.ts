import "dotenv/config";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

function usage() {
  return "Usage: npm run restore:postgres -- <backup-file.dump> --yes";
}

function postgresUrl() {
  const url = process.env.POSTGRES_BACKUP_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url || !url.startsWith("postgres")) {
    throw new Error("Set POSTGRES_BACKUP_URL, DATABASE_URL_UNPOOLED, or DATABASE_URL to an unpooled Postgres URL.");
  }
  if (url.includes("-pooler.")) {
    throw new Error("Use an unpooled Neon URL for pg_restore. Set DATABASE_URL_UNPOOLED or POSTGRES_BACKUP_URL.");
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
  const args = process.argv.slice(2);
  const backupFile = args.find((arg) => !arg.startsWith("--"));
  const confirmed = args.includes("--yes");
  if (!backupFile) throw new Error(usage());
  if (!confirmed) {
    throw new Error(`Restore replaces database objects in the configured Postgres database. Re-run with --yes.\n${usage()}`);
  }

  await run("pg_restore", [
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-acl",
    "--dbname",
    postgresUrl(),
    resolve(backupFile)
  ]);
  console.log(`Postgres backup restored from ${resolve(backupFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
