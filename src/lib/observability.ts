import { createHash, randomUUID } from "node:crypto";

const sensitiveKey = /(?:password|secret|token|authorization|cookie|hash|database.?url|email|phone|address|payment.?reference)/i;
const requestIdPattern = /^[a-zA-Z0-9._:-]{8,80}$/;

export function requestCorrelationId(request?: Request | null) {
  const supplied = request?.headers.get("x-request-id")?.trim();
  return supplied && requestIdPattern.test(supplied) ? supplied : randomUUID();
}

export function safeEntityRef(value: string | null | undefined) {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function sanitizeLogText(value: unknown) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text
    .replace(/(?:postgres(?:ql)?|mysql|mongodb|redis|file):\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/bearer\s+[a-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(?:sk|pk|whsec|sess|tok)_[a-z0-9_-]{8,}/gi, "[REDACTED_TOKEN]")
    .slice(0, 500);
}

export function redactLogValue(value: unknown, key = "", depth = 0): unknown {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (depth > 4) return "[TRUNCATED]";
  if (value instanceof Error) return { name: value.name, message: sanitizeLogText(value) };
  if (typeof value === "string") return sanitizeLogText(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => redactLogValue(entry, "", depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 40)
        .map(([entryKey, entryValue]) => [entryKey, redactLogValue(entryValue, entryKey, depth + 1)])
    );
  }
  return value;
}

export function safeErrorCategory(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (/^p\d{4}$/i.test(code)) return "database";
  if (/validation|invalid|required|expected/.test(message)) return "validation";
  if (/unauth|forbidden|permission|access required/.test(message)) return "authorization";
  if (/duplicate|already|conflict|unique/.test(message)) return "conflict";
  if (/timeout|unavailable|connection|network/.test(message)) return "dependency";
  return "internal";
}

type ServerEvent = {
  level?: "info" | "warn" | "error";
  requestId: string;
  route: string;
  operation: string;
  status: number;
  durationMs?: number;
  entityType?: string;
  entityRef?: string | null;
  error?: unknown;
  metadata?: Record<string, unknown>;
};

export function logServerEvent(input: ServerEvent) {
  const level = input.level ?? (input.status >= 500 ? "error" : input.status >= 400 ? "warn" : "info");
  const event = redactLogValue({
    event: "server_operation",
    timestamp: new Date().toISOString(),
    ...input,
    level,
    errorCategory: input.error ? safeErrorCategory(input.error) : undefined,
    error: input.error ? sanitizeLogText(input.error) : undefined
  });
  const line = JSON.stringify(event);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
