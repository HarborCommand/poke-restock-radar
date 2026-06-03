import { requirePermission, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { badRequest, ok, readJson } from "@/lib/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const checkStockSchema = z.object({
  retailer: z.enum(["Best Buy", "GameStop"]),
  zip: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/, "Enter a valid ZIP code."),
  radius: z.coerce.number().int().min(1).max(100),
  sku: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/, "Enter a valid SKU or product ID.")
});

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const permissionResponse = requirePermission(user, "canRunChecks", "Run checks");
  if (permissionResponse) return permissionResponse;

  try {
    const input = checkStockSchema.parse(await readJson(request));
    const candidates = await prisma.product.findMany({
      where: {
        archivedAt: null,
        OR: [{ sku: input.sku }, { retailerProductId: input.sku }]
      },
      include: { retailer: true },
      orderBy: { updatedAt: "desc" },
      take: 10
    });
    const retailerLower = input.retailer.toLowerCase();
    const onlineProduct = candidates.find((product) => product.retailer.name.toLowerCase().includes(retailerLower)) ?? null;

    return ok({
      retailer: input.retailer,
      sku: input.sku,
      zip: input.zip,
      radiusMiles: input.radius,
      sourceAvailable: false,
      message: `${input.retailer} store stock source not available.`,
      checkedAt: new Date().toISOString(),
      stores: [],
      onlineProduct: onlineProduct
        ? {
            id: onlineProduct.id,
            name: onlineProduct.name,
            imageUrl: onlineProduct.liveImageUrl || onlineProduct.imageUrl,
            productUrl: onlineProduct.verifiedFinalUrl || onlineProduct.url,
            price: onlineProduct.livePrice ?? onlineProduct.retailPrice,
            stockStatus: onlineProduct.liveStockStatus || onlineProduct.stockStatus,
            lastCheckedAt: onlineProduct.lastCheckedAt?.toISOString() ?? null,
            confidence: onlineProduct.liveConfidenceScore,
            verificationStatus: onlineProduct.verificationStatus
          }
        : null
    });
  } catch (error) {
    return badRequest(error);
  }
}
