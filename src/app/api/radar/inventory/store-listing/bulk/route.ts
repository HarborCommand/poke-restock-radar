import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { bulkPublishInventoryStoreListings } from "@/lib/storefront";
import { inventoryBulkStorePublishSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    const input = inventoryBulkStorePublishSchema.parse(await readJson(request));
    const result = await bulkPublishInventoryStoreListings(user, input);
    await logAudit({
      user,
      action: "storefront.listing.bulk_publish",
      entityType: "INVENTORY",
      summary: `${user.email} bulk published ${result.updatedCount} store listings and skipped ${result.skippedCount}.`,
      metadata: {
        mode: input.mode,
        updatedCount: result.updatedCount,
        skippedCount: result.skippedCount,
        skipped: result.skipped.slice(0, 20)
      }
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
