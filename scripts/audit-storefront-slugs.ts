import { prisma } from "../src/lib/db";
import { auditStorefrontSlugs } from "../src/lib/storefront-slugs";

async function main() {
  const items = await prisma.inventoryItem.findMany({
    where: {
      publishToStore: true,
      publicSlug: { not: null }
    },
    select: {
      id: true,
      itemName: true,
      publicTitle: true,
      publicSlug: true,
      publishToStore: true,
      storeStatus: true
    },
    orderBy: [{ storeStatus: "asc" }, { itemName: "asc" }]
  });

  const rows = auditStorefrontSlugs(
    items.map((item) => ({
      id: item.id,
      title: item.publicTitle || item.itemName,
      publicSlug: item.publicSlug,
      publishToStore: item.publishToStore,
      storeStatus: item.storeStatus
    }))
  );
  const corrections = rows.filter((row) => row.needsCorrection || row.collision);

  console.log(
    JSON.stringify(
      {
        mode: "dry-run",
        writesPerformed: false,
        inspectedCount: rows.length,
        correctionCount: corrections.filter((row) => row.needsCorrection).length,
        collisionCount: corrections.filter((row) => row.collision).length,
        corrections: corrections.map((row) => ({
          id: row.id,
          title: row.title,
          currentSlug: row.publicSlug,
          proposedSlug: row.proposedSlug,
          storeStatus: row.storeStatus,
          collision: row.collision
        }))
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
