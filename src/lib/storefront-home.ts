import type { PublicStoreProductDTO, StorefrontSettingsDTO } from "@/types/radar";
import { isNewArrival, isSoldOutProduct, storefrontArrivalDate } from "@/lib/storefront-badges";
import { displayStorefrontCategory } from "@/lib/storefront-categories";
import { storefrontCollectionPath } from "@/lib/storefront-collections";

type HeroSettings = Pick<StorefrontSettingsDTO, "featuredHeroProductId" | "homepageHeroMode" | "showSoldOutInHero">;

export type HomepageMerchandisingSection = {
  title: string;
  detail: string;
  href: string;
  linkLabel: string;
  products: PublicStoreProductDTO[];
};

export function storefrontProductTime(product: Pick<PublicStoreProductDTO, "publishedAt" | "createdAt">) {
  const timestamp = Date.parse(storefrontArrivalDate(product));
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortStorefrontProductsNewest(products: PublicStoreProductDTO[]) {
  return [...products].sort((left, right) => storefrontProductTime(right) - storefrontProductTime(left));
}

function activeStorefrontProducts(products: PublicStoreProductDTO[]) {
  return products.filter((product) => !isSoldOutProduct(product));
}

function byNewestThenTitle(left: PublicStoreProductDTO, right: PublicStoreProductDTO) {
  const timeDiff = storefrontProductTime(right) - storefrontProductTime(left);
  if (timeDiff !== 0) return timeDiff;
  return left.title.localeCompare(right.title);
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
  const sorted = activeStorefrontProducts(products).sort(byNewestThenTitle);
  const newArrivals = sorted.filter((product) => isNewArrival(product, now, newArrivalDays)).slice(0, 4);
  if (newArrivals.length) {
    return {
      title: "New Arrivals",
      detail: "Freshly added products from GameDayGrabs.",
      href: storefrontCollectionPath("new-arrivals"),
      linkLabel: "View All New Arrivals",
      products: newArrivals
    } satisfies HomepageMerchandisingSection;
  }

  return {
    title: "Recently Added",
    detail: "The latest published products from GameDayGrabs.",
    href: storefrontCollectionPath("new-arrivals"),
    linkLabel: "View All Recently Added",
    products: sorted.slice(0, 4)
  } satisfies HomepageMerchandisingSection;
}

export function homepageAlmostGoneSection(products: PublicStoreProductDTO[]) {
  const almostGone = activeStorefrontProducts(products)
    .filter((product) => product.availabilityLevel === "almost_gone")
    .sort((left, right) => {
      return byNewestThenTitle(left, right);
    })
    .slice(0, 4);

  return {
    title: "Almost Gone",
    detail: "Small batches available now. Exact stock may change at checkout.",
    href: storefrontCollectionPath("almost-gone"),
    linkLabel: "Shop Low Stock",
    products: almostGone
  } satisfies HomepageMerchandisingSection;
}

function collectorPickScore(product: PublicStoreProductDTO) {
  const category = displayStorefrontCategory(product);
  if (category === "Premium Collections") return 0;
  if (category === "Elite Trainer Boxes") return 1;
  if (category === "Booster Bundles") return 2;
  if (category === "Tins") return 3;
  if (category === "Blisters") return 4;
  return 5;
}

export function homepageCollectorPicksSection(products: PublicStoreProductDTO[]) {
  const picks = activeStorefrontProducts(products)
    .filter((product) => ["Premium Collections", "Elite Trainer Boxes", "Booster Bundles", "Tins", "Blisters"].includes(displayStorefrontCategory(product)))
    .sort((left, right) => {
      const scoreDiff = collectorPickScore(left) - collectorPickScore(right);
      if (scoreDiff !== 0) return scoreDiff;
      return byNewestThenTitle(left, right);
    })
    .slice(0, 4);

  return {
    title: "Collector Picks",
    detail: "Active sealed products and premium releases collectors often scan first.",
    href: storefrontCollectionPath("pokemon-sealed-products"),
    linkLabel: "Shop Collector Picks",
    products: picks
  } satisfies HomepageMerchandisingSection;
}
