import { prisma } from "@/lib/db";

export type InventoryPhysicalLocation = "IN_STORE" | "WAREHOUSE";

type LocationRow = {
  inventoryItemId: string;
  location: string;
};

let locationTableReady: Promise<void> | null = null;

export function normalizeInventoryPhysicalLocation(value: unknown): InventoryPhysicalLocation | null {
  return value === "IN_STORE" || value === "WAREHOUSE" ? value : null;
}

export async function ensureInventoryPhysicalLocationTable() {
  locationTableReady ??= (async () => {
    const databaseUrl = process.env.DATABASE_URL || "";
    const timestampType = databaseUrl.startsWith("file:") ? "DATETIME" : "TIMESTAMP(3)";

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "InventoryPhysicalLocation" (
        "inventoryItemId" TEXT NOT NULL PRIMARY KEY,
        "location" TEXT NOT NULL DEFAULT 'IN_STORE',
        "updatedAt" ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "InventoryPhysicalLocation_location_idx" ON "InventoryPhysicalLocation"("location")`
    );
  })().catch((error) => {
    locationTableReady = null;
    throw error;
  });

  await locationTableReady;
}

export async function setInventoryPhysicalLocation(
  inventoryItemId: string,
  location: InventoryPhysicalLocation
) {
  await ensureInventoryPhysicalLocationTable();
  await prisma.$executeRaw`
    INSERT INTO "InventoryPhysicalLocation" ("inventoryItemId", "location", "updatedAt")
    VALUES (${inventoryItemId}, ${location}, CURRENT_TIMESTAMP)
    ON CONFLICT ("inventoryItemId")
    DO UPDATE SET "location" = EXCLUDED."location", "updatedAt" = CURRENT_TIMESTAMP
  `;
}

export async function listInventoryPhysicalLocationRows() {
  await ensureInventoryPhysicalLocationTable();
  return prisma.$queryRawUnsafe<LocationRow[]>(
    `SELECT "inventoryItemId", "location" FROM "InventoryPhysicalLocation"`
  );
}
