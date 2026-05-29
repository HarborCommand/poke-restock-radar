export function normalizeUPC(value: string | number | null | undefined) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 14);
}

function upcEToUpcA(value: string) {
  const digits = normalizeUPC(value);
  if (!/^\d{8}$/.test(digits)) return null;
  const numberSystem = digits[0];
  const checkDigit = digits[7];
  const body = digits.slice(1, 7);
  const [d1, d2, d3, d4, d5, d6] = body.split("");
  if (!"01".includes(numberSystem)) return null;
  if (["0", "1", "2"].includes(d6)) return `${numberSystem}${d1}${d2}${d6}0000${d3}${d4}${d5}${checkDigit}`;
  if (d6 === "3") return `${numberSystem}${d1}${d2}${d3}00000${d4}${d5}${checkDigit}`;
  if (d6 === "4") return `${numberSystem}${d1}${d2}${d3}${d4}00000${d5}${checkDigit}`;
  return `${numberSystem}${d1}${d2}${d3}${d4}${d5}0000${d6}${checkDigit}`;
}

export function canonicalProductUPC(value: string | number | null | undefined) {
  const normalized = normalizeUPC(value);
  const upcAFromE = upcEToUpcA(normalized);
  if (upcAFromE) return canonicalProductUPC(upcAFromE);
  return /^0\d{12}$/.test(normalized) ? normalized.slice(1) : normalized;
}

export function upcLookupVariants(value: string | number | null | undefined) {
  const normalized = normalizeUPC(value);
  const canonical = canonicalProductUPC(normalized);
  const variants = [canonical, normalized];
  const upcAFromE = upcEToUpcA(normalized);
  if (upcAFromE) variants.push(upcAFromE, canonicalProductUPC(upcAFromE));
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
