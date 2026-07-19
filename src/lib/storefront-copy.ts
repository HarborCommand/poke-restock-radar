type StorefrontCopyProduct = {
  title?: string | null;
  itemName?: string | null;
  brand?: string | null;
  category?: string | null;
  setName?: string | null;
  condition?: string | null;
  shippingAvailable?: boolean | null;
  localPickupEligible?: boolean | null;
  publicDescription?: string | null;
  description?: string | null;
  status?: string | null;
  availableQuantity?: number | null;
};

const warningDescriptionPatterns = [
  /Pok\?mon/i,
  /Pokï¿½mon/i,
  /PokÃƒÂ©mon/i,
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
  /Product\s+Details\s+Card\s+Text/i,
  /Public\s+listing\s+photos\s+and\s+title/i,
  /Available\s+from\s+GameDayGrabs\s+LLC,\s+this\s+sealed\s+Pok/i,
  /home\?and/i,
  /\w\?\s*s\b/i,
  /Mega Evolution\?\s*/i
];

const fallbackDescriptionPatterns = warningDescriptionPatterns.filter(
  (pattern) => !/Pok/.test(pattern.source) && !/home|Mega Evolution|\\w\\\?/.test(pattern.source)
);

const counterfeitReviewRiskPatterns = [
  /\breplica\b/i,
  /\bcopy\b/i,
  /\bfake\b/i,
  /\bfaux\b/i,
  /\bknockoff\b/i,
  /\bknock-off\b/i,
  /\bclone\b/i,
  /\bmirror image\b/i,
  /\bunofficial\b/i,
  /\bunauthorized\b/i
];

export function soldOutCatalogHistoryDescription() {
  return "Sold out. This sealed Pokemon TCG World Championships Deck product is listed for catalog history only and is not currently available for purchase from GameDayGrabs.";
}

function decodeCommonMojibake(value: string) {
  return value
    .replace(/Pok(?:\?|ï¿½|ÃƒÂ©)mon/gi, "Pokémon")
    .replace(/Pok(?:\?|ï¿½|ÃƒÂ©)\s*Ball/gi, "Poké Ball")
    .replace(/Poke\s*Ball/gi, "Poké Ball")
    .replace(/Pokeball/gi, "Poké Ball")
    .replace(/Pokemon/gi, "Pokémon")
    .replace(/TCG/gi, "TCG")
    .replace(/Ã¢â‚¬â„¢/g, "'")
    .replace(/Ã¢â‚¬Å“|Ã¢â‚¬ï¿½/g, '"')
    .replace(/Ã¢â‚¬â€œ|Ã¢â‚¬â€/g, "-")
    .replace(/Ã‚Â·/g, "·")
    .replace(/Ã‚/g, "");
}

export function normalizeStorefrontCopy(value: string | null | undefined) {
  if (!value) return "";
  const normalized = decodeCommonMojibake(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\bProduct\s+Details\s+Card\s+Text\s*:\s*/gi, "")
    .replace(/\bProduct\s+Details\s*:\s*$/gi, "")
    .replace(/\bPublic\s+description\s*:\s*/gi, "")
    .replace(/home\?and/gi, "home and")
    .replace(/checkout\?confirmation/gi, "checkout confirmation")
    .replace(/(\w)\?\s*s\b/g, "$1's")
    .replace(/Mega Evolution\?\s*/gi, "Mega Evolution: ")
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
  return fallbackDescriptionPatterns.some((pattern) => pattern.test(normalized));
}

export function generatedStorefrontDescription(product: StorefrontCopyProduct) {
  const title = cleanStorefrontTitle(product.title || product.itemName);
  const category = cleanStorefrontTitle(product.category) || "collectible product";
  const setName = cleanStorefrontTitle(product.setName);
  const condition = cleanStorefrontTitle(product.condition);
  const isSoldOut = product.status === "sold_out" || product.availableQuantity === 0;
  const knownFacts: string[] = [];

  if (setName && !title.toLowerCase().includes(setName.toLowerCase())) {
    knownFacts.push(`From ${setName}.`);
  }

  if (condition) {
    knownFacts.push(`Condition: ${condition}.`);
  }

  if (isSoldOut) {
    knownFacts.push("Currently sold out and not available for checkout.");
  } else if (product.shippingAvailable && product.localPickupEligible) {
    knownFacts.push("Available for shipping or Local Pickup when checkout options are shown.");
  } else if (product.shippingAvailable) {
    knownFacts.push("Available for shipping when checkout options are shown.");
  } else if (product.localPickupEligible) {
    knownFacts.push("Available for Local Pickup when checkout options are shown.");
  } else {
    knownFacts.push("Fulfillment options are shown before checkout.");
  }

  const subject = title ? `${title} is a ${category.toLowerCase()} listed by GameDayGrabs.` : `This ${category.toLowerCase()} is listed by GameDayGrabs.`;
  return [subject, ...knownFacts].join(" ");
}

export function cleanStorefrontDescription(product: StorefrontCopyProduct) {
  const raw = product.publicDescription || product.description;
  const normalized = normalizeStorefrontCopy(raw);
  if (product.status === "sold_out" && counterfeitReviewRiskPatterns.some((pattern) => pattern.test(normalized))) {
    return soldOutCatalogHistoryDescription();
  }
  if (hasLowQualityStorefrontDescription(raw)) {
    return generatedStorefrontDescription(product);
  }
  return normalized;
}

export function storefrontSoldOutNote() {
  return "This item is currently sold out and is not available for checkout. It may return if restocked.";
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
