import { CustomerAccountShell, CustomerLoginPageContent } from "@/components/CustomerAccountPages";
import { currentCustomerAccount } from "@/lib/customer-account-auth";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const loginUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/account/login`;
const loginTitle = "Customer Login | GameDayGrabs LLC";
const loginDescription = "Email yourself a secure GameDayGrabs customer account sign-in link.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: loginTitle,
  description: loginDescription,
  alternates: {
    canonical: loginUrl
  },
  openGraph: {
    title: loginTitle,
    description: loginDescription,
    url: loginUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: loginTitle,
    description: loginDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

type AccountLoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function AccountLoginPage({ searchParams }: AccountLoginPageProps) {
  const [params, account] = await Promise.all([
    searchParams ? searchParams : Promise.resolve({} as Record<string, string | string[] | undefined>),
    currentCustomerAccount()
  ]);

  return (
    <CustomerAccountShell>
      <CustomerLoginPageContent
        account={account}
        sent={firstParam(params.sent)}
        error={firstParam(params.error)}
        signedOut={firstParam(params.signedOut)}
      />
    </CustomerAccountShell>
  );
}
