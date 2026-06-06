export const GAMEDAYGRABS_DOMAIN = "gamedaygrabs.com";
export const GAMEDAYGRABS_WWW_DOMAIN = "www.gamedaygrabs.com";
export const GAMEDAYGRABS_PUBLIC_URL = `https://${GAMEDAYGRABS_DOMAIN}`;

export function normalizedHost(host: string | null | undefined) {
  return (host || "").toLowerCase().split(":")[0]?.trim() || "";
}

export function isGameDayGrabsHost(host: string | null | undefined) {
  const normalized = normalizedHost(host);
  return normalized === GAMEDAYGRABS_DOMAIN || normalized === GAMEDAYGRABS_WWW_DOMAIN;
}
