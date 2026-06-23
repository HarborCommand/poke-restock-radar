import {
  AccountOrderDetail,
  AccountOrderNotFound,
  AccountSignInRequired,
  CustomerAccountShell,
  CustomerAccountsComingSoon
} from "@/components/CustomerAccountPages";
import {
  currentCustomerAccount,
  customerAccountsEnabled,
  getCustomerAccountOrderDetail
} from "@/lib/customer-account-auth";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const orderDetailTitle = "Customer Order Details | GameDayGrabs LLC";
const orderDetailDescription = "View safe customer-facing GameDayGrabs order details after verifying your checkout email.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: orderDetailTitle,
  description: orderDetailDescription,
  robots: {
    index: false,
    follow: false
  },
  openGraph: {
    title: orderDetailTitle,
    description: orderDetailDescription,
    url: `${GAMEDAYGRABS_CANONICAL_ORIGIN}/account/orders`,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: orderDetailTitle,
    description: orderDetailDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

export default async function AccountOrderDetailPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const enabled = customerAccountsEnabled();
  const account = enabled ? await currentCustomerAccount() : null;
  const { orderNumber } = await params;
  const order = account ? await getCustomerAccountOrderDetail(account, decodeURIComponent(orderNumber)) : null;

  return (
    <CustomerAccountShell>
      {!enabled ? (
        <CustomerAccountsComingSoon />
      ) : account && order ? (
        <AccountOrderDetail account={account} order={order} />
      ) : account ? (
        <AccountOrderNotFound />
      ) : (
        <AccountSignInRequired title="Sign in to view this order." />
      )}
    </CustomerAccountShell>
  );
}
