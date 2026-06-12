import { requireUser } from "@/lib/auth";
import { ok } from "@/lib/http";
import { listDashboard } from "@/lib/radar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  try {
    return ok(await listDashboard(user));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown dashboard error";
    console.error("[radar-dashboard] failed to load private dashboard", error);
    return Response.json(
      {
        error: "Private dashboard failed to load after sign-in.",
        detail: message.slice(0, 500)
      },
      { status: 500 }
    );
  }
}
