import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { safeErrorCategory, sanitizeLogText } from "@/lib/observability";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export const privateNoStoreHeaders = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
  Pragma: "no-cache",
  Expires: "0"
};

export function privateOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: privateNoStoreHeaders });
}

export function privateJson<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: privateNoStoreHeaders });
}

export function withPrivateNoStore<T extends NextResponse>(response: T) {
  for (const [name, value] of Object.entries(privateNoStoreHeaders)) {
    response.headers.set(name, value);
  }
  return response;
}

export function withRequestId<T extends Response>(response: T, requestId: string) {
  response.headers.set("x-request-id", requestId);
  return response;
}

export function internalServerError(requestId: string, message = "The request could not be completed.") {
  return safeApiError("INTERNAL_ERROR", message, 500, requestId);
}

export function safeApiError(code: string, message: string, status: number, requestId: string, retryable = false) {
  return NextResponse.json(
    { error: message, code, requestId, retryable },
    { status, headers: { ...privateNoStoreHeaders, "x-request-id": requestId } }
  );
}

function validationError(error: ZodError, requestId: string) {
  return NextResponse.json(
    {
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      requestId,
      retryable: false,
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: sanitizeLogText(issue.message).slice(0, 160)
      }))
    },
    { status: 400, headers: { ...privateNoStoreHeaders, "x-request-id": requestId } }
  );
}

function knownErrorResponse(error: unknown, requestId: string) {
  const category = safeErrorCategory(error);
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "P2002") {
    return safeApiError("CONFLICT", "That update conflicts with an existing record.", 409, requestId);
  }
  if (code === "POS_TAX_QUOTE_CONFLICT") {
    return safeApiError("POS_TAX_QUOTE_CONFLICT", "The POS tax quote changed or expired. Refresh the calculation and try again.", 409, requestId);
  }
  if (code === "TAX_REFUND_CONFLICT") {
    return safeApiError("TAX_REFUND_CONFLICT", "The refundable balance changed. Refresh the transaction and try again.", 409, requestId);
  }
  if (code === "TAX_REFUND_AMOUNT_INVALID") {
    return safeApiError("TAX_REFUND_AMOUNT_INVALID", "The requested refund exceeds the remaining refundable amount.", 422, requestId);
  }
  if (code === "P2034" || category === "serialization") {
    return safeApiError("CONFLICT", "The record changed during this update. Please retry.", 409, requestId, true);
  }
  if (code === "P2025") {
    return safeApiError("NOT_FOUND", "The requested record was not found.", 404, requestId);
  }
  return null;
}

function safeBusinessMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const actionable = /(?:not found|already|disabled|cannot|must|required|invalid|refunded|canceled|cancelled|insufficient|unavailable|mismatch|ineligible)/i.test(message);
  const unsafe = /(?:postgres|prisma|sql|database|connection|string|stack|environment|secret|token|hash|https?:\/\/|select\s|insert\s|update\s|delete\s)/i.test(message);
  return actionable && !unsafe ? sanitizeLogText(message).slice(0, 240) : null;
}

export function safeMutationError(error: unknown, requestId: string, fallback = "The update could not be completed.") {
  if (error instanceof ZodError) return validationError(error, requestId);
  const known = knownErrorResponse(error, requestId);
  if (known) return known;
  const safeMessage = safeBusinessMessage(error);
  if (safeMessage) {
    return NextResponse.json(
      { error: safeMessage, code: "BUSINESS_RULE_REJECTED", requestId, retryable: false },
      { status: 400, headers: { ...privateNoStoreHeaders, "x-request-id": requestId } }
    );
  }
  return internalServerError(requestId, fallback);
}

export function badRequest(error: unknown) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: "Validation failed",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: sanitizeLogText(issue.message).slice(0, 160)
        }))
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ error: safeBusinessMessage(error) ?? "Bad request" }, { status: 400 });
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
