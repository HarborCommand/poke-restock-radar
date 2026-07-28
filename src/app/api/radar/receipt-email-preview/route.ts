import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { privateJson, readJson, safeMutationError, withRequestId } from "@/lib/http";
import { PublicRateLimitExceededError, checkPublicRateLimit, publicRateLimitResponse } from "@/lib/rate-limit";
import { requestCorrelationId } from "@/lib/observability";
import { buildReceiptEmailPreview, sendReceiptEmailPreviewToAdmin } from "@/lib/receipt-email-preview";
import { receiptEmailSenderDiagnostics } from "@/lib/receipt-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewSchema = z.object({
  previewType: z.enum(["storefront", "pos"])
});

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  return privateJson({
    diagnostics: receiptEmailSenderDiagnostics(),
    previews: {
      storefront: buildReceiptEmailPreview("storefront"),
      pos: buildReceiptEmailPreview("pos")
    }
  });
}

export async function POST(request: Request) {
  const requestId = requestCorrelationId(request);
  const { user, response } = await requireUser();
  if (response) return withRequestId(response, requestId);
  const adminResponse = authorizeAdminMutation(request, user);
  if (adminResponse) return withRequestId(adminResponse, requestId);

  try {
    const input = previewSchema.parse(await readJson(request));
    await checkPublicRateLimit({
      request,
      action: "admin_receipt_preview_test",
      identifiers: [{ scope: "email", value: user.email }]
    });
    const result = await sendReceiptEmailPreviewToAdmin({ user, previewType: input.previewType, requestId });
    return withRequestId(privateJson({ result }), requestId);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return withRequestId(publicRateLimitResponse(error), requestId);
    return safeMutationError(error, requestId, "The receipt preview email could not be sent.");
  }
}
