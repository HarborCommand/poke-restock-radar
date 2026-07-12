import { currentCustomerAccount, customerAccountsEnabled } from "@/lib/customer-account-auth";
import {
  assertCustomerSameOriginRequest,
  CustomerAuthOriginError,
  customerAuthOriginErrorResponse
} from "@/lib/customer-auth-rate-limit";
import { prisma } from "@/lib/db";
import { privateJson, readJson } from "@/lib/http";
import { rewardTierIndex } from "@/lib/reward-tiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertCustomerSameOriginRequest(request);
    if (!customerAccountsEnabled()) return privateJson({ error: "Rewards are not enabled." }, 404);

    const account = await currentCustomerAccount();
    if (!account) return privateJson({ error: "Sign in required." }, 401);

    const input = await readJson(request);
    const requestedTier = typeof input.tier === "number" ? Math.floor(input.tier) : -1;
    const currentTier = rewardTierIndex(account.rewardBalance?.lifetimeEarnedPoints ?? 0);
    if (requestedTier !== currentTier) return privateJson({ error: "Tier is no longer current." }, 409);

    await prisma.customerAccount.updateMany({
      where: {
        id: account.id,
        highestAcknowledgedRewardTier: { lt: currentTier }
      },
      data: { highestAcknowledgedRewardTier: currentTier }
    });

    return privateJson({ ok: true, highestAcknowledgedRewardTier: Math.max(account.highestAcknowledgedRewardTier, currentTier) });
  } catch (error) {
    if (error instanceof CustomerAuthOriginError) return customerAuthOriginErrorResponse();
    return privateJson({ error: "Unable to acknowledge reward tier." }, 400);
  }
}
