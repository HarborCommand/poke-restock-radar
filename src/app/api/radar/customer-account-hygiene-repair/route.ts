import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import {
  CustomerAccountHygieneRepairRollbackError,
  customerAccountHygieneRepairConfirmation,
  customerAccountHygieneRepairEnabled,
  customerAccountHygieneRepairOperation,
  customerAccountHygieneRepairSecurityHeaders,
  dryRunCustomerAccountHygieneRepair,
  executeCustomerAccountHygieneRepair
} from "@/lib/customer-account-hygiene-repair";
import { privateOk, readJson, safeApiError, withRequestId } from "@/lib/http";
import { logServerEvent, requestCorrelationId } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmationSchema = z.object({
  operation: z.literal(customerAccountHygieneRepairOperation),
  expectedCandidateCount: z.literal(1),
  confirmation: z.literal(customerAccountHygieneRepairConfirmation)
}).strict();

export async function GET(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withRequestId(customerAccountHygieneRepairSecurityHeaders(response), requestId);
  const adminResponse = requireAdmin(user);
  if (adminResponse) return withRequestId(customerAccountHygieneRepairSecurityHeaders(adminResponse), requestId);

  try {
    const result = await dryRunCustomerAccountHygieneRepair(user.id);
    return withRequestId(customerAccountHygieneRepairSecurityHeaders(privateOk(result)), requestId);
  } catch (error) {
    logServerEvent({
      requestId,
      route: "/api/radar/customer-account-hygiene-repair",
      operation: "customer_account_hygiene_repair_dry_run",
      status: 500,
      error
    });
    return customerAccountHygieneRepairSecurityHeaders(
      safeApiError("CUSTOMER_ACCOUNT_HYGIENE_REPAIR_UNAVAILABLE", "Customer account hygiene repair dry run is unavailable.", 500, requestId)
    );
  }
}

export async function POST(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withRequestId(customerAccountHygieneRepairSecurityHeaders(response), requestId);
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return withRequestId(customerAccountHygieneRepairSecurityHeaders(adminResponse), requestId);

  try {
    confirmationSchema.parse(await readJson(request));
    if (!customerAccountHygieneRepairEnabled()) {
      return customerAccountHygieneRepairSecurityHeaders(
        safeApiError("CUSTOMER_ACCOUNT_HYGIENE_REPAIR_DISABLED", "Customer account hygiene repair is disabled.", 403, requestId)
      );
    }
    const result = await executeCustomerAccountHygieneRepair(user);
    return withRequestId(customerAccountHygieneRepairSecurityHeaders(privateOk(result)), requestId);
  } catch (error) {
    if (error instanceof CustomerAccountHygieneRepairRollbackError) {
      return customerAccountHygieneRepairSecurityHeaders(
        safeApiError("CUSTOMER_ACCOUNT_HYGIENE_REPAIR_BLOCKED", "Customer account hygiene repair was blocked.", 409, requestId)
      );
    }
    if (error instanceof z.ZodError) {
      return customerAccountHygieneRepairSecurityHeaders(
        safeApiError(
          "CUSTOMER_ACCOUNT_HYGIENE_REPAIR_CONFIRMATION_INVALID",
          "Customer account hygiene repair confirmation is invalid.",
          400,
          requestId
        )
      );
    }
    logServerEvent({
      requestId,
      route: "/api/radar/customer-account-hygiene-repair",
      operation: "customer_account_hygiene_repair_execute",
      status: 500,
      error
    });
    return customerAccountHygieneRepairSecurityHeaders(
      safeApiError("CUSTOMER_ACCOUNT_HYGIENE_REPAIR_UNAVAILABLE", "Customer account hygiene repair is unavailable.", 500, requestId)
    );
  }
}
