import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { logServerEvent, requestCorrelationId, runWithRequestContext, safeEntityRef } from "@/lib/observability";
import { POS_REFUND_REASON_LABELS } from "@/lib/pos";
import { authorizePosMutation, resolvePosStoreUser } from "@/lib/pos-authorization";
import { refundPosSale } from "@/lib/radar-service";
import { parseSquarePaymentReference } from "@/lib/square-pos";
import { refundSquarePosPayment } from "@/lib/square-refunds";
import { posSaleRefundSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cents(value: number) {
  return Math.round(value * 100);
}

export async function POST(request: Request, { params }: { params: Promise<{ saleReference: string }> }) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const posResponse = authorizePosMutation(request, user);
  if (posResponse) return withPrivateNoStore(withRequestId(posResponse, requestId));

  return runWithRequestContext(requestId, async () => {
    let saleReference: string | null = null;
    try {
      ({ saleReference } = await params);
      const normalizedReference = decodeURIComponent(saleReference).trim();
      const input = posSaleRefundSchema.parse(await readJson(request));
      const storeUser = await resolvePosStoreUser(user);

      const rows = await prisma.inventorySale.findMany({
        where: {
          userId: storeUser.id,
          saleReference: normalizedReference,
          platform: "pos"
        },
        select: {
          totalCents: true,
          grossSale: true,
          refundedAmount: true,
          paymentReference: true
        },
        orderBy: { createdAt: "asc" }
      });
      if (!rows.length) throw new Error("POS sale not found.");

      const originalAmountCents = rows.reduce(
        (sum, row) => sum + (row.totalCents ?? cents(row.grossSale)),
        0
      );
      const alreadyRefundedCents = rows.reduce(
        (sum, row) => sum + cents(row.refundedAmount ?? 0),
        0
      );
      const remainingRefundableCents = Math.max(0, originalAmountCents - alreadyRefundedCents);
      if (remainingRefundableCents <= 0) throw new Error("This POS sale has no remaining refundable amount.");

      const requestedRefundCents = input.refundType === "full"
        ? remainingRefundableCents
        : cents(input.partialRefundAmount ?? 0);
      if (requestedRefundCents <= 0) throw new Error("Enter a valid refund amount.");
      if (requestedRefundCents > remainingRefundableCents) {
        throw new Error("The refund exceeds the remaining refundable amount.");
      }

      const paymentReferences = Array.from(
        new Set(rows.map((row) => row.paymentReference?.trim()).filter((value): value is string => Boolean(value)))
      );
      if (paymentReferences.length > 1) throw new Error("This sale contains conflicting payment references and cannot be refunded automatically.");

      const squareTransactionId = parseSquarePaymentReference(paymentReferences[0]);
      if (squareTransactionId) {
        const reasonLabel = POS_REFUND_REASON_LABELS[input.reason];
        const providerRefund = await refundSquarePosPayment({
          transactionId: squareTransactionId,
          originalAmountCents,
          refundAmountCents: requestedRefundCents,
          idempotencySeed: [
            "pos-square-refund",
            storeUser.id,
            normalizedReference,
            alreadyRefundedCents,
            requestedRefundCents
          ].join(":"),
          reason: `GameDayGrabs POS · ${reasonLabel}`
        });

        if (providerRefund.status !== "COMPLETED") {
          await logAudit({
            user,
            requestId,
            action: "pos.sale.square_refund_pending",
            entityType: "POS_SALE",
            entityId: normalizedReference,
            summary: `${user.email} initiated a Square refund for ${normalizedReference}; Square status is pending.`,
            metadata: {
              saleReference: normalizedReference,
              provider: "square",
              providerRefundId: providerRefund.refundId,
              amountCents: providerRefund.amountCents,
              status: providerRefund.status
            }
          });
          throw new Error(
            `Square accepted the ${`$${(requestedRefundCents / 100).toFixed(2)}`} refund, but it is still pending. No GameDayGrabs refund or inventory change was recorded yet. Tap Refund sale again later to check the same Square refund.`
          );
        }

        const sale = await refundPosSale(storeUser, normalizedReference, input);
        await logAudit({
          user,
          requestId,
          action: "pos.sale.square_refund_completed",
          entityType: "POS_SALE",
          entityId: sale.saleReference,
          summary: `${user.email} completed a Square card refund for ${sale.saleReference}.`,
          metadata: {
            saleReference: sale.saleReference,
            provider: "square",
            providerRefundId: providerRefund.refundId,
            providerPaymentId: providerRefund.paymentId,
            amountCents: providerRefund.amountCents,
            cardBrand: providerRefund.cardBrand,
            cardLast4: providerRefund.cardLast4,
            reason: reasonLabel,
            restoreInventory: input.restoreInventory,
            total: sale.total
          }
        });
        return withRequestId(privateOk({ sale, providerRefund }), requestId);
      }

      const sale = await refundPosSale(storeUser, normalizedReference, input);
      await logAudit({
        user,
        requestId,
        action: "pos.sale.refund_recorded",
        entityType: "POS_SALE",
        entityId: sale.saleReference,
        summary: `${user.email} recorded a manual POS refund for ${sale.saleReference}.`,
        metadata: {
          saleReference: sale.saleReference,
          reason: POS_REFUND_REASON_LABELS[input.reason],
          restoreInventory: input.restoreInventory,
          total: sale.total
        }
      });
      return withRequestId(privateOk({ sale }), requestId);
    } catch (error) {
      logServerEvent({
        requestId,
        route: "/api/radar/pos/sales/[saleReference]/refund",
        operation: "pos.refund",
        status: 400,
        durationMs: Date.now() - startedAt,
        entityType: "POS_SALE",
        entityRef: safeEntityRef(saleReference),
        error
      });
      return safeMutationError(error, requestId, "The POS refund could not be completed.");
    }
  });
}
