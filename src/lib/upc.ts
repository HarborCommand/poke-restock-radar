export function normalizeUPC(value: string | number | null | undefined) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 14);
}

export function validateUPC(value: string | number | null | undefined) {
  return /^\d{6,14}$/.test(normalizeUPC(value));
}

export function compactLookupText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || null;
}
