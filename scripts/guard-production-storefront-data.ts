import { prisma } from "@/lib/db";
import {
  evaluateProductionStorefrontDataGuard,
  formatProductionStorefrontDataGuardResult
} from "@/lib/production-storefront-data-guard";

function countFromRow(row: { count: bigint | number | string } | undefined) {
  return Number(row?.count ?? 0);
}

async function main() {
  const shouldRun = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (!shouldRun) {
    console.log("Production storefront data guard skipped outside production.");
    return;
  }

  const [productRows, adminRows] = await Promise.all([
    prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
      SELECT COUNT(*) AS "count"
      FROM "InventoryItem"
      WHERE "publishToStore" = true
        AND "publicSlug" IS NOT NULL
        AND "storeStatus" IN ('active', 'sold_out')
    `,
    prisma.$queryRaw<Array<{ count: bigint | number | string }>>`
      SELECT COUNT(*) AS "count"
      FROM "User"
      WHERE "role" = 'ADMIN'
    `
  ]);

  const publicProductCount = countFromRow(productRows[0]);
  const adminUserCount = countFromRow(adminRows[0]);
  const result = evaluateProductionStorefrontDataGuard({
    publicProductCount,
    adminUserCount
  });

  console.log(`Production storefront data guard checked ${publicProductCount} public products and ${adminUserCount} admin users.`);
  const formatted = formatProductionStorefrontDataGuardResult(result);
  if (formatted) console.log(formatted);

  if (!result.ok) {
    throw new Error(
      [
        "Production storefront data guard failed.",
        "Expected the standalone GameDayGrabs poke_restock_radar_prod database.",
        "Do not use database URLs from unrelated apps, preview, QA, or empty databases for this project.",
        formatted
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  console.log("Production storefront data guard passed.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
