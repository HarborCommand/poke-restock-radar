import { unstable_noStore as noStore } from "next/cache";
import {
  AccountRewards,
  AccountSignInRequired,
  CustomerAccountShell,
  CustomerAccountsComingSoon
} from "@/components/CustomerAccountPages";
import { currentCustomerAccount, customerAccountsEnabled } from "@/lib/customer-account-auth";
import { listCustomerRewardActivity } from "@/lib/customer-rewards";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const rewardsUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/account/rewards`;
const rewardsTitle = "Customer Rewards | GameDayGrabs LLC";
const rewardsDescription = "View optional GameDayGrabs customer rewards points, activity, and account reward status.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: rewardsTitle,
  description: rewardsDescription,
  alternates: {
    canonical: rewardsUrl
  },
  openGraph: {
    title: rewardsTitle,
    description: rewardsDescription,
    url: rewardsUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: rewardsTitle,
    description: rewardsDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function AccountRewardsPage() {
  noStore();
  const enabled = customerAccountsEnabled();
  const account = enabled ? await currentCustomerAccount() : null;
  const activity = account ? await listCustomerRewardActivity(account) : [];

  return (
    <CustomerAccountShell>
      {!enabled ? (
        <CustomerAccountsComingSoon />
      ) : account ? (
        <AccountRewards account={account} activity={activity} />
      ) : (
        <AccountSignInRequired title="Sign in to view rewards." />
      )}
    </CustomerAccountShell>
  );
}
