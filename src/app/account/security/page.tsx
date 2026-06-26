import { unstable_noStore as noStore } from "next/cache";
import {
  AccountSecurityUnavailable,
  CustomerAccountShell,
  CustomerAccountsComingSoon
} from "@/components/CustomerAccountPages";
import { customerAccountsEnabled } from "@/lib/customer-account-auth";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const securityUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/account/security`;
const securityTitle = "Account Support | GameDayGrabs LLC";
const securityDescription = "GameDayGrabs account support and automatic sign-in protections.";

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

export default async function AccountSecurityPage({ searchParams }: AccountSecurityPageProps) {
  noStore();
  if (searchParams) await searchParams;
  const enabled = customerAccountsEnabled();

  return (
    <CustomerAccountShell>
      {!enabled ? (
        <CustomerAccountsComingSoon />
      ) : (
        <AccountSecurityUnavailable />
      )}
    </CustomerAccountShell>
  );
}
