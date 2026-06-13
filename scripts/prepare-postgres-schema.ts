import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourcePath = resolve("prisma/schema.prisma");
const outputPath = resolve(".prisma-postgres/schema.prisma");
const migrationsSourcePath = resolve("prisma/migrations");
const migrationsOutputPath = resolve(".prisma-postgres/migrations");

async function main() {
  const source = await readFile(sourcePath, "utf8");
  if (!source.includes('provider = "sqlite"')) {
    throw new Error("Expected prisma/schema.prisma to use the local SQLite provider.");
  }

  const postgresSchema = source.replace('provider = "sqlite"', 'provider = "postgresql"');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `// Generated from prisma/schema.prisma for production Postgres.\n// Do not edit directly; run npm run prisma:postgres.\n\n${postgresSchema}`,
    "utf8"
  );
  await rm(migrationsOutputPath, { force: true, recursive: true });
  await cp(migrationsSourcePath, migrationsOutputPath, { recursive: true });
  console.log(`Prepared Postgres Prisma schema at ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
