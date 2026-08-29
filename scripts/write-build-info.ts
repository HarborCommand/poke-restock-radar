import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outputPath = join(root, "src", "generated", "build-info.ts");
const serviceWorkerVersion = "poke-radar-sw-2026-08-29-pos-bottom-clearance-v1";

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : "";
}

function gitValue(args: string[]) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

const commitSha =
  envValue("SOURCE_COMMIT_SHA") ||
  envValue("VERCEL_GIT_COMMIT_SHA") ||
  envValue("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA") ||
  gitValue(["rev-parse", "HEAD"]);
const deployId = envValue("VERCEL_DEPLOYMENT_ID") || envValue("NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID") || envValue("VERCEL_URL");
const buildTimestamp = new Date().toISOString();

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `export const BUILD_INFO = ${JSON.stringify(
    {
      commitSha: commitSha || "unknown",
      commitShort: commitSha ? commitSha.slice(0, 12) : "unknown",
      deployId: deployId || null,
      buildTimestamp,
      serviceWorkerVersion
    },
    null,
    2
  )} as const;\n`,
  "utf8"
);
