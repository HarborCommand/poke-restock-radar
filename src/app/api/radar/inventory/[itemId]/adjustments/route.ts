import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { prisma } from "@/lib/db";
import { adjustInventoryStock } from "@/lib/radar-service";
import { inventoryAdjustmentSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const adminResponse = requireAdmin(user);
  if (adminResponse) return withPrivateNoStore(withRequestId(adminResponse, requestId));

  try {
    const { itemId } = await params;
    const item = await prisma.inventoryItem.findFirst({
      where: { id: itemId, OR: [{ userId: null }, { userId: user.id }] },
      select: { id: true }
    });
    if (!item) return withRequestId(privateOk({ adjustments: [] }, 404), requestId);
    const adjustments = await prisma.inventoryAdjustment.findMany({
      where: { inventoryItemId: item.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        inventoryItemId: true,
        action: true,
        quantityDelta: true,
        quantityBefore: true,
        quantityAfter: true,
        reason: true,
        note: true,
        unitCostCents: true,
        requestId: true,
        createdAt: true,
        user: { select: { name: true, email: true } }
      }
    });
    return withRequestId(
      privateOk({
        adjustments: adjustments.map((adjustment) => ({
          id: adjustment.id,
          inventoryItemId: adjustment.inventoryItemId,
          action: adjustment.action === "add" ? "add" : "remove",
          quantityDelta: adjustment.quantityDelta,
          quantityBefore: adjustment.quantityBefore,
          quantityAfter: adjustment.quantityAfter,
          reason: adjustment.reason,
          hasPrivateNote: Boolean(adjustment.note?.trim()),
          unitCostCents: adjustment.unitCostCents,
          actorLabel: adjustment.user?.name ? `${adjustment.user.name.split(/\s+/)[0]} admin` : "Admin",
          requestId: adjustment.requestId,
          referenceId: adjustment.requestId ?? adjustment.id,
          createdAt: adjustment.createdAt.toISOString()
        }))
      }),
      requestId
    );
  } catch (error) {
    return safeMutationError(error, requestId, "Inventory adjustment history could not be loaded.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return withPrivateNoStore(withRequestId(authorizationResponse, requestId));

  try {
    const { itemId } = await params;
    const input = inventoryAdjustmentSchema.parse(await readJson(request));
    const result = await adjustInventoryStock(user, itemId, input, requestId);
    return withRequestId(privateOk(result, result.duplicate ? 200 : 201), requestId);
  } catch (error) {
    return safeMutationError(error, requestId, "Inventory stock could not be adjusted.");
  }
}
