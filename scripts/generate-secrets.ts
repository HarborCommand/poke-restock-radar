import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

function secret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

async function main() {
  const suppliedPassword = process.argv.find((arg) => arg.startsWith("--admin-password="))?.split("=")[1];
  const adminPassword = suppliedPassword || secret(18);
  const adminPasswordHash = await bcrypt.hash(adminPassword, 12);
  const monitorSecret = secret(32);

  console.log("# Generated private Poke Restock Radar secrets");
  console.log("# Do not reuse secrets or database URLs from any other app.");
  console.log(`AUTH_SECRET="${secret(48)}"`);
  console.log(`ADMIN_INVITE_SECRET="${secret(32)}"`);
  console.log(`MONITOR_JOB_SECRET="${monitorSecret}"`);
  console.log(`CRON_SECRET="${monitorSecret}"`);
  console.log(`ADMIN_PASSWORD="${adminPassword}"`);
  console.log(`ADMIN_PASSWORD_HASH="${adminPasswordHash}"`);
  console.log("");
  console.log("# Prefer ADMIN_PASSWORD_HASH in Vercel production and omit ADMIN_PASSWORD there.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
