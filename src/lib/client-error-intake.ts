import { z } from "zod";
import { normalizeRequestId, sanitizeLogText } from "@/lib/observability";

export const clientErrorPayloadLimit = 8 * 1024;

const clientErrorSchema = z
  .object({
    event: z.enum(["route_error", "unhandled_error", "unhandled_rejection"]),
    message: z.string().trim().min(1).max(500),
    stack: z.string().trim().max(2_000).optional(),
    component: z.string().trim().max(120).optional(),
    url: z.string().trim().max(500).optional(),
    browser: z
      .object({
        name: z.string().trim().max(60).optional(),
        version: z.string().trim().max(30).optional(),
        platform: z.string().trim().max(60).optional()
      })
      .strict()
      .optional(),
    requestId: z.string().trim().max(80).optional()
  })
  .strict();

function sanitizeClientUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

export function parseClientErrorPayload(value: unknown) {
  const input = clientErrorSchema.parse(value);
  return {
    event: input.event,
    message: sanitizeLogText(input.message).slice(0, 500),
    stack: input.stack ? sanitizeLogText(input.stack).slice(0, 2_000) : null,
    component: input.component ? sanitizeLogText(input.component).slice(0, 120) : null,
    url: sanitizeClientUrl(input.url),
    browser: input.browser
      ? {
          name: input.browser.name ? sanitizeLogText(input.browser.name).slice(0, 60) : null,
          version: input.browser.version ? sanitizeLogText(input.browser.version).slice(0, 30) : null,
          platform: input.browser.platform ? sanitizeLogText(input.browser.platform).slice(0, 60) : null
        }
      : null,
    requestId: normalizeRequestId(input.requestId)
  };
}
