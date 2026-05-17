import { requireUser } from "@/lib/auth";
import { badRequest, ok } from "@/lib/http";
import { sendTestBrowserPush } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    return ok(await sendTestBrowserPush(user));
  } catch (error) {
    return badRequest(error);
  }
}
