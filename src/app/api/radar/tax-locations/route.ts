import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { deleteTaxLocation, listTaxLocations, saveTaxLocation } from "@/lib/tax-location";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function admin(request: Request, mutation = false) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return { requestId, response: withPrivateNoStore(withRequestId(response, requestId)) } as const;
  const adminResponse = mutation ? authorizeAdminMutation(request, user) : requireAdmin(user);
  if (adminResponse) return { requestId, response: withPrivateNoStore(withRequestId(adminResponse, requestId)) } as const;
  return { requestId, user } as const;
}

export async function GET(request: Request) {
  const auth = await admin(request);
  if ("response" in auth) return auth.response;
  return withRequestId(privateOk(await listTaxLocations(auth.user.id)), auth.requestId);
}

export async function POST(request: Request) {
  const auth = await admin(request, true);
  if ("response" in auth) return auth.response;
  try { return withRequestId(privateOk(await saveTaxLocation(auth.user, await readJson(request), auth.requestId), 201), auth.requestId); }
  catch (error) { return safeMutationError(error, auth.requestId, "Tax location could not be saved."); }
}

export async function PATCH(request: Request) {
  const auth = await admin(request, true);
  if ("response" in auth) return auth.response;
  try { return withRequestId(privateOk(await saveTaxLocation(auth.user, await readJson(request), auth.requestId)), auth.requestId); }
  catch (error) { return safeMutationError(error, auth.requestId, "Tax location could not be saved."); }
}

export async function DELETE(request: Request) {
  const auth = await admin(request, true);
  if ("response" in auth) return auth.response;
  try { return withRequestId(privateOk(await deleteTaxLocation(auth.user, await readJson(request), auth.requestId)), auth.requestId); }
  catch (error) { return safeMutationError(error, auth.requestId, "Tax location could not be deleted."); }
}
