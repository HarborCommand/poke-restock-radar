export const GAMEDAYGRABS_DOMAIN = "gamedaygrabs.com";
export const GAMEDAYGRABS_WWW_DOMAIN = "www.gamedaygrabs.com";
export const GAMEDAYGRABS_PUBLIC_URL = `https://${GAMEDAYGRABS_DOMAIN}`;
export const GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL = "gamedaygrabs@outlook.com";
export const LEGACY_PUBLIC_CONTACT_EMAIL = "ariverah7@gmail.com";

export function normalizedHost(host: string | null | undefined) {
  return (host || "").toLowerCase().split(":")[0]?.trim() || "";
}

export function isGameDayGrabsHost(host: string | null | undefined) {
  const normalized = normalizedHost(host);
  return normalized === GAMEDAYGRABS_DOMAIN || normalized === GAMEDAYGRABS_WWW_DOMAIN;
}

export function storefrontContactEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === LEGACY_PUBLIC_CONTACT_EMAIL) {
    return GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;
  }
  return normalized;
}
