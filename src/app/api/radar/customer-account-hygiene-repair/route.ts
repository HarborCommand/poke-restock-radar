import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import {
  type CustomerAccountHygieneRepairReason,
  CustomerAccountHygieneRepairRollbackError,
  customerAccountHygieneRepairConfirmation,
  customerAccountHygieneRepairEnabled,
  customerAccountHygieneRepairOperation,
  customerAccountHygieneRepairSecurityHeaders,
  dryRunCustomerAccountHygieneRepair,
  executeCustomerAccountHygieneRepair
} from "@/lib/customer-account-hygiene-repair";
import { privateJson, privateOk, readJson, safeApiError, withRequestId } from "@/lib/http";
import { logServerEvent, requestCorrelationId, safeErrorCategory } from "@/lib/observability";
import type { SessionUser } from "@/types/radar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmationSchema = z.object({
  operation: z.literal(customerAccountHygieneRepairOperation),
  expectedCandidateCount: z.literal(1),
  confirmation: z.literal(customerAccountHygieneRepairConfirmation)
}).strict();

type AuthResult = Promise<{ user: SessionUser; response?: null } | { user?: null; response: Response }>;

type CustomerAccountHygieneRepairRouteDeps = {
  requireUser: () => AuthResult;
  requireAdmin: (user: SessionUser) => Response | null;
  authorizeAdminMutation: (request: Request, user: SessionUser) => Response | null;
  dryRunCustomerAccountHygieneRepair: typeof dryRunCustomerAccountHygieneRepair;
  executeCustomerAccountHygieneRepair: typeof executeCustomerAccountHygieneRepair;
  customerAccountHygieneRepairEnabled: typeof customerAccountHygieneRepairEnabled;
  readJson: typeof readJson;
};

const defaultDeps: CustomerAccountHygieneRepairRouteDeps = {
  requireUser,
  requireAdmin,
  authorizeAdminMutation,
  dryRunCustomerAccountHygieneRepair,
  executeCustomerAccountHygieneRepair,
  customerAccountHygieneRepairEnabled,
  readJson
};

function blockedResponse(reasonCodes: CustomerAccountHygieneRepairReason[], requestId: string) {
  return privateJson(
    {
      error: "Customer account hygiene repair was blocked.",
      code: "CUSTOMER_ACCOUNT_HYGIENE_REPAIR_BLOCKED",
      requestId,
      retryable: false,
      repaired: false,
      classification: "BLOCKED",
      reasonCodes
    },
    409
  );
}

function sanitizedFailureMetadata(error: unknown) {
  return { errorCategory: safeErrorCategory(error) };
}

export async function handleCustomerAccountHygieneRepairGET(request: Request, deps: CustomerAccountHygieneRepairRouteDeps = defaultDeps) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await deps.requireUser();
  if (response) return withRequestId(customerAccountHygieneRepairSecurityHeaders(response), requestId);
  const adminResponse = deps.requireAdmin(user);
  if (adminResponse) return withRequestId(customerAccountHygieneRepairSecurityHeaders(adminResponse), requestId);

  try {
    const result = await deps.dryRunCustomerAccountHygieneRepair(user.id);
    return withRequestId(customerAccountHygieneRepairSecurityHeaders(privateOk(result)), requestId);
  } catch (error) {
    logServerEvent({
      requestId,
      route: "/api/radar/customer-account-hygiene-repair",
      operation: "customer_account_hygiene_repair_dry_run",
      status: 500,
      metadata: sanitizedFailureMetadata(error)
    });
    return customerAccountHygieneRepairSecurityHeaders(
      safeApiError("CUSTOMER_ACCOUNT_HYGIENE_REPAIR_UNAVAILABLE", "Customer account hygiene repair dry run is unavailable.", 500, requestId)
    );
  }
}

export async function GET(request: Request) {
  return handleCustomerAccountHygieneRepairGET(request);
}

export async function handleCustomerAccountHygieneRepairPOST(request: Request, deps: CustomerAccountHygieneRepairRouteDeps = defaultDeps) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await deps.requireUser();
  if (response) return withRequestId(customerAccountHygieneRepairSecurityHeaders(response), requestId);
  const adminResponse = deps.authorizeAdminMutation(request, user);
  if (adminResponse) return withRequestId(customerAccountHygieneRepairSecurityHeaders(adminResponse), requestId);

  try {
    confirmationSchema.parse(await deps.readJson(request));
    if (!deps.customerAccountHygieneRepairEnabled()) {
      return customerAccountHygieneRepairSecurityHeaders(
        safeApiError("CUSTOMER_ACCOUNT_HYGIENE_REPAIR_DISABLED", "Customer account hygiene repair is disabled.", 403, requestId)
      );
    }
    const result = await deps.executeCustomerAccountHygieneRepair(user);
    if (!result.repaired && (result.classification === "BLOCKED" || result.classification === "MULTIPLE_ELIGIBLE_CANDIDATES")) {
      return withRequestId(customerAccountHygieneRepairSecurityHeaders(blockedResponse(result.reasonCodes, requestId)), requestId);
    }
    return withRequestId(customerAccountHygieneRepairSecurityHeaders(privateOk(result)), requestId);
  } catch (error) {
    if (error instanceof CustomerAccountHygieneRepairRollbackError) {
      return withRequestId(customerAccountHygieneRepairSecurityHeaders(blockedResponse(error.reasonCodes, requestId)), requestId);
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
      metadata: sanitizedFailureMetadata(error)
    });
    return customerAccountHygieneRepairSecurityHeaders(
      safeApiError("CUSTOMER_ACCOUNT_HYGIENE_REPAIR_UNAVAILABLE", "Customer account hygiene repair is unavailable.", 500, requestId)
    );
  }
}

export async function POST(request: Request) {
  return handleCustomerAccountHygieneRepairPOST(request);
}
