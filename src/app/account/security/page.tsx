import { unstable_noStore as noStore } from "next/cache";
import {
  AccountSecurity,
  AccountSignInRequired,
  CustomerAccountShell,
  CustomerAccountsComingSoon
} from "@/components/CustomerAccountPages";
import {
  currentCustomerAccount,
  customerAccountsEnabled,
  customerSecurityCenterEnabled,
  listCustomerAccountSecuritySessions
} from "@/lib/customer-account-auth";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const securityUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/account/security`;
const securityTitle = "Account Security | GameDayGrabs LLC";
const securityDescription = "Review and manage active GameDayGrabs customer account sessions.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: securityTitle,
  description: securityDescription,
  alternates: {
    canonical: securityUrl
  },
  robots: {
    index: false,
    follow: false
  },
  openGraph: {
    title: securityTitle,
    description: securityDescription,
    url: securityUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: securityTitle,
    description: securityDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

type AccountSecurityPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function AccountSecurityPage({ searchParams }: AccountSecurityPageProps) {
  noStore();
  const params = searchParams ? await searchParams : {};
  const enabled = customerAccountsEnabled();
  const securityEnabled = customerSecurityCenterEnabled();
  const account = enabled && securityEnabled ? await currentCustomerAccount() : null;
  const sessions = account ? await listCustomerAccountSecuritySessions(account) : [];

  return (
    <CustomerAccountShell>
      {!enabled || !securityEnabled ? (
        <CustomerAccountsComingSoon />
      ) : account ? (
        <AccountSecurity account={account} sessions={sessions} status={firstParam(params.securityStatus)} />
      ) : (
        <AccountSignInRequired title="Sign in to manage account security." />
      )}
    </CustomerAccountShell>
  );
}
