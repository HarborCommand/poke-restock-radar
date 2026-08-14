import { requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { prisma } from "@/lib/db";
import { badRequest, ok, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type InventoryLocation = "IN_STORE" | "WAREHOUSE";

type LocationRow = {
  inventoryItemId: string;
  location: string;
};

let locationTableReady: Promise<void> | null = null;

async function ensureInventoryLocationTable() {
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

function normalizeLocation(value: unknown): InventoryLocation | null {
  return value === "IN_STORE" || value === "WAREHOUSE" ? value : null;
}

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;

  await ensureInventoryLocationTable();

  const [items, rows] = await Promise.all([
    prisma.inventoryItem.findMany({
      select: {
        id: true,
        itemName: true,
        publicTitle: true,
        quantity: true,
        category: true,
        setName: true,
        imageUrl: true,
        upc: true,
        sku: true
      },
      orderBy: [{ itemName: "asc" }, { createdAt: "desc" }]
    }),
    prisma.$queryRawUnsafe<LocationRow[]>(
      `SELECT "inventoryItemId", "location" FROM "InventoryPhysicalLocation"`
    )
  ]);

  const locationById = new Map(rows.map((row) => [row.inventoryItemId, normalizeLocation(row.location) ?? "IN_STORE"]));

  return ok({
    items: items.map((item) => ({
      ...item,
      location: locationById.get(item.id) ?? "IN_STORE"
    }))
  });
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;

  try {
    await ensureInventoryLocationTable();
    const payload = await readJson(request);
    const body = payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
    const inventoryItemId = String(body.inventoryItemId || "").trim();
    const location = normalizeLocation(body.location);

    if (!inventoryItemId) throw new Error("Inventory item is required.");
    if (!location) throw new Error("Choose In Store or Warehouse.");

    const item = await prisma.inventoryItem.findUnique({
      where: { id: inventoryItemId },
      select: { id: true, itemName: true }
    });
    if (!item) throw new Error("Inventory item was not found.");

    await prisma.$executeRaw`
      INSERT INTO "InventoryPhysicalLocation" ("inventoryItemId", "location", "updatedAt")
      VALUES (${inventoryItemId}, ${location}, CURRENT_TIMESTAMP)
      ON CONFLICT ("inventoryItemId")
      DO UPDATE SET "location" = EXCLUDED."location", "updatedAt" = CURRENT_TIMESTAMP
    `;

    return ok({
      item: {
        id: item.id,
        itemName: item.itemName,
        location
      }
    });
  } catch (error) {
    return badRequest(error);
  }
}
