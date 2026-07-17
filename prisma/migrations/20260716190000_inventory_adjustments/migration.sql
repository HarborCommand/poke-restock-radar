CREATE TABLE "InventoryAdjustment" (
  "id" TEXT NOT NULL,
  "inventoryItemId" TEXT NOT NULL,
  "userId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "quantityBefore" INTEGER NOT NULL,
  "quantityAfter" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "unitCostCents" INTEGER,
  "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryAdjustment_idempotencyKey_key" ON "InventoryAdjustment"("idempotencyKey");
CREATE INDEX "InventoryAdjustment_inventoryItemId_idx" ON "InventoryAdjustment"("inventoryItemId");
CREATE INDEX "InventoryAdjustment_userId_idx" ON "InventoryAdjustment"("userId");
CREATE INDEX "InventoryAdjustment_action_idx" ON "InventoryAdjustment"("action");
CREATE INDEX "InventoryAdjustment_reason_idx" ON "InventoryAdjustment"("reason");
CREATE INDEX "InventoryAdjustment_createdAt_idx" ON "InventoryAdjustment"("createdAt");

ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
