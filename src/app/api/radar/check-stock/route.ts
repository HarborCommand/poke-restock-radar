import { requirePermission, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { badRequest, ok, readJson } from "@/lib/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bestBuyCheckStockSchema = z.object({
  retailer: z.literal("Best Buy"),
  zip: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/, "Enter a valid ZIP code."),
  radius: z.coerce.number().int().min(1).max(100),
  sku: z.string().trim().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/, "Enter a valid Best Buy SKU.")
});

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const permissionResponse = requirePermission(user, "canRunChecks", "Run checks");
  if (permissionResponse) return permissionResponse;

  try {
    const input = bestBuyCheckStockSchema.parse(await readJson(request));
    const candidates = await prisma.product.findMany({
      where: {
        archivedAt: null,
        OR: [{ sku: input.sku }, { retailerProductId: input.sku }]
      },
      include: { retailer: true },
      orderBy: { updatedAt: "desc" },
      take: 10
    });
    const bestBuyProduct = candidates.find((product) => product.retailer.name.toLowerCase().includes("best buy")) ?? null;

    return ok({
      retailer: "Best Buy",
      sku: input.sku,
      zip: input.zip,
      radiusMiles: input.radius,
      sourceAvailable: false,
      message: "Best Buy store stock source not available.",
      checkedAt: new Date().toISOString(),
      stores: [],
      onlineProduct: bestBuyProduct
        ? {
            id: bestBuyProduct.id,
            name: bestBuyProduct.name,
            imageUrl: bestBuyProduct.liveImageUrl || bestBuyProduct.imageUrl,
            productUrl: bestBuyProduct.verifiedFinalUrl || bestBuyProduct.url,
            price: bestBuyProduct.livePrice ?? bestBuyProduct.retailPrice,
            stockStatus: bestBuyProduct.liveStockStatus || bestBuyProduct.stockStatus,
            lastCheckedAt: bestBuyProduct.lastCheckedAt?.toISOString() ?? null,
            confidence: bestBuyProduct.liveConfidenceScore,
            verificationStatus: bestBuyProduct.verificationStatus
          }
        : null
    });
  } catch (error) {
    return badRequest(error);
  }
}
