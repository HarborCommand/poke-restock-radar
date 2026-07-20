import type { PublicStoreProductDTO, StorefrontSettingsDTO } from "@/types/radar";
import { isNewArrival, isSoldOutProduct, storefrontArrivalDate } from "@/lib/storefront-badges";
import { displayStorefrontCategory } from "@/lib/storefront-categories";
import { storefrontCollectionPath } from "@/lib/storefront-collections";
import {
  compareStorefrontFeaturedProducts,
  compareStorefrontNewestProducts,
  compareStorefrontStableProductTie,
  isSellableStorefrontProduct
} from "@/lib/storefront-merchandising";

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
  return [...products].sort(compareStorefrontNewestProducts);
}

function activeStorefrontProducts(products: PublicStoreProductDTO[]) {
  return products.filter(isSellableStorefrontProduct);
}

function byNewestThenTitle(left: PublicStoreProductDTO, right: PublicStoreProductDTO) {
  const timeDiff = storefrontProductTime(right) - storefrontProductTime(left);
  if (timeDiff !== 0) return timeDiff;
  return left.title.localeCompare(right.title) || compareStorefrontStableProductTie(left, right);
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

export function homepageFeaturedDropsSection(products: PublicStoreProductDTO[], newArrivalDays: number, now = new Date()) {
  const sorted = activeStorefrontProducts(products)
    .filter((product) => Boolean(product.imageUrl || product.primaryImageUrl || product.images.length))
    .sort((left, right) => {
      const leftNew = isNewArrival(left, now, newArrivalDays) ? 1 : 0;
      const rightNew = isNewArrival(right, now, newArrivalDays) ? 1 : 0;
      if (rightNew !== leftNew) return rightNew - leftNew;
      return byNewestThenTitle(left, right);
    });
  const selected: PublicStoreProductDTO[] = [];
  const selectedCategories = new Set<string>();

  for (const product of sorted) {
    const category = displayStorefrontCategory(product);
    if (selectedCategories.has(category)) continue;
    selected.push(product);
    selectedCategories.add(category);
    if (selected.length === 4) break;
  }

  if (selected.length < 4) {
    for (const product of sorted) {
      if (selected.some((entry) => entry.id === product.id)) continue;
      selected.push(product);
      if (selected.length === 4) break;
    }
  }

  return {
    title: "Featured Drops",
    detail: "Fresh sealed products ready to ship or pick up.",
    href: "/shop",
    linkLabel: "Shop All Products",
    products: selected
  } satisfies HomepageMerchandisingSection;
}

function sectionProducts(
  products: PublicStoreProductDTO[],
  usedProductIds: Set<string>,
  predicate: (product: PublicStoreProductDTO) => boolean,
  sort: (left: PublicStoreProductDTO, right: PublicStoreProductDTO) => number = compareStorefrontFeaturedProducts,
  limit = 4
) {
  return activeStorefrontProducts(products)
    .filter((product) => !usedProductIds.has(product.id))
    .filter(predicate)
    .sort(sort)
    .slice(0, limit);
}

function addHomepageSection(
  sections: HomepageMerchandisingSection[],
  usedProductIds: Set<string>,
  section: Omit<HomepageMerchandisingSection, "products">,
  products: PublicStoreProductDTO[]
) {
  if (!products.length) return;
  products.forEach((product) => usedProductIds.add(product.id));
  sections.push({ ...section, products });
}

function isPokemonCardProduct(product: PublicStoreProductDTO) {
  const category = displayStorefrontCategory(product);
  return category !== "Accessories" && category !== "Sports Cards" && category !== "Graded Cards";
}

export function homepageMerchandisingSections(products: PublicStoreProductDTO[], newArrivalDays: number, now = new Date()) {
  const sections: HomepageMerchandisingSection[] = [];
  const usedProductIds = new Set<string>();

  addHomepageSection(
    sections,
    usedProductIds,
    {
      title: "New Arrivals",
      detail: "Freshly published products from GameDayGrabs.",
      href: storefrontCollectionPath("new-arrivals"),
      linkLabel: "View All New Arrivals"
    },
    sectionProducts(products, usedProductIds, (product) => isNewArrival(product, now, newArrivalDays), compareStorefrontNewestProducts)
  );

  addHomepageSection(
    sections,
    usedProductIds,
    {
      title: "Shop Pokémon Cards",
      detail: "Sealed Pokémon TCG products ready to ship or pick up.",
      href: storefrontCollectionPath("pokemon-sealed-products"),
      linkLabel: "Shop Pokémon"
    },
    sectionProducts(products, usedProductIds, isPokemonCardProduct)
  );

  addHomepageSection(
    sections,
    usedProductIds,
    {
      title: "Accessories",
      detail: "Storage and collector gear listed with current availability.",
      href: "/shop?category=Accessories",
      linkLabel: "Shop Accessories"
    },
    sectionProducts(products, usedProductIds, (product) => displayStorefrontCategory(product) === "Accessories")
  );

  addHomepageSection(
    sections,
    usedProductIds,
    {
      title: "Products Under $25",
      detail: "Lower-priced public listings using the current storefront price.",
      href: "/shop?sort=price-low",
      linkLabel: "Shop Under $25"
    },
    sectionProducts(products, usedProductIds, (product) => product.price < 25, (left, right) => left.price - right.price || compareStorefrontNewestProducts(left, right))
  );

  if (!sections.length) {
    addHomepageSection(
      sections,
      usedProductIds,
      {
        title: "Latest Products",
        detail: "Current public listings from GameDayGrabs.",
        href: "/shop",
        linkLabel: "Shop All Products"
      },
      activeStorefrontProducts(products).sort(compareStorefrontFeaturedProducts).slice(0, 4)
    );
  }

  return sections;
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
