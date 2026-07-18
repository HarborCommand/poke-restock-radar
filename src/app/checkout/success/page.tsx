import { CheckoutSuccessClient, StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { customerAccountFeatureConfig } from "@/lib/customer-accounts";
import { getStorefrontSettings } from "@/lib/storefront";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Order Confirmed | GameDayGrabs LLC",
  description: "Your GameDayGrabs order was received.",
  robots: {
    index: false,
    follow: false
  }
};

export default async function CheckoutSuccessPage({ searchParams }: { searchParams: Promise<{ order?: string; number?: string }> }) {
  const params = await searchParams;
  const orderReference = params.number || params.order || "";
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  const customerAccountFeatures = customerAccountFeatureConfig();
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <CheckoutSuccessClient
        orderReference={orderReference}
        accountCtaEnabled={customerAccountFeatures.customerAccountsEnabled}
        rewardsCtaEnabled={customerAccountFeatures.customerAccountsEnabled && customerAccountFeatures.customerRewardsEnabled}
      />
      <StorefrontFooter settings={settings} homeHref={homeHref} />
    </main>
  );
}
