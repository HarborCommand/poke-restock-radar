import { NextResponse } from "next/server";
import { ZodError } from "zod";

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
