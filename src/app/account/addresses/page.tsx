import {
  AccountAddresses,
  AccountSignInRequired,
  CustomerAccountShell,
  CustomerAccountsComingSoon
} from "@/components/CustomerAccountPages";
import { currentCustomerAccount, customerAccountsEnabled } from "@/lib/customer-account-auth";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const addressesUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/account/addresses`;
const addressesTitle = "Saved Addresses | GameDayGrabs LLC";
const addressesDescription = "View the optional GameDayGrabs customer saved address placeholder.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: addressesTitle,
  description: addressesDescription,
  alternates: {
    canonical: addressesUrl
  },
  openGraph: {
    title: addressesTitle,
    description: addressesDescription,
    url: addressesUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: addressesTitle,
    description: addressesDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function AccountAddressesPage() {
  const enabled = customerAccountsEnabled();
  const account = enabled ? await currentCustomerAccount() : null;

  return (
    <CustomerAccountShell>
      {!enabled ? (
        <CustomerAccountsComingSoon />
      ) : account ? (
        <AccountAddresses account={account} />
      ) : (
        <AccountSignInRequired title="Sign in to view saved addresses." />
      )}
    </CustomerAccountShell>
  );
}
