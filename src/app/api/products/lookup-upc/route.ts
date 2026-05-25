import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { badRequest, ok } from "@/lib/http";
import { lookupInventoryUpc } from "@/lib/radar-service";
import { normalizeUPC } from "@/lib/upc";
import { upcLookupSchema } from "@/lib/validation";
import type { UpcLookupResultDTO } from "@/types/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toPublicLookupResponse(result: UpcLookupResultDTO, includeDebug: boolean) {
  if (!result.lookupProduct) {
    return {
      found: false,
      upc: result.upc,
      message: "No product found for this UPC.",
      ...(includeDebug ? { debug: result.debug } : {})
    };
  }

  return {
    found: true,
    source: result.lookupProduct.source,
    product: {
      upc: result.upc,
      title: result.lookupProduct.title || result.lookupProduct.productName,
      brand: result.lookupProduct.brand,
      category: result.lookupProduct.category,
      description: result.lookupProduct.description,
      imageUrl: result.lookupProduct.imageUrl,
      additionalImages: result.lookupProduct.additionalImages,
      msrp: result.lookupProduct.msrp,
      model: result.lookupProduct.model,
      manufacturer: result.lookupProduct.manufacturer,
      sku: result.lookupProduct.sku,
      retailer: result.lookupProduct.retailer,
      productUrl: result.lookupProduct.exactProductUrl,
      exactProductUrl: result.lookupProduct.exactProductUrl,
      productId: result.lookupProduct.productId
    },
    ...(includeDebug ? { debug: result.debug } : {})
  };
}

async function handleLookup(input: unknown) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const parsed = upcLookupSchema.parse(input);
    const result = await lookupInventoryUpc(user, parsed);
    await logAudit({
      user,
      action: "products.lookup_upc",
      entityType: "INVENTORY",
      entityId: result.matchedInventoryItem?.id ?? result.matchedProduct?.id ?? null,
      summary: `${user.email} looked up UPC ${result.upc}: ${result.status}.`
    });
    return ok(toPublicLookupResponse(result, user.role === "ADMIN" || process.env.NODE_ENV !== "production"));
  } catch (error) {
    return badRequest(error);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return handleLookup({ upc: normalizeUPC(url.searchParams.get("upc")), source: "manual" });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return handleLookup(body);
}
