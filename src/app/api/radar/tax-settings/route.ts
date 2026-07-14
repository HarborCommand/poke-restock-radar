import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { privateOk, readJson, safeMutationError, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { getTaxAdminSettings, saveTaxAdminSettings } from "@/lib/tax-admin";
import { taxAdminSettingsSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withRequestId(response, requestId);
  const adminResponse = requireAdmin(user);
  if (adminResponse) return withRequestId(adminResponse, requestId);
  return withRequestId(privateOk(await getTaxAdminSettings(user.id)), requestId);
}

export async function PATCH(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withRequestId(response, requestId);
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return authorizationResponse;
  try {
    const input = taxAdminSettingsSchema.parse(await readJson(request));
    return withRequestId(privateOk(await saveTaxAdminSettings(user, input, requestId)), requestId);
  } catch (error) {
    return safeMutationError(error, requestId, "Tax settings could not be saved.");
  }
}
