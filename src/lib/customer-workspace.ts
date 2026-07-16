import { Prisma } from "@prisma/client";

/**
 * Customer-account ownership is explicit. Contact matches and business
 * relationships never transfer an identity into another owner's workspace.
 */
export function workspaceCustomerWhere(ownerUserId: string) {
  return { userId: ownerUserId } satisfies Prisma.CustomerAccountWhereInput;
}

type CustomerWorkspaceQueryClient = {
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<T>;
};

type LegacyCustomerIdRow = {
  id: string;
};

/**
 * Legacy production customer accounts were created before CustomerAccount.userId
 * existed. They can be shown to an admin only when existing owner-scoped purchase
 * records prove the relationship.
 */
export async function legacyWorkspaceCustomerIds(client: CustomerWorkspaceQueryClient, ownerUserId: string) {
  const rows = await client.$queryRaw<LegacyCustomerIdRow[]>`
    SELECT DISTINCT c.id
    FROM "CustomerAccount" c
    WHERE c."userId" IS NULL
      AND (
        EXISTS (
          SELECT 1
          FROM "StorefrontOrder" o
          WHERE o."customerAccountId" = c.id
            AND o."userId" = ${ownerUserId}
        )
        OR EXISTS (
          SELECT 1
          FROM "InventorySale" s
          WHERE s."customerAccountId" = c.id
            AND s."userId" = ${ownerUserId}
        )
        OR EXISTS (
          SELECT 1
          FROM "StorefrontCustomer" sc
          WHERE sc."customerAccountId" = c.id
            AND sc."userId" = ${ownerUserId}
        )
        OR EXISTS (
          SELECT 1
          FROM "StorefrontOrder" o
          WHERE LOWER(o."customerEmail") = LOWER(c.email)
            AND o."userId" = ${ownerUserId}
        )
        OR EXISTS (
          SELECT 1
          FROM "InventorySale" s
          WHERE LOWER(COALESCE(s."customerEmail", '')) = LOWER(c.email)
            AND s."userId" = ${ownerUserId}
        )
        OR EXISTS (
          SELECT 1
          FROM "StorefrontCustomer" sc
          WHERE LOWER(sc.email) = LOWER(c.email)
            AND sc."userId" = ${ownerUserId}
        )
      )
  `;
  return rows.map((row) => row.id);
}

export async function workspaceCustomerWhereWithLegacy(
  client: CustomerWorkspaceQueryClient,
  ownerUserId: string
): Promise<Prisma.CustomerAccountWhereInput> {
  const legacyIds = await legacyWorkspaceCustomerIds(client, ownerUserId);
  if (!legacyIds.length) return workspaceCustomerWhere(ownerUserId);
  return {
    OR: [
      workspaceCustomerWhere(ownerUserId),
      {
        userId: null,
        id: { in: legacyIds }
      }
    ]
  };
}
