import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { badRequest, privateJson, privateOk, readJson } from "@/lib/http";
import { authorizePosMutation, hasPosRole, resolvePosStoreUser } from "@/lib/pos-authorization";
import { getAdminCustomerRewardDetail, updateAdminCustomerProfile } from "@/lib/rewards-admin";
import { workspaceCustomerWhereWithLegacy } from "@/lib/customer-workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const posCustomerProfileUpdateSchema = z.object({
  displayName: z.string().trim().max(120).nullable(),
  phone: z.string().trim().max(40).nullable(),
  adminNote: z.string().trim().max(1000).nullable()
});

function emptyToNull(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

async function customerWithContact(ownerUserId: string, customerAccountId: string) {
  const customer = await getAdminCustomerRewardDetail(ownerUserId, customerAccountId);
  if (!customer) return null;

  const customerScope = await workspaceCustomerWhereWithLegacy(prisma, ownerUserId);
  const contact = await prisma.customerAccount.findFirst({
    where: { AND: [{ id: customerAccountId }, customerScope] },
    select: { email: true }
  });
  if (!contact) return null;

  return {
    ...customer,
    email: contact.email
  };
}

export async function GET(_request: Request, context: { params: Promise<{ customerAccountId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!hasPosRole(user)) return privateJson({ error: "POS access required" }, 403);

  const storeUser = await resolvePosStoreUser(user);
  const { customerAccountId } = await context.params;
  const customer = await customerWithContact(storeUser.id, customerAccountId);
  if (!customer) return privateJson({ error: "Customer account was not found." }, 404);

  return privateOk({ customer });
}

export async function PATCH(request: Request, context: { params: Promise<{ customerAccountId: string }> }) {
  const { user, response } = await requireUser();
  if (response) return response;
  const authorizationResponse = authorizePosMutation(request, user);
  if (authorizationResponse) return authorizationResponse;

  try {
    const storeUser = await resolvePosStoreUser(user);
    const { customerAccountId } = await context.params;
    const current = await getAdminCustomerRewardDetail(storeUser.id, customerAccountId);
    if (!current) return privateJson({ error: "Customer account was not found." }, 404);

    const input = posCustomerProfileUpdateSchema.parse(await readJson(request));
    await updateAdminCustomerProfile(storeUser.id, customerAccountId, {
      displayName: emptyToNull(input.displayName),
      phone: emptyToNull(input.phone),
      status: current.profile.status === "disabled" ? "disabled" : "active",
      adminNote: emptyToNull(input.adminNote)
    });

    await logAudit({
      user,
      action: "customer.profile.updated_from_pos",
      entityType: "CUSTOMER_ACCOUNT",
      entityId: customerAccountId,
      summary: `${user.email} updated customer contact information from POS.`,
      metadata: {
        customerAccountId,
        hasPhone: Boolean(input.phone),
        hasAdminNote: Boolean(input.adminNote)
      }
    });

    const customer = await customerWithContact(storeUser.id, customerAccountId);
    if (!customer) return privateJson({ error: "Customer account was not found after update." }, 404);
    return privateOk({ customer });
  } catch (error) {
    return badRequest(error);
  }
}
