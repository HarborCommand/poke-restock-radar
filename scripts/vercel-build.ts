import { spawnSync } from "node:child_process";

function quoteForCmd(value: string) {
  return /^[A-Za-z0-9_./:=\\-]+$/.test(value) ? value : `"${value.replace(/"/g, '""')}"`;
}

function run(command: string, args: string[]) {
  const result =
    process.platform === "win32"
      ? spawnSync("cmd.exe", ["/d", "/s", "/c", [command, ...args].map(quoteForCmd).join(" ")], {
          env: process.env,
          stdio: "inherit"
        })
      : spawnSync(command, args, {
          env: process.env,
          stdio: "inherit"
        });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const vercelEnv = process.env.VERCEL_ENV ?? "development";
const databaseUrl = process.env.DATABASE_URL ?? "";
const usesPostgres = /^postgres(?:ql)?:\/\//i.test(databaseUrl);

if (vercelEnv === "production") {
  console.log("Running production Vercel build with Postgres migrations.");
  run("npm", ["run", "prisma:postgres"]);
  run("tsx", ["scripts/migrate-postgres-production.ts"]);
  run("prisma", ["generate", "--schema", ".prisma-postgres/schema.prisma"]);
} else if (usesPostgres) {
  console.log(`Running ${vercelEnv} Vercel build with Postgres Prisma client.`);
  run("npm", ["run", "prisma:postgres"]);
  run("prisma", ["generate", "--schema", ".prisma-postgres/schema.prisma"]);
} else {
  console.log(`Running ${vercelEnv} Vercel build without production migrations.`);
  run("prisma", ["generate"]);
}

run("next", ["build"]);
