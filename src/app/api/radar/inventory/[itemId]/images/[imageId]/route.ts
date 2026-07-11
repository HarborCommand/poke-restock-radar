import { revalidatePath } from "next/cache";
import { del } from "@vercel/blob";
import { requireAdmin, requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok, readJson } from "@/lib/http";
import { deleteInventoryProductImage, updateInventoryProductImage } from "@/lib/radar-service";
import { inventoryProductImageUpdateSchema } from "@/lib/validation";

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

function isOwnedUploadedBlob(url: string, userId: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    return (
      parsed.protocol === "https:" &&
      hostname.endsWith(".public.blob.vercel-storage.com") &&
      (pathname.startsWith(`products/${userId}/`) || pathname.startsWith(`receipts/${userId}/`))
    );
  } catch {
    return false;
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string; imageId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { itemId, imageId } = await params;
    const input = inventoryProductImageUpdateSchema.parse(await readJson(request));
    const item = await updateInventoryProductImage(user, itemId, imageId, input);
    revalidateStorefrontImagePaths(item);
    await logAudit({
      user,
      action: "inventory.image.updated",
      entityType: "INVENTORY",
      entityId: item.id,
      summary: `${user.email} updated a product image for ${item.itemName}.`
    });
    return ok({ item });
  } catch (error) {
    return badRequest(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ itemId: string; imageId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const { itemId, imageId } = await params;
    const result = await deleteInventoryProductImage(user, itemId, imageId);
    revalidateStorefrontImagePaths(result.item);
    if (
      result.deletedImage.source === "uploaded" &&
      process.env.BLOB_READ_WRITE_TOKEN &&
      isOwnedUploadedBlob(result.deletedImage.url, user.id)
    ) {
      await del(result.deletedImage.url).catch(() => null);
    }
    await logAudit({
      user,
      action: "inventory.image.deleted",
      entityType: "INVENTORY",
      entityId: result.item.id,
      summary: `${user.email} deleted a product image from ${result.item.itemName}.`
    });
    return ok(result);
  } catch (error) {
    return badRequest(error);
  }
}
