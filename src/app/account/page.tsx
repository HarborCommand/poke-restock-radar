import { unstable_noStore as noStore } from "next/cache";
import {
  AccountDashboard,
  AccountSignInRequired,
  CustomerAccountShell,
  CustomerAccountsComingSoon
} from "@/components/CustomerAccountPages";
import { currentCustomerAccount, customerAccountsEnabled, listCustomerAccountOrders } from "@/lib/customer-account-auth";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const accountUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/account`;
const accountTitle = "Customer Account | GameDayGrabs LLC";
const accountDescription =
  "Access your optional GameDayGrabs customer account, order history, rewards, saved addresses, and support links.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: accountTitle,
  description: accountDescription,
  alternates: {
    canonical: accountUrl
  },
  openGraph: {
    title: accountTitle,
    description: accountDescription,
    url: accountUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: accountTitle,
    description: accountDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function AccountPage() {
  noStore();
  const enabled = customerAccountsEnabled();
  const account = enabled ? await currentCustomerAccount() : null;
  const recentOrders = account ? await listCustomerAccountOrders(account) : [];

  return (
    <CustomerAccountShell>
      {!enabled ? <CustomerAccountsComingSoon /> : account ? <AccountDashboard account={account} recentOrders={recentOrders} /> : <AccountSignInRequired />}
    </CustomerAccountShell>
  );
}
