import { cleanStorefrontTitle } from "@/lib/storefront-copy";

type ProductCardCopyProduct = {
  title?: string | null;
  category?: string | null;
  setName?: string | null;
};

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function storefrontProductCardSubtitle(product: ProductCardCopyProduct) {
  const title = cleanStorefrontTitle(product.title);
  const setName = cleanStorefrontTitle(product.setName);
  const category = cleanStorefrontTitle(product.category);

  if (setName && category && normalizedKey(setName) !== normalizedKey(category)) {
    return `${setName} — ${category}`;
  }
  if (setName && normalizedKey(setName) !== normalizedKey(title)) return setName;
  if (category && normalizedKey(category) !== normalizedKey(title) && normalizedKey(category) !== "pokemon sealed") return category;
  return null;
}
