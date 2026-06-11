type StorefrontCopyProduct = {
  title?: string | null;
  itemName?: string | null;
  brand?: string | null;
  category?: string | null;
  setName?: string | null;
  publicDescription?: string | null;
  description?: string | null;
  status?: string | null;
  availableQuantity?: number | null;
};

const warningDescriptionPatterns = [
  /Pok\?mon/i,
  /Pok�mon/i,
  /PokÃ©mon/i,
  /\bundefined\b/i,
  /\bnull\b/i,
  /\bsource\b/i,
  /\bcost\b/i,
  /\badmin\b/i,
  /\btracker\b/i,
  /\breceipt\b/i,
  /reviewed for clear images/i,
  /customer-facing pricing/i,
  /available quantity before it appears/i,
  /invoice checkout confirmation/i,
  /home\?and/i
];

const fallbackDescriptionPatterns = warningDescriptionPatterns.filter(
  (pattern) => !/Pok/.test(pattern.source) && !/home/.test(pattern.source)
);

function decodeCommonMojibake(value: string) {
  return value
    .replace(/Pok(?:\?|�|Ã©)mon/gi, "Pokémon")
    .replace(/Pok(?:\?|�|Ã©)\s*Ball/gi, "Poké Ball")
    .replace(/Poke\s*Ball/gi, "Poké Ball")
    .replace(/Pokeball/gi, "Poké Ball")
    .replace(/Pokemon/gi, "Pokémon")
    .replace(/TCG/gi, "TCG")
    .replace(/â€™/g, "'")
    .replace(/â€œ|â€�/g, '"')
    .replace(/â€“|â€”/g, "-")
    .replace(/Â·/g, "·")
    .replace(/Â/g, "");
}

export function normalizeStorefrontCopy(value: string | null | undefined) {
  if (!value) return "";
  const normalized = decodeCommonMojibake(value)
    .replace(/home\?and/gi, "home and")
    .replace(/checkout\?confirmation/gi, "checkout confirmation")
    .replace(/([.!?])(?=[A-Z0-9])/g, "$1 ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?=\S)/g, "$1 ")
    .replace(/\s*\n+\s*/g, "\n")
    .trim();

  return dedupeSentences(normalized);
}

export function cleanStorefrontTitle(value: string | null | undefined) {
  return normalizeStorefrontCopy(value)
    .replace(/\s*:\s*/g, ": ")
    .replace(/\s*\/\s*/g, " / ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function storefrontCopyWarnings(value: string | null | undefined) {
  const raw = value ?? "";
  const normalized = normalizeStorefrontCopy(raw);
  const warnings: string[] = [];
  if (!normalized) warnings.push("Description is missing.");
  for (const pattern of warningDescriptionPatterns) {
    if (pattern.test(raw) || pattern.test(normalized)) {
      warnings.push(`Contains "${pattern.source.replace(/\\b|\(\?:|\)|\\/g, "").slice(0, 24)}" cleanup risk.`);
      break;
    }
  }
  if (/(.)\1{8,}/.test(normalized)) warnings.push("Contains repeated characters.");
  if (normalized.length > 1200) warnings.push("Description is too long for a clean product page.");
  return warnings;
}

export function hasLowQualityStorefrontDescription(value: string | null | undefined) {
  const normalized = normalizeStorefrontCopy(value);
  if (!normalized || normalized.length < 40 || normalized.length > 1200) return true;
  return fallbackDescriptionPatterns.some((pattern) => pattern.test(value ?? "") || pattern.test(normalized));
}

export function generatedStorefrontDescription(product: StorefrontCopyProduct) {
  const title = cleanStorefrontTitle(product.title || product.itemName);
  const category = cleanStorefrontTitle(product.category) || "collectible product";
  const text = `${title} ${category} ${product.setName || ""}`;
  const isPokemonSealed = /\bPokémon\b|\bPokemon\b|TCG|booster|elite trainer box|ETB|tin|blister|collection/i.test(text);

  if (isPokemonSealed) {
    return "Available from GameDayGrabs LLC, this sealed Pokémon TCG product is part of our curated collector inventory. Each item is listed with clear product images, current availability, and secure request-invoice checkout. Availability may change before invoice confirmation.";
  }

  return `Available from GameDayGrabs LLC, this ${category.toLowerCase()} is part of our curated Pokémon and sports card inventory. Each listing includes clear product images, current availability, and request-invoice checkout. Availability may change before invoice confirmation.`;
}

export function cleanStorefrontDescription(product: StorefrontCopyProduct) {
  const raw = product.publicDescription || product.description;
  const normalized = normalizeStorefrontCopy(raw);
  if (hasLowQualityStorefrontDescription(raw)) {
    return generatedStorefrontDescription(product);
  }
  return normalized;
}

export function storefrontSoldOutNote() {
  return "This item is currently sold out. It remains listed for catalog reference and may return if restocked.";
}

function dedupeSentences(value: string) {
  const parts = value.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!parts) return value;
  const seen = new Set<string>();
  return parts
    .map((part) => part.trim())
    .filter((part) => {
      const key = part.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
}
