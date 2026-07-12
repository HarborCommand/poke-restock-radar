import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomUUID } from "node:crypto";

const sensitiveKey = /(?:pass(?:word|phrase)?|credential|secret|token|authorization|cookie|session|hash|database.?url|connection.?string|api.?key|email|phone|address|internal.?note|admin.?note|idempotency.?key|payment.?reference|webhook.?signature|card|cvc|cvv)/i;
const requestIdPattern = /^[a-zA-Z0-9._-]{8,64}$/;
const maxLogTextLength = 1_000;
const maxRecentEvents = 100;
const requestContext = new AsyncLocalStorage<{ requestId: string }>();
const securityEventWindows = new Map<string, { startedAt: number; count: number }>();

export type ServerEvent = {
  level?: "info" | "warn" | "error";
  requestId?: string | null;
  route: string;
  operation: string;
  status: number;
  durationMs?: number;
  entityType?: string;
  entityRef?: string | null;
  error?: unknown;
  metadata?: Record<string, unknown>;
};

type StoredServerEvent = {
  timestamp: string;
  level: "info" | "warn" | "error";
  operation: string;
  route: string;
  status: number;
  requestId: string;
  errorCategory: string | null;
};

const recentEvents: StoredServerEvent[] = [];

function observabilityHashSecret() {
  return process.env.OBSERVABILITY_HASH_SECRET?.trim() || process.env.AUTH_SECRET?.trim() || "local-observability-reference";
}

function sanitizePlainText(value: string) {
  return value
    .replace(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|file):\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]")
    .replace(
      /\b(password(?:hash)?|passphrase|secret|token|api.?key|database.?url|authorization|cookie|session|internal.?note|admin.?note|idempotency.?key|payment.?reference|address)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1=[REDACTED]"
    )
    .replace(/\b(?:authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:sk|pk|rk|whsec|sess|tok|re)_[a-z0-9_-]{8,}\b/gi, "[REDACTED_TOKEN]")
    .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, "[REDACTED_PHONE]")
    .replace(
      /\b((?:customer|account|order|sale|user)[_-]?(?:id|reference))\s*[:=]\s*[a-z0-9._:-]+/gi,
      (_match, label: string) => `${label}=[REDACTED]`
    )
    .replace(/\bc[a-z0-9]{20,}\b/gi, "[REDACTED_IDENTIFIER]")
    .replace(/https?:\/\/[^\s"'?#]+(?:\?[^\s"'#]*)?(?:#[^\s"']*)?/gi, (url) => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return "[REDACTED_URL]";
      }
    })
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, maxLogTextLength);
}

export function normalizeRequestId(value: string | null | undefined) {
  const supplied = value?.trim();
  return supplied && requestIdPattern.test(supplied) ? supplied : null;
}

export function requestCorrelationId(request?: Request | null) {
  return normalizeRequestId(request?.headers.get("x-request-id")) ?? randomUUID();
}

export function currentRequestId() {
  return requestContext.getStore()?.requestId ?? null;
}

export function runWithRequestContext<T>(requestId: string, operation: () => T) {
  return requestContext.run({ requestId: normalizeRequestId(requestId) ?? randomUUID() }, operation);
}

export function safeEntityRef(value: string | null | undefined) {
  if (!value) return null;
  return createHmac("sha256", observabilityHashSecret()).update(value).digest("hex").slice(0, 16);
}

export function sanitizeLogText(value: unknown) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  const trimmed = text.trim();
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && trimmed.length <= 20_000) {
    try {
      return JSON.stringify(redactLogValue(JSON.parse(trimmed)));
    } catch {
      // Non-JSON diagnostic text is sanitized as plain text below.
    }
  }
  return sanitizePlainText(text);
}

