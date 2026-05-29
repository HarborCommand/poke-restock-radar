export function normalizeUPC(value: string | number | null | undefined) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 14);
}

export function canonicalProductUPC(value: string | number | null | undefined) {
  const normalized = normalizeUPC(value);
  return /^0\d{12}$/.test(normalized) ? normalized.slice(1) : normalized;
}

export function upcLookupVariants(value: string | number | null | undefined) {
  const normalized = normalizeUPC(value);
  const canonical = canonicalProductUPC(normalized);
  const variants = [canonical, normalized];
  if (/^\d{12}$/.test(canonical)) variants.push(`0${canonical}`);
  return Array.from(new Set(variants.filter(Boolean)));
}

export function validateUPC(value: string | number | null | undefined) {
  return /^\d{6,14}$/.test(normalizeUPC(value));
}

export function compactLookupText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || null;
}
