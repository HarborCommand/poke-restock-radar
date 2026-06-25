export const STOREFRONT_GENERIC_POKEMON_CATEGORY = "Pokemon Sealed";

export const STOREFRONT_CATEGORY_OPTIONS = [
  STOREFRONT_GENERIC_POKEMON_CATEGORY,
  "Booster Bundles",
  "Booster Boxes",
  "Elite Trainer Boxes",
  "Premium Collections",
  "Collection Boxes",
  "Blisters",
  "Tins",
  "Sleeved Boosters",
  "Accessories",
  "Graded Cards",
  "Sports Cards"
] as const;

const specificCategoryMatchers: Array<{ category: string; pattern: RegExp }> = [
  { category: "Elite Trainer Boxes", pattern: /\b(elite trainer box|etb)\b/i },
  { category: "Booster Bundles", pattern: /\bbooster bundle\b/i },
  { category: "Booster Boxes", pattern: /\bbooster box\b/i },
  { category: "Premium Collections", pattern: /\bpremium collection\b|\bpremium\b.*\bcollection\b/i },
  { category: "Sleeved Boosters", pattern: /\bsleeved booster\b|\bbooster pack\b/i },
  { category: "Blisters", pattern: /\b(blister|checklane|check lane|3-pack|three-booster|three booster)\b/i },
  { category: "Tins", pattern: /\b(poke ball tin|pokeball tin|mini tin|tin)\b/i },
  { category: "Collection Boxes", pattern: /\bcollection box\b/i },
  { category: "Accessories", pattern: /\b(accessory|accessories|binder|sleeve|toploader|top loader|deck box|playmat|storage)\b/i },
  { category: "Graded Cards", pattern: /\b(graded|psa|bgs|cgc|slab)\b/i },
  { category: "Sports Cards", pattern: /\b(sports|bowman|topps|panini|basketball|football|baseball)\b/i }
];

const specificCategories = new Set(specificCategoryMatchers.map((entry) => entry.category));

function textForCategoryMatch(input: { title?: string | null; category?: string | null; tags?: string[] | null; setName?: string | null; itemName?: string | null }) {
  return [input.category, input.title, input.itemName, input.setName, ...(input.tags ?? [])].filter(Boolean).join(" ");
}

function normalizedCategory(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function categoryEquals(left: string | null | undefined, right: string | null | undefined) {
  return normalizedCategory(left) === normalizedCategory(right);
}

export function isGenericStorefrontCategory(category: string | null | undefined) {
  const normalized = normalizedCategory(category);
  if (!normalized) return true;
  return [
    "pokemon sealed",
    "pokemon",
    "pokemon tcg",
    "sealed",
    "sealed packs",
    "sealed products",
    "trading cards",
    "cards",
    "collectibles",
    "other"
  ].includes(normalized);
}

export function inferSpecificStorefrontCategory(input: {
  title?: string | null;
  category?: string | null;
  tags?: string[] | null;
  setName?: string | null;
  itemName?: string | null;
}) {
  const text = textForCategoryMatch(input);
  for (const { category, pattern } of specificCategoryMatchers) {
    if (pattern.test(text)) return category;
  }
  return STOREFRONT_GENERIC_POKEMON_CATEGORY;
}

export function displayStorefrontCategory(input: {
  title?: string | null;
  category?: string | null;
  tags?: string[] | null;
  setName?: string | null;
  itemName?: string | null;
}) {
  if (input.category && specificCategories.has(input.category)) return input.category;
  if (input.category && !isGenericStorefrontCategory(input.category)) return input.category;
  return inferSpecificStorefrontCategory(input);
}

export function resolvedStorefrontCategory(input: {
  title?: string | null;
  category?: string | null;
  tags?: string[] | null;
  setName?: string | null;
  itemName?: string | null;
}) {
  return displayStorefrontCategory(input);
}

export function storefrontCategoryMatches(
  product: { title: string; category: string; tags: string[] },
  category: string
) {
  if (category === "all") return true;
  const normalized = normalizedCategory(category);
  const specific = resolvedStorefrontCategory(product);
  const targetIsSpecific = Array.from(specificCategories).some((entry) => categoryEquals(entry, category));
  const text = textForCategoryMatch(product).toLowerCase();

  if (normalized === normalizedCategory(STOREFRONT_GENERIC_POKEMON_CATEGORY)) {
    return /pokemon|sealed|booster|trainer|collection|tin|blister|tcg|trading card/.test(text);
  }
  if (categoryEquals(specific, category)) return true;
  if (targetIsSpecific) return false;
  if (normalized === "sports cards") return /\b(sports|bowman|topps|panini|basketball|football|baseball)\b/.test(text);
  if (normalized === "graded cards") return /\b(graded|psa|bgs|cgc|slab)\b/.test(text);
  if (normalized === "accessories") return /\b(accessory|accessories|binder|sleeve|toploader|top loader|deck box|playmat|storage)\b/.test(text);
  return text.includes(normalized.replace(/s$/, ""));
}
