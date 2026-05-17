import { requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { sendTestAlert } from "@/lib/notifications";
import { testAlertSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = testAlertSchema.parse(await readJson(request));
    return ok(await sendTestAlert(user, input.channel));
  } catch (error) {
    return badRequest(error);
  }
}
