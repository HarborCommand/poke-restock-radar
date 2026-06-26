import { unstable_noStore as noStore } from "next/cache";
import { AccountResetPasswordPageContent, CustomerAccountShell } from "@/components/CustomerAccountPages";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const resetPasswordUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/account/reset-password`;
const resetPasswordTitle = "Choose a New Password | GameDayGrabs LLC";
const resetPasswordDescription = "Choose a new password for your optional GameDayGrabs customer account.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: resetPasswordTitle,
  description: resetPasswordDescription,
  alternates: {
    canonical: resetPasswordUrl
  },
  robots: {
    index: false,
    follow: false
  },
  openGraph: {
    title: resetPasswordTitle,
    description: resetPasswordDescription,
    url: resetPasswordUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: resetPasswordTitle,
    description: resetPasswordDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

type AccountResetPasswordPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function AccountResetPasswordPage({ searchParams }: AccountResetPasswordPageProps) {
  noStore();
  const params = searchParams ? await searchParams : {};
  return (
    <CustomerAccountShell>
      <AccountResetPasswordPageContent token={firstParam(params.token)} resetError={firstParam(params.resetError)} />
    </CustomerAccountShell>
  );
}
