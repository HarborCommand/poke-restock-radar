import type { PublicStoreProductDTO, StorefrontSettingsDTO } from "@/types/radar";
import { isNewArrival, isSoldOutProduct, storefrontArrivalDate } from "@/lib/storefront-badges";

type HeroSettings = Pick<StorefrontSettingsDTO, "featuredHeroProductId" | "homepageHeroMode" | "showSoldOutInHero">;

export function storefrontProductTime(product: Pick<PublicStoreProductDTO, "publishedAt" | "createdAt">) {
  const timestamp = Date.parse(storefrontArrivalDate(product));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortStorefrontProductsNewest(products: PublicStoreProductDTO[]) {
  return [...products].sort((left, right) => storefrontProductTime(right) - storefrontProductTime(left));
}

export function selectHomepageHeroProduct(products: PublicStoreProductDTO[], settings: HeroSettings) {
  if (settings.homepageHeroMode === "brand_only") return null;

  const sorted = sortStorefrontProductsNewest(products);
  const allowsSoldOut = settings.showSoldOutInHero;
  const selected = settings.featuredHeroProductId ? sorted.find((product) => product.id === settings.featuredHeroProductId) : null;
  if (settings.homepageHeroMode === "manual_product" && selected && (allowsSoldOut || !isSoldOutProduct(selected))) {
    return selected;
  }

  const activeWithImage = sorted.find((product) => !isSoldOutProduct(product) && Boolean(product.imageUrl));
  if (activeWithImage) return activeWithImage;

  if (allowsSoldOut) {
    const soldOutWithImage = sorted.find((product) => isSoldOutProduct(product) && Boolean(product.imageUrl));
    if (soldOutWithImage) return soldOutWithImage;
  }

  return null;
}

export function homepageArrivalSection(products: PublicStoreProductDTO[], newArrivalDays: number, now = new Date()) {
  const sorted = sortStorefrontProductsNewest(products);
  const newArrivals = sorted.filter((product) => isNewArrival(product, now, newArrivalDays)).slice(0, 4);
  if (newArrivals.length) {
    return {
      title: "New Arrivals",
      detail: "Recently published products from available inventory.",
      products: newArrivals
    };
  }

  return {
    title: "Recently Added",
    detail: "The latest published products from GameDayGrabs.",
    products: sorted.slice(0, 4)
  };
}
