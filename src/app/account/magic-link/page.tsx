import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { redirect } from "next/navigation";
import { ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { CustomerAccountShell } from "@/components/CustomerAccountPages";
import { currentCustomerAccount } from "@/lib/customer-account-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Confirm Account Sign-In | GameDayGrabs LLC",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const
};

type MagicLinkPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export default async function CustomerMagicLinkPage({ searchParams }: MagicLinkPageProps) {
  noStore();
  const [params, account] = await Promise.all([
    searchParams ? searchParams : Promise.resolve({} as Record<string, string | string[] | undefined>),
    currentCustomerAccount()
  ]);

  if (account) redirect("/account");

  const token = firstParam(params.token)?.trim() || null;
  const missing = !token || firstParam(params.error) === "missing";

  return (
    <CustomerAccountShell focusedAuth>
      <div className="gdg-login-page">
        <section className="gdg-login-welcome" aria-labelledby="gdg-magic-link-welcome-title">
          <h1 id="gdg-magic-link-welcome-title">Secure account sign-in.</h1>
          <p className="gdg-login-lede">
            One last tap protects your one-time link and gets you into your GameDayGrabs account.
          </p>
          <div className="gdg-login-benefits" aria-label="Secure sign-in details">
            <div className="gdg-login-benefit">
              <span className="gdg-login-benefit-icon green">
                <ShieldCheck size={25} strokeWidth={2.25} aria-hidden="true" />
              </span>
              <p>
                <strong>Protected</strong>
                <span>The link is not used until you confirm.</span>
              </p>
            </div>
            <div className="gdg-login-benefit">
              <span className="gdg-login-benefit-icon gold">
                <Mail size={25} strokeWidth={2.25} aria-hidden="true" />
              </span>
              <p>
                <strong>Email verified</strong>
                <span>Continue with the same email that received this link.</span>
              </p>
            </div>
          </div>
        </section>

        <section className="gdg-login-auth-card compact" aria-labelledby="gdg-magic-link-title">
          <div className="gdg-login-card-heading">
            <p className="gdg-overline">Secure Sign-In</p>
            <h2 id="gdg-magic-link-title">Continue to your account.</h2>
            <p>Confirm below to use this one-time sign-in link.</p>
          </div>

          {missing ? (
            <>
              <p className="gdg-account-notice error">This sign-in link is missing or incomplete.</p>
              <div className="gdg-account-actions">
                <Link href="/account/login" className="gdg-primary-button">Request a New Link</Link>
                <Link href="/shop" className="gdg-secondary-button">Back to Shop</Link>
              </div>
            </>
          ) : (
            <form className="gdg-account-form gdg-login-form" action="/api/account/magic-link/verify" method="post">
              <input type="hidden" name="token" value={token} />
              <p className="gdg-account-notice good">Your sign-in link is ready to confirm.</p>
              <button className="gdg-primary-button wide gdg-login-submit" type="submit">
                <span>Continue to Account</span>
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </form>
          )}

          <p className="gdg-account-helper gdg-login-helper">
            This confirmation prevents email security checks from using your one-time link before you do.
          </p>
        </section>
      </div>
    </CustomerAccountShell>
  );
}
