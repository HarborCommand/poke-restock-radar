import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { privateOk, readJson, safeApiError, safeMutationError, withRequestId } from "@/lib/http";
import { logServerEvent, requestCorrelationId, runWithRequestContext, safeEntityRef } from "@/lib/observability";
import { attachAdminCustomerOrder, searchAdminCustomerAttachCandidates } from "@/lib/admin-customer-order-links";
import { getAdminCustomerRewardDetail } from "@/lib/rewards-admin";
import { adminCustomerAttachOrderSchema, adminCustomerAttachOrderSearchSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ customerAccountId: string }> }) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  const { user, response } = await requireUser();
  if (response) return withRequestId(response, requestId);
  const adminResponse = requireAdmin(user);
  if (adminResponse) return withRequestId(adminResponse, requestId);

  let customerAccountId: string | null = null;
  try {
    ({ customerAccountId } = await context.params);
    const url = new URL(request.url);
    const input = adminCustomerAttachOrderSearchSchema.parse({
      query: url.searchParams.get("query") ?? undefined
    });
    const result = await searchAdminCustomerAttachCandidates(user.id, customerAccountId, input.query);
    return withRequestId(privateOk(result), requestId);
  } catch (error) {
    logServerEvent({
      requestId,
      route: "/api/radar/customers/[customerAccountId]/attach-order",
      operation: "customer_link.search",
      status: 400,
      durationMs: Date.now() - startedAt,
      entityType: "CUSTOMER_ACCOUNT",
      entityRef: safeEntityRef(customerAccountId),
      error
    });
    return safeMutationError(error, requestId, "The purchase search could not be completed.");
  }
}

export async function POST(request: Request, context: { params: Promise<{ customerAccountId: string }> }) {
  const requestId = requestCorrelationId(request);
  const startedAt = Date.now();
  const { user, response } = await requireUser();
  if (response) return withRequestId(response, requestId);
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return withRequestId(adminResponse, requestId);

  return runWithRequestContext(requestId, async () => {
    let customerAccountId: string | null = null;
    try {
      ({ customerAccountId } = await context.params);
      const input = adminCustomerAttachOrderSchema.parse(await readJson(request));
      const result = await attachAdminCustomerOrder(user, customerAccountId, input, getAdminCustomerRewardDetail);
      return withRequestId(privateOk(result), requestId);
    } catch (error) {
      logServerEvent({
        requestId,
        route: "/api/radar/customers/[customerAccountId]/attach-order",
        operation: "customer_link.apply",
        status: /not found/i.test(error instanceof Error ? error.message : "") ? 404 : 400,
        durationMs: Date.now() - startedAt,
        entityType: "CUSTOMER_ACCOUNT",
        entityRef: safeEntityRef(customerAccountId),
        error
      });
      if (/not found/i.test(error instanceof Error ? error.message : "")) {
        return safeApiError("NOT_FOUND", "The requested record was not found.", 404, requestId);
      }
      return safeMutationError(error, requestId, "The purchase could not be linked.");
    }
  });
}
