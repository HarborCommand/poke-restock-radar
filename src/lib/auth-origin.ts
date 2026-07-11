import { NextResponse } from "next/server";
import { privateNoStoreHeaders } from "@/lib/http";

function configuredOrigins(request: Request) {
  const origins = new Set<string>([new URL(request.url).origin]);
  for (const name of ["STORE_BASE_URL", "APP_URL"] as const) {
    const value = process.env[name]?.trim();
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") origins.add(url.origin);
    } catch {
      // Environment validation reports malformed configured URLs separately.
    }
  }
  return origins;
}

export function safeAuthBaseUrl(requestUrl?: string | null, preference: "app" | "store" = "app") {
  const configuredValues = preference === "store"
    ? [process.env.STORE_BASE_URL, process.env.APP_URL]
    : [process.env.APP_URL, process.env.STORE_BASE_URL];
  for (const value of configuredValues) {
    if (!value?.trim()) continue;
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Configured authentication URL is invalid.");
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("Configured authentication URL must use HTTPS.");
    }
    return url.origin;
  }
  if (requestUrl && process.env.NODE_ENV !== "production") return new URL(requestUrl).origin;
  if (process.env.NODE_ENV === "production") throw new Error("Authentication URL is not configured.");
  return "http://localhost:3000";
}

export class AuthOriginError extends Error {
  constructor() {
    super("Invalid authentication request origin.");
    this.name = "AuthOriginError";
  }
}

export function assertSameOriginRequest(request: Request) {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site") throw new AuthOriginError();

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const sourceUrl = origin || referer;
  if (!sourceUrl) {
    if (fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none") return;
    throw new AuthOriginError();
  }

  let requestOrigin: string;
  try {
    requestOrigin = new URL(sourceUrl).origin;
  } catch {
    throw new AuthOriginError();
  }
  if (!configuredOrigins(request).has(requestOrigin)) throw new AuthOriginError();
}

export function authOriginErrorResponse() {
  return NextResponse.json(
    { error: "This authentication request could not be verified. Refresh the page and try again." },
    { status: 403, headers: privateNoStoreHeaders }
  );
}
