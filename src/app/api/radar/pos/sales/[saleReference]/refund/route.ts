import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { logServerEvent, requestCorrelationId, runWithRequestContext, safeEntityRef } from "@/lib/observability";
import { POS_REFUND_REASON_LABELS } from "@/lib/pos";
import { authorizePosMutation, resolvePosStoreUser } from "@/lib/pos-authorization";
import { refundPosSale } from "@/lib/radar-service";
import { posSaleRefundSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      const input = posSaleRefundSchema.parse(await readJson(request));
      const storeUser = await resolvePosStoreUser(user);
      const sale = await refundPosSale(storeUser, decodeURIComponent(saleReference), input);
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
