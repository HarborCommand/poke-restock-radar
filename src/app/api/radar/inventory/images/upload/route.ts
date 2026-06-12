import { put } from "@vercel/blob";
import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const maxUploadBytes = 10 * 1024 * 1024;
const allowedContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function safeFilename(value: string, contentType: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const fallbackExtension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const withName = cleaned || `product-image.${fallbackExtension}`;
  return /\.[a-z0-9]+$/i.test(withName) ? withName : `${withName}.${fallbackExtension}`;
}

function safeFolder(value: FormDataEntryValue | null) {
  const folder = typeof value === "string" ? value.toLowerCase().trim() : "products";
  return folder === "receipts" ? "receipts" : "products";
}

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json({ error: "Product image upload storage is not configured. Add BLOB_READ_WRITE_TOKEN in Vercel." }, { status: 503 });
    }
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("Choose an image file to upload.");
    }
    if (!allowedContentTypes.has(file.type)) {
      throw new Error("Upload a JPG, PNG, or WebP image.");
    }
    if (file.size <= 0) {
      throw new Error("The selected image is empty.");
    }
    if (file.size > maxUploadBytes) {
      throw new Error("Image uploads are limited to 10 MB.");
    }

    const folder = safeFolder(formData.get("folder"));
    const filename = safeFilename(file.name || "product-image", file.type);
    const pathname = `${folder}/${user.id}/${Date.now()}-${filename}`;
    const blob = await put(pathname, file, {
      access: "public",
      addRandomSuffix: true,
      contentType: file.type,
      cacheControlMaxAge: 31536000
    });

    return ok({
      url: blob.url,
      pathname: blob.pathname,
      contentType: file.type,
      size: file.size
    });
  } catch (error) {
    return badRequest(error);
  }
}
