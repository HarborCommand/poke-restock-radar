import { Prisma } from "@prisma/client";

/**
 * Customer-account ownership is explicit. Contact matches and business
 * relationships never transfer an identity into another owner's workspace.
 */
export function workspaceCustomerWhere(ownerUserId: string) {
  return { userId: ownerUserId } satisfies Prisma.CustomerAccountWhereInput;
}
