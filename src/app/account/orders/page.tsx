import {
  AccountOrders,
  AccountSignInRequired,
  CustomerAccountShell,
  CustomerAccountsComingSoon
} from "@/components/CustomerAccountPages";
import { currentCustomerAccount, customerAccountsEnabled, listCustomerAccountOrders } from "@/lib/customer-account-auth";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";
import { GAMEDAYGRABS_CANONICAL_ORIGIN, GAMEDAYGRABS_OG_FALLBACK_IMAGE } from "@/lib/storefront-seo";

const ordersUrl = `${GAMEDAYGRABS_CANONICAL_ORIGIN}/account/orders`;
const ordersTitle = "Customer Order History | GameDayGrabs LLC";
const ordersDescription = "View your own GameDayGrabs order history after verifying your checkout email.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  metadataBase: new URL(GAMEDAYGRABS_CANONICAL_ORIGIN),
  title: ordersTitle,
  description: ordersDescription,
  alternates: {
    canonical: ordersUrl
  },
  openGraph: {
    title: ordersTitle,
    description: ordersDescription,
    url: ordersUrl,
    siteName: "GameDayGrabs LLC",
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  twitter: {
    card: "summary_large_image",
    title: ordersTitle,
    description: ordersDescription,
    images: [GAMEDAYGRABS_OG_FALLBACK_IMAGE]
  },
  other: {
    "contact:email": GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL
  }
};

type AccountOrdersPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function orderHistoryView(value: string | string[] | undefined) {
  const view = firstParam(value);
  return view === "completed" || view === "refunded-canceled" || view === "all" ? view : "active";
}

export default async function AccountOrdersPage({ searchParams }: AccountOrdersPageProps) {
  const params = searchParams ? await searchParams : {};
  const enabled = customerAccountsEnabled();
  const account = enabled ? await currentCustomerAccount() : null;
  const orders = account ? await listCustomerAccountOrders(account) : [];

  return (
    <CustomerAccountShell>
      {!enabled ? (
        <CustomerAccountsComingSoon />
      ) : account ? (
        <AccountOrders account={account} orders={orders} view={orderHistoryView(params.view)} />
      ) : (
        <AccountSignInRequired title="Sign in to view your order history." />
      )}
    </CustomerAccountShell>
  );
}
