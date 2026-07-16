import { z } from "zod";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { requireAdmin, requireUser } from "@/lib/auth";
import { privateOk, readJson, safeMutationError, withPrivateNoStore, withRequestId } from "@/lib/http";
import { requestCorrelationId } from "@/lib/observability";
import { getTaxGoLiveSwitchboard, saveTaxGoLiveApprovals } from "@/lib/tax-go-live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const approvalSchema = z.object({
  ownerApproved: z.boolean(),
  accountantReviewed: z.boolean(),
  accountantReviewNote: z.string().trim().max(500)
}).strict().superRefine((input, context) => {
  if (input.accountantReviewed && input.accountantReviewNote.length < 3) context.addIssue({ code: z.ZodIssueCode.custom, path: ["accountantReviewNote"], message: "Record a short accountant review note." });
});

export async function GET(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const adminResponse = requireAdmin(user);
  if (adminResponse) return withPrivateNoStore(withRequestId(adminResponse, requestId));
  return withPrivateNoStore(withRequestId(privateOk(await getTaxGoLiveSwitchboard(user)), requestId));
}

export async function PATCH(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withPrivateNoStore(withRequestId(response, requestId));
  const authorizationResponse = authorizeAdminMutation(request, user);
  if (authorizationResponse) return withPrivateNoStore(withRequestId(authorizationResponse, requestId));
  try {
    const input = approvalSchema.parse(await readJson(request));
    return withPrivateNoStore(withRequestId(privateOk(await saveTaxGoLiveApprovals(user, input, requestId)), requestId));
  } catch (error) {
    return safeMutationError(error, requestId, "Tax go-live approvals could not be saved.");
  }
}
