import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { runProductMonitorBatch } from "@/lib/monitor";
import { monitorRunSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  try {
    const input = monitorRunSchema.parse(await readJson(request));
    return ok(await runProductMonitorBatch(input.mode));
  } catch (error) {
    return badRequest(error);
  }
}
