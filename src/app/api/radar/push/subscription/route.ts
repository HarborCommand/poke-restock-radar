import { requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { disableBrowserPushSubscription, saveBrowserPushSubscription } from "@/lib/push";
import { pushSubscriptionSchema, pushUnsubscribeSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = pushSubscriptionSchema.parse(await readJson(request));
    return ok(await saveBrowserPushSubscription(user, input, request.headers.get("user-agent")));
  } catch (error) {
    return badRequest(error);
  }
}

export async function DELETE(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const input = pushUnsubscribeSchema.parse(await readJson(request));
    return ok(await disableBrowserPushSubscription(user, input.endpoint));
  } catch (error) {
    return badRequest(error);
  }
}