export function redactLogValue(value: unknown, key = "", depth = 0): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (depth > 5) return "[TRUNCATED]";
  if (value instanceof Error) {
    return {
      name: sanitizePlainText(value.name),
      message: sanitizePlainText(value.message),
      stack: value.stack ? sanitizePlainText(value.stack).slice(0, 2_000) : undefined
    };
  }
  if (typeof value === "string") return sanitizeLogText(value);
  if (Array.isArray(value)) return value.slice(0, 25).map((entry) => redactLogValue(entry, "", depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([entryKey, entryValue]) => [entryKey, redactLogValue(entryValue, entryKey, depth + 1)])
    );
  }
  return value;
}

export function safeErrorCategory(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (/^p\d{4}$/i.test(code)) return code === "P2002" ? "conflict" : code === "P2034" ? "serialization" : "database";
  if (/unauth|forbidden|permission|access required|origin/.test(message)) return "authorization";
  if (/validation|invalid|required|expected/.test(message)) return "validation";
  if (/rate.?limit|too many/.test(message)) return "rate_limit";
  if (/duplicate|already|conflict|unique/.test(message)) return "conflict";
  if (/timeout|unavailable|connection|network/.test(message)) return "dependency";
  return "internal";
}

function rememberEvent(event: StoredServerEvent) {
  recentEvents.push(event);
  if (recentEvents.length > maxRecentEvents) recentEvents.splice(0, recentEvents.length - maxRecentEvents);
}

export function logServerEvent(input: ServerEvent) {
  try {
    const requestId = normalizeRequestId(input.requestId) ?? currentRequestId() ?? randomUUID();
    const level = input.level ?? (input.status >= 500 ? "error" : input.status >= 400 ? "warn" : "info");
    const errorCategory = input.error ? safeErrorCategory(input.error) : null;
    const timestamp = new Date().toISOString();
    const event = redactLogValue({
      event: "server_operation",
      timestamp,
      ...input,
      requestId,
      level,
      route: sanitizePlainText(input.route).slice(0, 160),
      operation: sanitizePlainText(input.operation).slice(0, 120),
      entityRef: input.entityRef
        ? /^[a-f0-9]{16}$/i.test(input.entityRef)
          ? input.entityRef
          : safeEntityRef(input.entityRef)
        : undefined,
      errorCategory,
      error: input.error ? redactLogValue(input.error) : undefined,
      deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || undefined,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown"
    });
    rememberEvent({
      timestamp,
      level,
      operation: sanitizePlainText(input.operation).slice(0, 120),
      route: sanitizePlainText(input.route).slice(0, 160),
      status: input.status,
      requestId,
      errorCategory
    });
    const line = JSON.stringify(event);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  } catch {
    // Observability is best effort and must never change business transaction outcomes.
  }
}

export function logMutationBreadcrumb(input: Omit<ServerEvent, "status"> & { result: string; status?: number }) {
  logServerEvent({
    ...input,
    status: input.status ?? 200,
    metadata: { ...(input.metadata ?? {}), result: input.result }
  });
}

export function logSecurityEvent(input: ServerEvent) {
  const key = `${input.route}:${input.operation}`;
  const now = Date.now();
  const existing = securityEventWindows.get(key);
  const window = !existing || now - existing.startedAt >= 60_000 ? { startedAt: now, count: 1 } : { ...existing, count: existing.count + 1 };
  securityEventWindows.set(key, window);
  if (securityEventWindows.size > 100) {
    const oldest = Array.from(securityEventWindows.entries()).sort((a, b) => a[1].startedAt - b[1].startedAt)[0]?.[0];
    if (oldest) securityEventWindows.delete(oldest);
  }
  if (window.count <= 20 || window.count % 50 === 0) {
    logServerEvent({ ...input, metadata: { ...(input.metadata ?? {}), occurrenceInWindow: window.count } });
  }
}

export function observabilitySnapshot(limit = 25) {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const counts = recentEvents.reduce<Record<string, number>>((result, event) => {
    const key = event.errorCategory || (event.status >= 400 ? "other_error" : "success");
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
  return { counts, recent: recentEvents.slice(-safeLimit).reverse().map((event) => ({ ...event })) };
}

export function resetObservabilityForTests() {
  recentEvents.splice(0, recentEvents.length);
  securityEventWindows.clear();
}
