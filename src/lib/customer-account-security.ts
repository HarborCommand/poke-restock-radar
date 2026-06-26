export type VerifiedCustomerIdentityInput = {
  id: string;
  email: string | null;
  emailVerifiedAt: Date | string | null;
};

export function normalizeCustomerEmail(value: string | null | undefined) {
  const email = value?.trim().toLowerCase();
  return email && email.includes("@") ? email : null;
}

export function verifiedCustomerIdentity(account: VerifiedCustomerIdentityInput | null | undefined) {
  const email = normalizeCustomerEmail(account?.email);
  if (!account?.id || !account.emailVerifiedAt || !email) return null;
  return {
    customerAccountId: account.id,
    email
  };
}

export function customerVisibleOrderWhere(account: VerifiedCustomerIdentityInput, orderNumber?: string | null) {
  const identity = verifiedCustomerIdentity(account);
  const cleanOrderNumber = orderNumber?.trim();
  if (!identity || orderNumber !== undefined && !cleanOrderNumber) return null;

  return {
    ...(cleanOrderNumber ? { orderNumber: cleanOrderNumber } : {}),
    isTestOrder: false,
    OR: [
      { customerAccountId: identity.customerAccountId },
      {
        customerAccountId: null,
        customer: { is: { customerAccountId: identity.customerAccountId } }
      },
      { customerAccountId: null, customerEmail: identity.email },
      {
        customerAccountId: null,
        customer: { is: { email: identity.email } }
      }
    ]
  };
}

export function hasClientSuppliedCustomerOwnership(input: unknown) {
  if (!input || typeof input !== "object") return false;
  const blockedKeys = new Set([
    "customerAccountId",
    "accountEmail",
    "ownerId",
    "sessionId",
    "rewardOwnerId",
    "rewardBalanceOwnerId",
    "addressOwnerId",
    "orderOwnerId"
  ]);
  return Object.keys(input).some((key) => blockedKeys.has(key));
}
