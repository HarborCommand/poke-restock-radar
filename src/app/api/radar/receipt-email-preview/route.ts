import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { authorizeAdminMutation } from "@/lib/admin-authorization";
import { privateJson, readJson, safeMutationError, withRequestId } from "@/lib/http";
import { PublicRateLimitExceededError, checkPublicRateLimit, publicRateLimitResponse } from "@/lib/rate-limit";
import { requestCorrelationId } from "@/lib/observability";
import { buildReceiptEmailPreview, existingPreviewDeliveryResult, receiptEmailPreviewFixtureOptions, sendReceiptEmailPreviewToAdmin } from "@/lib/receipt-email-preview";
import { receiptEmailSenderDiagnostics } from "@/lib/receipt-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const previewSchema = z.object({
  previewType: z.enum(["storefront", "pos"]),
  previewRequestId: z.string().uuid()
});

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const adminResponse = requireAdmin(user);
  if (adminResponse) return adminResponse;

  return privateJson({
    diagnostics: receiptEmailSenderDiagnostics(),
    previews: {
      storefront: buildReceiptEmailPreview("storefront", process.env, user.email),
      pos: buildReceiptEmailPreview("pos", process.env, user.email)
    },
    fixtureStates: receiptEmailPreviewFixtureOptions.map((fixture) => ({
      key: fixture.key,
      previewType: fixture.previewType,
      label: fixture.label,
      description: fixture.description,
      preview: buildReceiptEmailPreview(fixture.previewType, process.env, user.email, fixture.key)
    }))
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
    const existing = await existingPreviewDeliveryResult({ user, previewType: input.previewType, previewRequestId: input.previewRequestId });
    if (existing) return withRequestId(privateJson({ result: existing }), requestId);
    await checkPublicRateLimit({
      request,
      action: "admin_receipt_preview_test",
      identifiers: [{ scope: "email", value: user.email }]
    });
    const result = await sendReceiptEmailPreviewToAdmin({ user, previewType: input.previewType, previewRequestId: input.previewRequestId, requestId });
    return withRequestId(privateJson({ result }), requestId);
  } catch (error) {
    if (error instanceof PublicRateLimitExceededError) return withRequestId(publicRateLimitResponse(error), requestId);
    return safeMutationError(error, requestId, "The receipt preview email could not be sent.");
  }
}
