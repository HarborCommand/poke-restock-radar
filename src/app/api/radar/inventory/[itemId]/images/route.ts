import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { attachInventoryProductImage } from "@/lib/radar-service";
import { inventoryProductImageCreateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function revalidateStorefrontImagePaths(item: { publicSlug?: string | null }) {
  revalidatePath("/");
  revalidatePath("/shop");
  revalidatePath("/product-feed.xml");
  revalidatePath("/sitemap.xml");
  if (item.publicSlug) {
    revalidatePath(`/product/${item.publicSlug}`);
    revalidatePath(`/shop/product/${item.publicSlug}`);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { itemId } = await params;
    const input = inventoryProductImageCreateSchema.parse(await readJson(request));
    if (!input.url) throw new Error("Product image URL is required.");
    const item = await attachInventoryProductImage(user, itemId, {
      url: input.url,
      altText: input.altText,
      sortOrder: input.sortOrder,
      isPrimary: input.isPrimary,
      source: input.source,
      showInStore: input.showInStore
    });
    revalidateStorefrontImagePaths(item);
    await logAudit({
      user,
      action: "inventory.image.created",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} added a product image to ${item.itemName}.`
    });
    return ok({ item });
  } catch (error) {
    return badRequest(error);
  }
}
