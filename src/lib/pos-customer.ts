import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import {
  CustomerAccountIdentityConflictError,
  findCustomerAccountByNormalizedEmail,
  normalizeCustomerAccountEmail
} from "@/lib/customer-account-auth";
import type { PosCustomerMatchResultDTO } from "@/types/radar";

type PosCustomerMatchClient = Prisma.TransactionClient | typeof prisma;

const customerAccountSelect = {
  id: true,
  email: true,
  normalizedEmail: true,
  phone: true,
  status: true,
  emailVerifiedAt: true
} satisfies Prisma.CustomerAccountSelect;

type PosCustomerAccount = Prisma.CustomerAccountGetPayload<{ select: typeof customerAccountSelect }>;

function cleanString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed || null;
}

export function normalizePosCustomerPhone(value: string | null | undefined) {
  const raw = cleanString(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

function inactiveMatch(input: {
  customerEmail: string | null;
  customerPhone: string | null;
  message: string;
  customerMatchMethod?: PosCustomerMatchResultDTO["customerMatchMethod"];
}): PosCustomerMatchResultDTO {
  return {
    customerAccountId: null,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    customerMatchMethod: input.customerMatchMethod ?? "none",
    rewardsEligible: false,
    displayEmail: input.customerEmail,
    displayPhone: input.customerPhone,
    message: input.message
  };
}

function isVerifiedActiveCustomer(account: Pick<PosCustomerAccount, "status" | "emailVerifiedAt">) {
  return account.status === "active" && Boolean(account.emailVerifiedAt);
}

async function accountById(client: PosCustomerMatchClient, id: string) {
  return client.customerAccount.findUnique({
    where: { id },
    select: customerAccountSelect
  });
}

async function findPhoneMatches(client: PosCustomerMatchClient, normalizedPhone: string) {
  const candidates = await client.customerAccount.findMany({
    where: {
      phone: { not: null },
      status: "active"
    },
    select: customerAccountSelect,
    take: 1000
  });
  return candidates.filter((account) => normalizePosCustomerPhone(account.phone) === normalizedPhone);
}

export async function resolvePosCustomerMatch(
  input: { selectedCustomerAccountId?: string | null; customerEmail?: string | null; customerPhone?: string | null },
  client: PosCustomerMatchClient = prisma
): Promise<PosCustomerMatchResultDTO> {
  const selectedCustomerAccountId = input.selectedCustomerAccountId?.trim();
  const normalizedEmail = normalizeCustomerAccountEmail(input.customerEmail);
  const normalizedPhone = normalizePosCustomerPhone(input.customerPhone);

  if (selectedCustomerAccountId) {
    const account = await accountById(client, selectedCustomerAccountId);
    if (!account) {
      return inactiveMatch({
        customerEmail: normalizedEmail,
        customerPhone: normalizedPhone,
        customerMatchMethod: "email_not_found",
        message: "Selected customer could not be verified. Search again before completing the sale."
      });
    }
    const accountPhone = normalizePosCustomerPhone(account.phone);
    if (!isVerifiedActiveCustomer(account)) {
      return inactiveMatch({
        customerEmail: account.email,
        customerPhone: accountPhone,
        customerMatchMethod: "email_unverified",
        message: "Customer selected, but rewards require a verified active account match."
      });
    }

    const rewardsConfig = customerAccountFeatureConfig();
    const posRewardsEnabled =
      rewardsConfig.customerAccountsEnabled && rewardsConfig.customerRewardsEnabled && rewardsConfig.customerPosRewardsEnabled;
    return {
      customerAccountId: account.id,
      customerEmail: account.email,
      customerPhone: accountPhone,
      customerMatchMethod: "email",
      rewardsEligible: posRewardsEnabled,
      displayEmail: account.email,
      displayPhone: accountPhone,
      message: posRewardsEnabled
        ? "Customer linked. Eligible POS subtotal will earn rewards after completed sale."
        : rewardsConfig.customerRewardsEnabled
          ? "Customer linked. POS rewards are disabled until the owner enables POS rewards."
          : "Customer linked. Rewards are not active for POS yet."
    };
  }

  if (!normalizedEmail && !normalizedPhone) {
    return inactiveMatch({
      customerEmail: null,
      customerPhone: null,
      message: "No customer attached."
    });
  }

  if (normalizedEmail) {
    try {
      const accountLookup = await findCustomerAccountByNormalizedEmail(normalizedEmail, client);
      if (!accountLookup) {
        return inactiveMatch({
          customerEmail: normalizedEmail,
          customerPhone: normalizedPhone,
          customerMatchMethod: "email_not_found",
          message: "No verified account matched that email. Contact can be saved on the POS receipt only."
        });
      }
      const account = await accountById(client, accountLookup.id);
      if (!account || !isVerifiedActiveCustomer(account)) {
        return inactiveMatch({
          customerEmail: normalizedEmail,
          customerPhone: normalizedPhone,
          customerMatchMethod: "email_unverified",
          message: "Email found, but the customer account is not verified and active. No rewards will be attached."
        });
      }

      const rewardsConfig = customerAccountFeatureConfig();
      const posRewardsEnabled =
        rewardsConfig.customerAccountsEnabled && rewardsConfig.customerRewardsEnabled && rewardsConfig.customerPosRewardsEnabled;
      return {
        customerAccountId: account.id,
        customerEmail: normalizedEmail,
        customerPhone: normalizedPhone,
        customerMatchMethod: "email",
        rewardsEligible: posRewardsEnabled,
        displayEmail: account.email,
        displayPhone: normalizedPhone,
        message: posRewardsEnabled
          ? "Customer linked. Eligible POS subtotal will earn rewards after completed sale."
          : rewardsConfig.customerRewardsEnabled
            ? "Customer linked. POS rewards are disabled until the owner enables POS rewards."
          : "Customer linked. Rewards are not active for POS yet."
      };
    } catch (error) {
      if (error instanceof CustomerAccountIdentityConflictError) {
        return inactiveMatch({
          customerEmail: normalizedEmail,
          customerPhone: normalizedPhone,
          customerMatchMethod: "email_conflict",
          message: "Multiple customer accounts matched that email. Resolve the account before linking rewards."
        });
      }
      throw error;
    }
  }

  if (!normalizedPhone) {
    return inactiveMatch({
      customerEmail: null,
      customerPhone: null,
      message: "No customer attached."
    });
  }

  const phoneMatches = await findPhoneMatches(client, normalizedPhone);
  const verifiedMatches = phoneMatches.filter(isVerifiedActiveCustomer);
  if (!verifiedMatches.length) {
    return inactiveMatch({
      customerEmail: null,
      customerPhone: normalizedPhone,
      customerMatchMethod: "phone_not_found",
      message: "Phone entered, no verified account match. Enter email to link an account."
    });
  }
  if (verifiedMatches.length > 1) {
    return inactiveMatch({
      customerEmail: null,
      customerPhone: normalizedPhone,
      customerMatchMethod: "phone_multiple",
      message: "Multiple verified accounts match that phone. Enter email to link the correct account."
    });
  }

  return inactiveMatch({
    customerEmail: null,
    customerPhone: normalizedPhone,
    customerMatchMethod: "phone_possible",
    message: "Phone matches one verified account. Enter email to link rewards safely."
  });
}
