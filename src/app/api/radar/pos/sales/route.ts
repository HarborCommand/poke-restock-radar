import { createHash } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { authorizePosMutation, resolvePosStoreUser } from "@/lib/pos-authorization";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import {
  listInventoryPhysicalLocationBalances
} from "@/lib/inventory-physical-location";
import { requestCorrelationId } from "@/lib/observability";
import { createPosSale, listDashboard, quotePosSaleTax } from "@/lib/radar-service";
import { parseSquarePaymentReference, verifySquarePosPayment, type VerifiedSquarePosPayment } from "@/lib/square-pos";
import { moneyToCents } from "@/lib/tax";
import { posSaleCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function saleReferenceForIdempotencyKey(userId: string, idempotencyKey: string) {
  const hash = createHash("sha256").update(`${userId}:${idempotencyKey.trim()}`).digest("hex").slice(0, 12).toUpperCase();
  return `POS-${hash}`;
}

export async function POST(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const authorizationResponse = authorizePosMutation(request, user);
  if (authorizationResponse) return withPrivateNoStore(withRequestId(authorizationResponse, requestId));

  try {
    const input = posSaleCreateSchema.parse(await readJson(request));
    const storeUser = await resolvePosStoreUser(user);
    let verifiedSquarePayment: VerifiedSquarePosPayment | null = null;

    if (input.paymentMethod === "external_card") {
      const transactionId = parseSquarePaymentReference(input.paymentReference);
      if (!transactionId) {
        throw new Error("Square card payments require a completed Square transaction before the POS sale can be completed.");
      }

      const squareReference = `square:${transactionId}`;
      input.paymentReference = squareReference;
      const intendedSaleReference = saleReferenceForIdempotencyKey(storeUser.id, input.idempotencyKey);
      const existingSquareUse = await prisma.inventorySale.findFirst({
        where: {
          userId: storeUser.id,
          paymentReference: squareReference
        },
        select: { saleReference: true }
      });
      if (existingSquareUse?.saleReference && existingSquareUse.saleReference !== intendedSaleReference) {
        throw new Error("This Square payment is already attached to another POS sale.");
      }

      // Recalculate the same cart on the server before trusting the Square callback.
      // createPosSale still validates the original signed tax quote afterward.
      const paymentQuote = await quotePosSaleTax(storeUser, {
        idempotencyKey: input.idempotencyKey,
        items: input.items,
        selectedCustomerAccountId: input.selectedCustomerAccountId,
        taxExempt: input.taxExempt,
        taxExemptReason: input.taxExemptReason,
        taxExemptionReference: input.taxExemptionReference
      });
      verifiedSquarePayment = await verifySquarePosPayment({
        transactionId,
        expectedAmountCents: moneyToCents(paymentQuote.total)
      });
    }

    const beforeDashboard = await listDashboard(storeUser);
    const beforeById = new Map(beforeDashboard.inventory.map((item) => [item.id, item]));
    const balances = await listInventoryPhysicalLocationBalances(
      beforeDashboard.inventory.map((item) => ({ id: item.id, onHandQuantity: item.quantityOwned }))
    );
    const balanceById = new Map(balances.map((balance) => [balance.inventoryItemId, balance]));

    for (const line of input.items) {
      const inventoryItem = beforeById.get(line.inventoryItemId);
      if (!inventoryItem) throw new Error("One or more POS cart items could not be found.");
      const inStoreQuantity = balanceById.get(line.inventoryItemId)?.inStoreQuantity ?? inventoryItem.quantityOwned;
      if (line.quantity > inStoreQuantity) {
        throw new Error(
          `${inventoryItem.publicTitle || inventoryItem.itemName} only has ${inStoreQuantity} unit${inStoreQuantity === 1 ? "" : "s"} assigned In Store. Move more stock to In Store before completing this sale.`
        );
      }
    }

    const sale = await createPosSale(storeUser, { ...input, requestId });

    const actorLabel = String(user.role) === "CASHIER" ? "cashier" : "admin";
    await logAudit({
      user,
      requestId,
      action: "pos.sale.completed",
      entityType: "POS_SALE",
      entityId: sale.saleReference,
      summary: `Authenticated ${actorLabel} completed POS sale ${sale.saleReference} for ${sale.itemCount} item${sale.itemCount === 1 ? "" : "s"}.`,
      metadata: {
        saleReference: sale.saleReference,
        paymentMethod: sale.paymentMethod,
        subtotal: sale.subtotal,
        tax: sale.tax,
        total: sale.total,
        itemCount: sale.itemCount,
        actorRole: String(user.role),
        storeOwnerUserId: storeUser.id,
        square: verifiedSquarePayment
          ? {
              transactionId: verifiedSquarePayment.transactionId,
              paymentId: verifiedSquarePayment.paymentId,
              receiptNumber: verifiedSquarePayment.receiptNumber,
              cardBrand: verifiedSquarePayment.cardBrand,
              cardLast4: verifiedSquarePayment.cardLast4
            }
          : null
      }
    });
    if (sale.taxExempt) {
      await logAudit({
        user,
        requestId,
        action: "pos.sale.tax_exemption_applied",
        entityType: "POS_SALE",
        entityId: sale.saleReference,
        summary: `Authenticated ${actorLabel} applied an approved tax exemption to POS sale ${sale.saleReference}.`,
        metadata: { saleReference: sale.saleReference, taxStatus: sale.taxStatus, actorRole: String(user.role), storeOwnerUserId: storeUser.id }
      });
    }
    return withRequestId(privateOk({ sale }, 201), requestId);
  } catch (error) {
    return safeMutationError(error, requestId, "The POS sale could not be completed.");
  }
}
