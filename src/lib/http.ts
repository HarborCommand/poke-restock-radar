import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { sanitizeLogText } from "@/lib/observability";

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
  return NextResponse.json(
    { error: message, requestId },
    { status: 500, headers: { ...privateNoStoreHeaders, "x-request-id": requestId } }
  );
}

export function safeMutationError(error: unknown, requestId: string, fallback = "The update could not be completed.") {
  if (error instanceof ZodError) return withRequestId(badRequest(error), requestId);
  const message = error instanceof Error ? error.message : "";
  const safeBusinessError =
    /(?:not found|already|disabled|cannot|must|required|invalid|refunded|canceled|insufficient|unavailable)/i.test(message) &&
    !/(?:postgres|prisma|sql|database|connection|string|stack|environment|secret|token|hash|https?:\/\/)/i.test(message);
  if (safeBusinessError) {
    return NextResponse.json(
      { error: sanitizeLogText(message).slice(0, 240), requestId },
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
          message: issue.message
        }))
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ error: error instanceof Error ? error.message : "Bad request" }, { status: 400 });
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
