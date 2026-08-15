import { prisma } from "@/lib/db";

export type InventoryPhysicalLocation = "IN_STORE" | "WAREHOUSE";

export type InventoryPhysicalLocationBalance = {
  inventoryItemId: string;
  onHandQuantity: number;
  inStoreQuantity: number;
  warehouseQuantity: number;
};

type LocationRow = {
  inventoryItemId: string;
  location: string;
  inStoreQuantity: number | null;
  warehouseQuantity: number | null;
};

let locationTableReady: Promise<void> | null = null;

export function normalizeInventoryPhysicalLocation(value: unknown): InventoryPhysicalLocation | null {
  return value === "IN_STORE" || value === "WAREHOUSE" ? value : null;
}

function normalizeQuantity(value: unknown) {
  const quantity = Math.floor(Number(value) || 0);
  return Math.max(0, quantity);
}

function compatibilityLocation(inStoreQuantity: number, warehouseQuantity: number): InventoryPhysicalLocation {
  return warehouseQuantity > 0 && inStoreQuantity <= 0 ? "WAREHOUSE" : "IN_STORE";
}

export async function ensureInventoryPhysicalLocationTable() {
  locationTableReady ??= (async () => {
    const databaseUrl = process.env.DATABASE_URL || "";
    const isSqlite = databaseUrl.startsWith("file:");
    const timestampType = isSqlite ? "DATETIME" : "TIMESTAMP(3)";

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "InventoryPhysicalLocation" (
        "inventoryItemId" TEXT NOT NULL PRIMARY KEY,
        "location" TEXT NOT NULL DEFAULT 'IN_STORE',
        "inStoreQuantity" INTEGER,
        "warehouseQuantity" INTEGER,
        "updatedAt" ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const existingColumnRows = isSqlite
      ? await prisma.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("InventoryPhysicalLocation")`)
      : await prisma.$queryRaw<Array<{ name: string }>>`
          SELECT column_name AS name
          FROM information_schema.columns
          WHERE table_name = 'InventoryPhysicalLocation'
        `;
    const existingColumns = new Set(existingColumnRows.map((row) => row.name));

    if (!existingColumns.has("inStoreQuantity")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "InventoryPhysicalLocation" ADD COLUMN "inStoreQuantity" INTEGER`);
    }
    if (!existingColumns.has("warehouseQuantity")) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "InventoryPhysicalLocation" ADD COLUMN "warehouseQuantity" INTEGER`);
    }

    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "InventoryPhysicalLocation_location_idx" ON "InventoryPhysicalLocation"("location")`
    );
  })().catch((error) => {
    locationTableReady = null;
    throw error;
  });

  await locationTableReady;
}

