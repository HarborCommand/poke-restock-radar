import { unstable_noStore as noStore } from "next/cache";
import { AccountForgotPasswordPageContent, CustomerAccountShell } from "@/components/CustomerAccountPages";
import { currentCustomerAccount } from "@/lib/customer-account-auth";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const forgotPasswordUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/account/forgot-password`;
const forgotPasswordTitle = "Reset Customer Password | GameDayGrabs LLC";
const forgotPasswordDescription = "Request a secure GameDayGrabs customer account password reset link.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: forgotPasswordTitle,
  description: forgotPasswordDescription,
  alternates: {
    canonical: forgotPasswordUrl
  },
  robots: {
    index: false,
    follow: false
  },
  openGraph: {
    title: forgotPasswordTitle,
    description: forgotPasswordDescription,
    url: forgotPasswordUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: forgotPasswordTitle,
    description: forgotPasswordDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

type AccountForgotPasswordPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function AccountForgotPasswordPage({ searchParams }: AccountForgotPasswordPageProps) {
  noStore();
  const [params, account] = await Promise.all([
    searchParams ? searchParams : Promise.resolve({} as Record<string, string | string[] | undefined>),
    currentCustomerAccount()
  ]);

  return (
    <CustomerAccountShell>
      <AccountForgotPasswordPageContent account={account} resetStatus={firstParam(params.resetStatus)} />
    </CustomerAccountShell>
  );
}
