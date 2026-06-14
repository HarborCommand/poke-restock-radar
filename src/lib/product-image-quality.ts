export type ProductImageQualityWarning =
  | "invalid_url"
  | "product_page_url"
  | "preorder_or_promo_marker"
  | "watermark_or_badge_marker"
  | "low_resolution_marker"
  | "fallback_source_marker";

const productPagePatterns = [
  { host: "bestbuy.com", path: /^\/(product|site)\// },
  { host: "target.com", path: /^\/p\// },
  { host: "walmart.com", path: /^\/ip\// },
  { host: "amazon.com", path: /^\/(dp|gp\/product)\// },
  { host: "pokemoncenter.com", path: /^\/product\// },
  { host: "gamestop.com", path: /^\/.+\/products?\// }
];

function normalizedImageUrl(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function decodedLowercaseUrl(value: string) {
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function parseImageUrl(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return null;
  return new URL(value);
}

function hasLowResolutionMarker(value: string) {
  return (
    /(?:^|[/?&=._-])(?:1[0-9]{2}|2[0-9]{2})x(?:1[0-9]{2}|2[0-9]{2})(?:[/?&=._-]|$)/.test(value) ||
    /\/(?:1[0-9]{2}|2[0-9]{2})\/(?:1[0-9]{2}|2[0-9]{2})\/(?:true|false|fit|fill|crop|resize)(?:\/|$)/.test(value) ||
    /(?:^|[/?&=._-])(?:1[0-9]{2}|2[0-9]{2})\.(?:jpg|jpeg|png|webp)(?:[?&#]|$)/.test(value) ||
    /[?&](?:wid|width|w|hei|height|h)=(?:[1-9][0-9]|1[0-9]{2}|2[0-9]{2})(?:[&#]|$)/.test(value)
  );
}

function hasKnownFallbackSourceMarker(value: string) {
  try {
    const parsed = parseImageUrl(value);
    if (!parsed) return false;
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    return (
      (host.endsWith("booksamillion.com") && pathname.includes("/covers/gift/")) ||
      host.includes("pricecharting.com") ||
      host.endsWith("spellenrijk.nl") ||
      host.endsWith("cdnmp.net") ||
      host.endsWith("rollntrade.com") ||
      host.endsWith("target.scene7.com")
    );
  } catch {
    return false;
  }
}

export function isProductImageUrlRenderable(url: string | null | undefined) {
  const value = normalizedImageUrl(url);
  if (!value) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const parsed = parseImageUrl(value);
    if (!parsed) return true;
    if (!["http:", "https:", "blob:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (productPagePatterns.some((pattern) => host.endsWith(pattern.host) && pattern.path.test(pathname))) return false;
    return true;
  } catch {
    return false;
  }
}

export function productImageQualityWarnings(url: string | null | undefined): ProductImageQualityWarning[] {
  const value = normalizedImageUrl(url);
  if (!value) return ["invalid_url"];
  const decoded = decodedLowercaseUrl(value);
  const warnings: ProductImageQualityWarning[] = [];

  try {
    const parsed = parseImageUrl(value);
    if (parsed) {
      if (!["http:", "https:", "blob:"].includes(parsed.protocol)) warnings.push("invalid_url");
      const host = parsed.hostname.toLowerCase();
      const pathname = parsed.pathname.toLowerCase();
      if (productPagePatterns.some((pattern) => host.endsWith(pattern.host) && pattern.path.test(pathname))) {
        warnings.push("product_page_url");
      }
    }
  } catch {
    warnings.push("invalid_url");
  }

  if (/\bpre[-_\s]?order\b|\bpreorder\b|coming[-_\s]?soon/.test(decoded)) warnings.push("preorder_or_promo_marker");
  if (/\bwatermark\b|\bbadge\b|\bsticker\b|\bpromo\b|\bretailer[-_\s]?logo\b/.test(decoded)) warnings.push("watermark_or_badge_marker");
  if (hasLowResolutionMarker(decoded)) warnings.push("low_resolution_marker");
  if (hasKnownFallbackSourceMarker(value)) warnings.push("fallback_source_marker");

  return [...new Set(warnings)];
}

export function isStorefrontDisplayImageUrl(url: string | null | undefined) {
  const value = normalizedImageUrl(url);
  if (value.startsWith("blob:")) return false;
  if (!isProductImageUrlRenderable(value)) return false;
  const warnings = productImageQualityWarnings(url);
  return warnings.length === 0;
}