async function writeBalance(
  inventoryItemId: string,
  inStoreQuantity: number,
  warehouseQuantity: number
) {
  const normalizedInStore = normalizeQuantity(inStoreQuantity);
  const normalizedWarehouse = normalizeQuantity(warehouseQuantity);
  const location = compatibilityLocation(normalizedInStore, normalizedWarehouse);

  await prisma.$executeRaw`
    INSERT INTO "InventoryPhysicalLocation" (
      "inventoryItemId",
      "location",
      "inStoreQuantity",
      "warehouseQuantity",
      "updatedAt"
    )
    VALUES (${inventoryItemId}, ${location}, ${normalizedInStore}, ${normalizedWarehouse}, CURRENT_TIMESTAMP)
    ON CONFLICT ("inventoryItemId")
    DO UPDATE SET
      "location" = EXCLUDED."location",
      "inStoreQuantity" = EXCLUDED."inStoreQuantity",
      "warehouseQuantity" = EXCLUDED."warehouseQuantity",
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

function reconcileRow(row: LocationRow | undefined, onHandQuantity: number) {
  const onHand = normalizeQuantity(onHandQuantity);
  const legacyLocation = normalizeInventoryPhysicalLocation(row?.location) ?? "IN_STORE";

  let inStoreQuantity: number;
  let warehouseQuantity: number;

  if (!row || row.inStoreQuantity === null || row.warehouseQuantity === null) {
    inStoreQuantity = legacyLocation === "IN_STORE" ? onHand : 0;
    warehouseQuantity = legacyLocation === "WAREHOUSE" ? onHand : 0;
  } else {
    inStoreQuantity = normalizeQuantity(row.inStoreQuantity);
    warehouseQuantity = normalizeQuantity(row.warehouseQuantity);
  }

  const allocated = inStoreQuantity + warehouseQuantity;
  if (allocated < onHand) {
    const missing = onHand - allocated;
    if (legacyLocation === "WAREHOUSE" && inStoreQuantity === 0) warehouseQuantity += missing;
    else inStoreQuantity += missing;
  } else if (allocated > onHand) {
    let excess = allocated - onHand;
    const warehouseReduction = Math.min(warehouseQuantity, excess);
    warehouseQuantity -= warehouseReduction;
    excess -= warehouseReduction;
    if (excess > 0) inStoreQuantity = Math.max(0, inStoreQuantity - excess);
  }

  return {
    inventoryItemId: row?.inventoryItemId ?? "",
    onHandQuantity: onHand,
    inStoreQuantity,
    warehouseQuantity
  };
}

export async function getInventoryPhysicalLocationBalance(
  inventoryItemId: string,
  onHandQuantity: number
): Promise<InventoryPhysicalLocationBalance> {
  await ensureInventoryPhysicalLocationTable();
  const rows = await prisma.$queryRawUnsafe<LocationRow[]>(
    `SELECT "inventoryItemId", "location", "inStoreQuantity", "warehouseQuantity"
     FROM "InventoryPhysicalLocation"
     WHERE "inventoryItemId" = $1`,
    inventoryItemId
  ).catch(async () => {
    return prisma.$queryRaw<LocationRow[]>`
      SELECT "inventoryItemId", "location", "inStoreQuantity", "warehouseQuantity"
      FROM "InventoryPhysicalLocation"
      WHERE "inventoryItemId" = ${inventoryItemId}
    `;
  });

  const row = rows[0];
  const balance = reconcileRow(row, onHandQuantity);
  balance.inventoryItemId = inventoryItemId;

  if (
    !row ||
    normalizeQuantity(row.inStoreQuantity) !== balance.inStoreQuantity ||
    normalizeQuantity(row.warehouseQuantity) !== balance.warehouseQuantity
  ) {
    await writeBalance(inventoryItemId, balance.inStoreQuantity, balance.warehouseQuantity);
  }

  return balance;
}

export async function listInventoryPhysicalLocationBalances(
  items: Array<{ id: string; onHandQuantity: number }>
): Promise<InventoryPhysicalLocationBalance[]> {
  await ensureInventoryPhysicalLocationTable();
  const rows = await prisma.$queryRawUnsafe<LocationRow[]>(
    `SELECT "inventoryItemId", "location", "inStoreQuantity", "warehouseQuantity" FROM "InventoryPhysicalLocation"`
  );
  const rowById = new Map(rows.map((row) => [row.inventoryItemId, row]));

  const balances = items.map((item) => {
    const row = rowById.get(item.id);
    const balance = reconcileRow(row, item.onHandQuantity);
    balance.inventoryItemId = item.id;
    return { row, balance };
  });

  await Promise.all(
    balances
      .filter(({ row, balance }) =>
        !row ||
        normalizeQuantity(row.inStoreQuantity) !== balance.inStoreQuantity ||
        normalizeQuantity(row.warehouseQuantity) !== balance.warehouseQuantity
      )
      .map(({ balance }) => writeBalance(balance.inventoryItemId, balance.inStoreQuantity, balance.warehouseQuantity))
  );

  return balances.map(({ balance }) => balance);
}

export async function addInventoryPhysicalQuantity(
  inventoryItemId: string,
  location: InventoryPhysicalLocation,
  quantity: number,
  onHandQuantityAfter: number
) {
  const addedQuantity = normalizeQuantity(quantity);
  const baseOnHand = Math.max(0, normalizeQuantity(onHandQuantityAfter) - addedQuantity);
  const balance = await getInventoryPhysicalLocationBalance(inventoryItemId, baseOnHand);

  if (location === "IN_STORE") balance.inStoreQuantity += addedQuantity;
  else balance.warehouseQuantity += addedQuantity;
  balance.onHandQuantity = normalizeQuantity(onHandQuantityAfter);

  await writeBalance(inventoryItemId, balance.inStoreQuantity, balance.warehouseQuantity);
  return balance;
}

export async function transferInventoryPhysicalQuantity(
  inventoryItemId: string,
  fromLocation: InventoryPhysicalLocation,
  toLocation: InventoryPhysicalLocation,
  quantity: number,
  onHandQuantity: number
) {
  if (fromLocation === toLocation) throw new Error("Choose a different destination location.");
  const moveQuantity = normalizeQuantity(quantity);
  if (moveQuantity <= 0) throw new Error("Choose at least 1 unit to move.");

  const balance = await getInventoryPhysicalLocationBalance(inventoryItemId, onHandQuantity);
  const available = fromLocation === "IN_STORE" ? balance.inStoreQuantity : balance.warehouseQuantity;
  if (moveQuantity > available) {
    const label = fromLocation === "IN_STORE" ? "In Store" : "Warehouse / Home";
    throw new Error(`Only ${available} unit${available === 1 ? " is" : "s are"} available in ${label}.`);
  }

  if (fromLocation === "IN_STORE") {
    balance.inStoreQuantity -= moveQuantity;
    balance.warehouseQuantity += moveQuantity;
  } else {
    balance.warehouseQuantity -= moveQuantity;
    balance.inStoreQuantity += moveQuantity;
  }

  await writeBalance(inventoryItemId, balance.inStoreQuantity, balance.warehouseQuantity);
  return balance;
}

export async function consumeInventoryPhysicalQuantity(
  inventoryItemId: string,
  location: InventoryPhysicalLocation,
  quantity: number,
  onHandQuantityBefore: number
) {
  const consumedQuantity = normalizeQuantity(quantity);
  if (consumedQuantity <= 0) return getInventoryPhysicalLocationBalance(inventoryItemId, onHandQuantityBefore);

  const balance = await getInventoryPhysicalLocationBalance(inventoryItemId, onHandQuantityBefore);
  const available = location === "IN_STORE" ? balance.inStoreQuantity : balance.warehouseQuantity;
  if (consumedQuantity > available) throw new Error("Not enough inventory is assigned to this location.");

  if (location === "IN_STORE") balance.inStoreQuantity -= consumedQuantity;
  else balance.warehouseQuantity -= consumedQuantity;
  balance.onHandQuantity = Math.max(0, balance.onHandQuantity - consumedQuantity);

  await writeBalance(inventoryItemId, balance.inStoreQuantity, balance.warehouseQuantity);
  return balance;
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
    `SELECT "inventoryItemId", "location", "inStoreQuantity", "warehouseQuantity" FROM "InventoryPhysicalLocation"`
  );
}
