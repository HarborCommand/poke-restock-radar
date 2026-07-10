import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  ChevronRight,
  CheckCircle2,
  Coins,
  Gift,
  Headphones,
  Home,
  LockKeyhole,
  MapPin,
  Mail,
  PackageCheck,
  RefreshCcw,
  Rocket,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Star,
  Trophy,
  TrendingUp,
  UserRound,
  type LucideIcon
} from "lucide-react";
import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { getStorefrontSettings } from "@/lib/storefront";
import {
  customerAccountsEnabled,
  type CurrentCustomerAccount,
  type CustomerAccountOrderDetail,
  type CustomerAccountOrderHistoryItem
} from "@/lib/customer-account-auth";
import { GrabbyMascot } from "@/components/brand/GrabbyMascot";
import type { CustomerRewardActivityItem } from "@/lib/customer-rewards";
import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function dateLabel(value: string | Date | null | undefined) {
  if (!value) return "Not captured";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function addressStatusMessage(value: string | null | undefined) {
  if (value === "created") return "Address saved.";
  if (value === "updated") return "Address updated.";
  if (value === "deleted") return "Address deleted.";
  if (value === "default") return "Default address updated.";
  if (value === "error") return "Address could not be saved. Check the required fields and ZIP code.";
  return null;
}

function accountStatusMessage(value: string | null | undefined) {
  if (value === "check_email") return "If that email can receive account links, check your inbox to verify and sign in.";
  if (value === "verify_email") return "Check your inbox for a secure verification link before signing in.";
  if (value === "password_reset") return "Your password has been updated.";
  return null;
}

function resetStatusMessage(value: string | null | undefined) {
  if (value === "rate_limited") return "Too many attempts. Please wait a few minutes and try again.";
  if (value === "sent") return "If that email matches an account, a password reset link has been sent.";
  return null;
}

function customerAuthAttemptMessage(value: string | null | undefined) {
  if (value === "rate_limited") return "Too many attempts. Please wait a few minutes and try again.";
  return null;
}

type AccountOrderHistoryView = "active" | "completed" | "refunded-canceled" | "all";

const orderHistoryFilters: Array<{ view: AccountOrderHistoryView; label: string; href: string }> = [
  { view: "active", label: "Active", href: "/account/orders" },
  { view: "completed", label: "Completed", href: "/account/orders?view=completed" },
  { view: "refunded-canceled", label: "Refunded / Canceled", href: "/account/orders?view=refunded-canceled" },
  { view: "all", label: "All", href: "/account/orders?view=all" }
];

function orderHistoryCategory(order: CustomerAccountOrderHistoryItem): Exclude<AccountOrderHistoryView, "all"> {
  const status = order.status.toLowerCase();
  if (
    status.includes("refunded") ||
    status.includes("canceled") ||
    status.includes("expired") ||
    order.paymentStatus === "refunded" ||
    order.paymentStatus === "partially_refunded" ||
    order.paymentStatus === "expired"
  ) {
    return "refunded-canceled";
  }
  if (status === "shipped" || status === "picked up" || order.fulfillmentStatus === "shipped" || order.fulfillmentStatus === "picked_up") {
    return "completed";
  }
  return "active";
}

function orderHistoryRank(order: CustomerAccountOrderHistoryItem) {
  const category = orderHistoryCategory(order);
  if (category === "active") return 0;
  if (category === "completed") return 1;
  return 2;
}

function orderHistoryFiltered(
  orders: CustomerAccountOrderHistoryItem[],
  view: AccountOrderHistoryView
): CustomerAccountOrderHistoryItem[] {
  if (view === "all") {
    return [...orders].sort((left, right) => {
      const rankDiff = orderHistoryRank(left) - orderHistoryRank(right);
      if (rankDiff !== 0) return rankDiff;
      return new Date(right.orderDate).getTime() - new Date(left.orderDate).getTime();
    });
  }
  return orders.filter((order) => orderHistoryCategory(order) === view);
}

function orderHistoryEmptyTitle(view: AccountOrderHistoryView, hasAnyOrders: boolean) {
  if (!hasAnyOrders || view === "all") return "No orders found for this verified email yet.";
  if (view === "completed") return "No completed orders found.";
  if (view === "refunded-canceled") return "No refunded or canceled orders found.";
  return "No active orders found.";
}

function orderHistoryEmptyMessage(view: AccountOrderHistoryView, hasAnyOrders: boolean) {
  if (!hasAnyOrders || view === "all") return "Orders will appear here after your verified account email matches a checkout email.";
  return "Try All to see every non-test order placed with this verified email.";
}

function refundedCanceledNote(order: CustomerAccountOrderHistoryItem) {
  const status = order.status.toLowerCase();
  if (status.includes("refunded") || order.paymentStatus === "refunded" || order.paymentStatus === "partially_refunded") {
    return "This order was refunded.";
  }
  if (status.includes("canceled")) return "This order was canceled.";
  if (status.includes("expired") || order.paymentStatus === "expired") return "This checkout expired.";
  return null;
}

type AccountSection = "overview" | "orders" | "rewards" | "addresses" | "support";

const accountNavigation: Array<{ section: AccountSection; label: string; href: string; icon: LucideIcon }> = [
  { section: "overview", label: "Overview", href: "/account", icon: Home },
  { section: "orders", label: "Orders", href: "/account/orders", icon: PackageCheck },
  { section: "rewards", label: "Rewards", href: "/account/rewards", icon: Gift },
  { section: "addresses", label: "Addresses", href: "/account/addresses", icon: MapPin },
  { section: "support", label: "Support", href: "/contact", icon: Headphones }
];

function AccountNavigation({ active }: { active: AccountSection }) {
  return (
    <nav className="gdg-account-nav" aria-label="Customer account navigation">
      {accountNavigation.map((item) => {
        const Icon = item.icon;
        return (
          <Link key={item.section} href={item.href} className={active === item.section ? "active" : ""}>
            <Icon size={17} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AccountIconBadge({ icon: Icon, tone = "gold" }: { icon: LucideIcon; tone?: "gold" | "green" | "blue" | "violet" | "orange" }) {
  return (
    <span className={`gdg-account-icon-badge ${tone}`}>
      <Icon size={28} aria-hidden="true" />
    </span>
  );
}

function orderStatusTone(order: CustomerAccountOrderHistoryItem) {
  const category = orderHistoryCategory(order);
  if (category === "refunded-canceled") return "muted";
  if (category === "completed") return "good";
  return "active";
}

function AccountHeroGrabby() {
  return (
    <div className="gdg-account-hero-grabby">
      <GrabbyMascot variant="welcome" size="large" className="account-overview" />
      <span>Grabby has your dashboard ready.</span>
    </div>
  );
}

function RewardsInfoStrip({ className = "" }: { className?: string }) {
  const infoItems: Array<{ label: string; copy: string; icon: LucideIcon; tone: "gold" | "violet" | "green" | "blue" }> = [
    { label: "Earn points", copy: "per eligible product dollar.", icon: Trophy, tone: "gold" },
    { label: "Points pending", copy: "until shipped, picked up, or cleared.", icon: Gift, tone: "violet" },
    { label: "Refunds may", copy: "reverse points.", icon: ShieldCheck, tone: "green" },
    { label: "No cash value", copy: "or exchange.", icon: ShieldCheck, tone: "blue" }
  ];

  return (
    <section className={`gdg-rewards-info-strip ${className}`.trim()} aria-label="Rewards rules summary">
      {infoItems.map((item) => (
        <div key={item.label}>
          <AccountIconBadge icon={item.icon} tone={item.tone} />
          <p>
            <strong>{item.label}</strong>
            <span>{item.copy}</span>
          </p>
        </div>
      ))}
    </section>
  );
}

export async function CustomerAccountShell({
  children,
  focusedAuth = false
}: {
  children: ReactNode;
  focusedAuth?: boolean;
}) {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  return (
    <main className={`shop-shell${focusedAuth ? " gdg-auth-focused-shell" : ""}`}>
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className={`gdg-account-shell${focusedAuth ? " auth-focused" : ""}`}>{children}</section>
      {focusedAuth ? null : <StorefrontFooter settings={settings} homeHref={homeHref} />}
    </main>
  );
}

export function CustomerAccountsComingSoon() {
  return (
    <div className="gdg-account-card hero">
      <p className="gdg-overline">Customer Accounts</p>
      <h1>Customer accounts coming soon.</h1>
      <p>
        Guest checkout, order status lookup, and GameDayGrabs support are still available. You do not need an account to
        place an order.
      </p>
      <div className="gdg-account-actions">
        <Link href="/shop" className="gdg-primary-button">Shop as Guest</Link>
        <Link href="/order-status" className="gdg-secondary-button">Check Order Status</Link>
      </div>
    </div>
  );
}

export function AccountSignInRequired({ title = "Sign in to view your account." }: { title?: string }) {
  return (
    <div className="gdg-account-card hero">
      <p className="gdg-overline">Optional Account</p>
      <h1>{title}</h1>
      <p>
        Sign in with your password or a secure email link to view your order history, rewards, saved addresses, and
        support links. Guest checkout remains available.
      </p>
      <div className="gdg-account-actions">
        <Link href="/account/login" className="gdg-primary-button">Sign In</Link>
        <Link href="/order-status" className="gdg-secondary-button">Use Guest Order Lookup</Link>
      </div>
    </div>
  );
}

export function AccountDashboard({
  account,
  recentOrders = []
}: {
  account: CurrentCustomerAccount;
  recentOrders?: CustomerAccountOrderHistoryItem[];
}) {
  const rewardBalance = account.rewardBalance;
  const availablePoints = rewardBalance?.availablePoints ?? 0;
  const lifetimePoints = rewardBalance?.lifetimeEarnedPoints ?? 0;
  const addressCount = account.savedAddresses.length;
  const previewOrders = recentOrders.slice(0, 3);
  const recentOrderItem = previewOrders[0]?.items.find((item) => item.imageUrl) ?? previewOrders[0]?.items[0] ?? null;
  const recentOrderImageUrl = recentOrderItem?.imageUrl ?? null;
  const recentOrderImageAlt = recentOrderItem?.title
    ? `${recentOrderItem.title} from your most recent order`
    : "Most recent order product image";
  const progressPercent = Math.min(100, Math.max(0, Math.round((availablePoints / 500) * 100)));
  const stats: Array<{
    href: string;
    label: string;
    value: string;
    copy: string;
    icon: LucideIcon;
    tone: "gold" | "green" | "blue" | "violet" | "orange";
  }> = [
    {
      href: "/account/orders",
      label: "Orders",
      value: `${recentOrders.length}`,
      copy: recentOrders.length === 1 ? "order tied to this email" : "orders tied to this email",
      icon: ShoppingBag,
      tone: "green"
    },
    {
      href: "/account/rewards",
      label: "Points",
      value: `${availablePoints}`,
      copy: "Redemption coming soon",
      icon: Gift,
      tone: "violet"
    },
    {
      href: "/account/addresses",
      label: "Saved Addresses",
      value: `${addressCount}`,
      copy: addressCount === 1 ? "saved address" : "saved addresses",
      icon: MapPin,
      tone: "blue"
    },
    {
      href: "/order-status",
      label: "Support / Order Status",
      value: "Guest lookup",
      copy: "No account required to buy",
      icon: Headphones,
      tone: "orange"
    }
  ];

  return (
    <div className="gdg-account-dashboard">
      <AccountNavigation active="overview" />

      <div className="gdg-account-hero-dashboard">
        <div className="gdg-account-hero-copy">
          <p className="gdg-overline">Account Overview</p>
          <h1>Welcome back.</h1>
          <p>
            Signed in as <strong>{account.email}</strong>. Track orders, rewards, saved addresses, and support in one
            place.
          </p>
          <div className="gdg-account-hero-actions">
            <Link href="/account/orders" className="gdg-primary-button">Track your collection orders</Link>
            <form action="/api/account/logout" method="post">
              <button className="gdg-secondary-button" type="submit">Sign Out</button>
            </form>
          </div>
          <span className="gdg-account-guest-note">Guest checkout stays available. No account required to buy.</span>
        </div>
        <AccountHeroGrabby />
      </div>

      <div className="gdg-account-stat-grid" aria-label="Account quick stats">
        {stats.map((tile) => (
          <Link key={tile.label} href={tile.href} className="gdg-account-stat-card">
            <AccountIconBadge icon={tile.icon} tone={tile.tone} />
            <div>
              <strong>{tile.value}</strong>
              <span>{tile.label}</span>
              <p>{tile.copy}</p>
            </div>
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        ))}
      </div>

      <div className="gdg-account-dashboard-layout">
        <section className="gdg-account-panel gdg-account-orders-preview">
          <div className={recentOrderImageUrl ? "gdg-account-orders-preview-visual has-image" : "gdg-account-orders-preview-visual"}>
            {recentOrderImageUrl ? (
              <img src={recentOrderImageUrl} alt={recentOrderImageAlt} />
            ) : (
              <>
                <PackageCheck size={28} aria-hidden="true" />
                <span>{previewOrders.length ? "Image unavailable" : "Orders will appear here"}</span>
              </>
            )}
          </div>
          <div className="gdg-account-orders-preview-body">
            <header className="gdg-account-panel-heading">
              <div>
                <p className="gdg-overline">My Orders</p>
                <h2>Recent orders</h2>
              </div>
              <Link href="/account/orders">View all orders <ChevronRight size={16} aria-hidden="true" /></Link>
            </header>
            <p className="gdg-account-panel-copy">
              Orders placed with this verified email, including guest checkout orders, appear here. No payment method
              details are shown.
            </p>
            {previewOrders.length ? (
              <div className="gdg-account-preview-list">
                {previewOrders.map((order) => {
                  const previewItem = order.items[0];
                  return (
                    <Link key={order.orderNumber} href={`/account/orders/${encodeURIComponent(order.orderNumber)}`} className="gdg-account-preview-row">
                      <div className="gdg-account-preview-thumb">
                        {previewItem?.imageUrl ? (
                          // Safe public order snapshot image.
                          <img src={previewItem.imageUrl} alt={`${previewItem.title} thumbnail`} />
                        ) : (
                          <PackageCheck size={18} aria-hidden="true" />
                        )}
                      </div>
                      <div className="gdg-account-preview-main">
                        <strong>{previewItem?.title || order.orderNumber}</strong>
                        <span>{order.orderNumber} - {dateLabel(order.orderDate)}</span>
                      </div>
                      <span className={`gdg-account-status-pill ${orderStatusTone(order)}`}>{order.status}</span>
                      <b>{money(order.totalPaid)}</b>
                      <ChevronRight size={17} aria-hidden="true" />
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="gdg-account-empty-panel">
                <PackageCheck size={22} aria-hidden="true" />
                <strong>No orders found for this verified email yet.</strong>
                <p>Guest checkout orders will appear here after they match your verified account email.</p>
              </div>
            )}
          </div>
        </section>

        <aside className="gdg-account-side-stack">
          <section className="gdg-account-panel gdg-account-rewards-panel">
            <div className="gdg-account-panel-heading">
              <div>
                <p className="gdg-overline">Rewards</p>
                <h2>Rewards Program</h2>
              </div>
              <AccountIconBadge icon={Trophy} tone="gold" />
            </div>
            <strong className="gdg-account-points-display">{availablePoints} points</strong>
            <p>Earn 1 point per $1 on eligible product purchases. Rewards redemption coming soon.</p>
            <div className="gdg-account-progress" aria-label={`${progressPercent}% toward collector milestone`}>
              <span style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="gdg-account-progress-label">
              <span>{lifetimePoints} lifetime pts</span>
              <span>Display only</span>
            </div>
          </section>
          <RewardsInfoStrip className="dashboard" />
        </aside>
      </div>
    </div>
  );
}

export function AccountSecurityUnavailable() {
  return (
    <div className="gdg-account-dashboard">
      <AccountNavigation active="support" />
      <section className="gdg-account-card hero">
        <p className="gdg-overline">Account Support</p>
        <h1>Account security is handled automatically.</h1>
        <p>
          GameDayGrabs keeps sign-in protection, rate limiting, and session timeouts active behind the scenes. Customer
          device management is not shown in the account dashboard.
        </p>
        <div className="gdg-account-actions">
          <Link href="/account" className="gdg-primary-button">My Account</Link>
          <Link href="/contact" className="gdg-secondary-button">Contact Support</Link>
        </div>
        <span className="gdg-account-guest-note">Guest checkout stays available. No payment method details are shown.</span>
      </section>
    </div>
  );
}

const loginBenefits: Array<{ title: string; copy: string; icon: LucideIcon; tone: "gold" | "green" | "blue" }> = [
  { title: "Earn Rewards", copy: "Collect points on eligible purchases.", icon: Trophy, tone: "gold" },
  { title: "Track Orders", copy: "Check status and view order history.", icon: PackageCheck, tone: "green" },
  { title: "Secure & Easy", copy: "Your account is protected.", icon: ShieldCheck, tone: "gold" }
];

function CustomerAuthWelcomePanel() {
  return (
    <section className="gdg-login-welcome" aria-labelledby="gdg-login-title">
      <h1 id="gdg-login-title">Welcome back, Collector!</h1>
      <p className="gdg-login-lede">
        Sign in to manage your orders, earn rewards, and keep your collection growing.
      </p>
      <div className="gdg-login-benefits" aria-label="Account benefits">
        {loginBenefits.map((benefit) => {
          const Icon = benefit.icon;
          return (
            <div key={benefit.title} className="gdg-login-benefit">
              <span className={`gdg-login-benefit-icon ${benefit.tone}`}>
                <Icon size={25} strokeWidth={2.25} aria-hidden="true" />
              </span>
              <p>
                <strong>{benefit.title}</strong>
                <span>{benefit.copy}</span>
              </p>
            </div>
          );
        })}
      </div>
      <div className="gdg-login-grabby" aria-label="Grabby account helper">
        <GrabbyMascot variant="welcome" size="large" />
        <div className="gdg-login-grabby-bubble">
          <strong>{"Hey there! I'm Grabby."}</strong>
          <span>{"Let's get you signed in so we can keep the good pulls coming!"}</span>
        </div>
      </div>
    </section>
  );
}

function AccountAuthPanel({
  overline,
  title,
  copy,
  children
}: {
  overline: string;
  title: string;
  copy: string;
  children: ReactNode;
}) {
  return (
    <div className="gdg-login-page single">
      <CustomerAuthWelcomePanel />
      <section className="gdg-login-auth-card compact" aria-labelledby="gdg-login-card-title">
        <p className="gdg-overline">{overline}</p>
        <h1 id="gdg-login-card-title">{title}</h1>
        <p className="gdg-login-card-copy">{copy}</p>
        {children}
      </section>
    </div>
  );
}

export function CustomerLoginPageContent({
  sent,
  error,
  signedOut,
  accountStatus,
  mode,
  loginError,
  registerError,
  session,
  account
}: {
  sent?: string | null;
  error?: string | null;
  signedOut?: string | null;
  accountStatus?: string | null;
  mode?: string | null;
  loginError?: string | null;
  registerError?: string | null;
  session?: string | null;
  account: CurrentCustomerAccount | null;
}) {
  if (!customerAccountsEnabled()) return <CustomerAccountsComingSoon />;
  if (account) {
    return (
      <AccountAuthPanel
        overline="Already Signed In"
        title="Your account is ready."
        copy={`You are signed in as ${account.email}. Guest checkout is always available.`}
      >
        <div className="gdg-account-actions">
          <Link href="/account" className="gdg-primary-button">Go to Account</Link>
          <form action="/api/account/logout" method="post">
            <button className="gdg-secondary-button" type="submit">Sign Out</button>
          </form>
        </div>
      </AccountAuthPanel>
    );
  }

  const activeMode = mode === "create" ? "create" : "signin";
  const statusMessage = accountStatusMessage(accountStatus);
  const sentRateLimitMessage = customerAuthAttemptMessage(sent);
  const loginRateLimitMessage = customerAuthAttemptMessage(loginError);
  const registerRateLimitMessage = customerAuthAttemptMessage(registerError);
  const magicLinkErrorMessage = customerAuthAttemptMessage(error);

  return (
    <div className="gdg-login-page">
      <CustomerAuthWelcomePanel />
      <section className="gdg-login-auth-card" aria-labelledby="gdg-login-auth-title">
        <div className="gdg-account-tabs gdg-login-tabs" role="tablist" aria-label="Customer account options">
          <Link href="/account/login?mode=signin" className={activeMode === "signin" ? "active" : ""}>Sign In</Link>
          <Link href="/account/login?mode=create" className={activeMode === "create" ? "active" : ""}>Create Account</Link>
        </div>
        <div className="gdg-login-card-heading">
          <p className="gdg-overline">{activeMode === "signin" ? "Welcome Back" : "Create Account"}</p>
          <h2 id="gdg-login-auth-title">{activeMode === "signin" ? "Sign in to your account." : "Start your collector account."}</h2>
          <p>
            {activeMode === "signin"
              ? "Password login stays primary. Email sign-in is optional."
              : "Create an account to track orders and rewards."}
          </p>
        </div>
        <div className="gdg-login-pill-row" aria-label="Account reminders">
          <span>Guest checkout is always available.</span>
          <span>Use your checkout email for rewards.</span>
          <span>Rewards redemption coming soon.</span>
        </div>
        <div className="gdg-login-notices">
          {statusMessage ? <p className="gdg-account-notice good">{statusMessage}</p> : null}
          {sent && !sentRateLimitMessage ? (
            <p className="gdg-account-notice good">
              If that email can receive account links, a sign-in link has been sent. Check your inbox.
            </p>
          ) : null}
          {sentRateLimitMessage ? <p className="gdg-account-notice error">{sentRateLimitMessage}</p> : null}
          {signedOut ? <p className="gdg-account-notice">You have been signed out.</p> : null}
          {session ? <p className="gdg-account-notice">Your session expired. Sign in again to continue.</p> : null}
          {error && !magicLinkErrorMessage ? <p className="gdg-account-notice error">That sign-in link is invalid, expired, or already used.</p> : null}
          {magicLinkErrorMessage ? <p className="gdg-account-notice error">{magicLinkErrorMessage}</p> : null}
          {loginError && !loginRateLimitMessage ? (
            <p className="gdg-account-notice error">
              Email or password is incorrect. Use the email sign-in link or reset your password if needed.
            </p>
          ) : null}
          {loginRateLimitMessage ? <p className="gdg-account-notice error">{loginRateLimitMessage}</p> : null}
          {registerError && !registerRateLimitMessage ? <p className="gdg-account-notice error">We could not create that account. Check the fields and try again.</p> : null}
          {registerRateLimitMessage ? <p className="gdg-account-notice error">{registerRateLimitMessage}</p> : null}
        </div>
        {activeMode === "signin" ? (
          <form className="gdg-account-form gdg-login-form" action="/api/account/login" method="post">
            <label className="gdg-login-field">
              <span>Email address</span>
              <span className="gdg-login-input">
                <Mail size={17} aria-hidden="true" />
                <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
              </span>
            </label>
            <label className="gdg-login-field">
              <span>Password</span>
              <span className="gdg-login-input">
                <LockKeyhole size={17} aria-hidden="true" />
                <input name="password" type="password" autoComplete="current-password" required placeholder="Enter your password" />
              </span>
            </label>
            <div className="gdg-login-form-meta">
              <span>New rewards account? Create or verify it first.</span>
              <Link href="/account/forgot-password" className="gdg-inline-link">Forgot Password?</Link>
            </div>
            <button className="gdg-primary-button wide gdg-login-submit" type="submit">
              <span>Sign In</span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          </form>
        ) : (
          <form className="gdg-account-form gdg-login-form" action="/api/account/register" method="post">
            <label className="gdg-login-field">
              <span>Full name <em>optional</em></span>
              <span className="gdg-login-input">
                <UserRound size={17} aria-hidden="true" />
                <input name="displayName" type="text" autoComplete="name" placeholder="Your name" />
              </span>
            </label>
            <label className="gdg-login-field">
              <span>Email address</span>
              <span className="gdg-login-input">
                <Mail size={17} aria-hidden="true" />
                <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
              </span>
            </label>
            <label className="gdg-login-field">
              <span>Password</span>
              <span className="gdg-login-input">
                <LockKeyhole size={17} aria-hidden="true" />
                <input name="password" type="password" autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" />
              </span>
            </label>
            <label className="gdg-login-field">
              <span>Confirm password</span>
              <span className="gdg-login-input">
                <LockKeyhole size={17} aria-hidden="true" />
                <input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required placeholder="Re-enter password" />
              </span>
            </label>
            <button className="gdg-primary-button wide gdg-login-submit" type="submit">
              <span>Create Account</span>
              <Sparkles size={18} aria-hidden="true" />
            </button>
          </form>
        )}
        <div className="gdg-login-divider" aria-hidden="true"><span>or</span></div>
        <div className="gdg-account-magic-option gdg-login-magic-option">
          <div>
            <h2>Email sign-in link</h2>
            <p>{"No password? We'll send a secure one-time sign-in link."}</p>
          </div>
          <form className="gdg-account-form compact gdg-login-magic-form" action="/api/account/magic-link/request" method="post">
            <label className="gdg-login-field">
              <span>Email address</span>
              <span className="gdg-login-input">
                <Mail size={17} aria-hidden="true" />
                <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
              </span>
            </label>
            <button className="gdg-secondary-button" type="submit">
              <span>Send Sign-In Link</span>
              <Send size={16} aria-hidden="true" />
            </button>
          </form>
        </div>
        <p className="gdg-account-helper gdg-login-helper">
          Use the same email you used at checkout or POS. If points were earned before you created a password, create
          the account or use the email sign-in link to verify that same email first.
        </p>
      </section>
    </div>
  );
}

export function AccountForgotPasswordPageContent({
  resetStatus,
  account
}: {
  resetStatus?: string | null;
  account: CurrentCustomerAccount | null;
}) {
  if (!customerAccountsEnabled()) return <CustomerAccountsComingSoon />;
  if (account) {
    return (
      <AccountAuthPanel
        overline="Password"
        title="You are already signed in."
        copy={`You are signed in as ${account.email}. You can sign out first if you need to reset a different account.`}
      >
        <div className="gdg-account-actions">
          <Link href="/account" className="gdg-primary-button">Go to Account</Link>
          <form action="/api/account/logout" method="post">
            <button className="gdg-secondary-button" type="submit">Sign Out</button>
          </form>
        </div>
      </AccountAuthPanel>
    );
  }
  const statusMessage = resetStatusMessage(resetStatus);
  return (
    <AccountAuthPanel
      overline="Forgot Password"
      title="Reset your password."
      copy="Enter your account email. If it matches an account, we'll send a secure reset link."
    >
      {statusMessage ? <p className="gdg-account-notice good">{statusMessage}</p> : null}
      <form className="gdg-account-form gdg-login-form" action="/api/account/forgot-password" method="post">
        <label className="gdg-login-field">
          <span>Email address</span>
          <span className="gdg-login-input">
            <Mail size={17} aria-hidden="true" />
            <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </span>
        </label>
        <button className="gdg-primary-button wide" type="submit">Send Reset Link</button>
      </form>
      <p className="gdg-account-helper">
        Guest checkout is always available.
      </p>
    </AccountAuthPanel>
  );
}

export function AccountResetPasswordPageContent({
  token,
  resetError
}: {
  token?: string | null;
  resetError?: string | null;
}) {
  if (!customerAccountsEnabled()) return <CustomerAccountsComingSoon />;
  const resetRateLimitMessage = customerAuthAttemptMessage(resetError);
  if (resetRateLimitMessage) {
    return (
      <AccountAuthPanel
        overline="Reset Password"
        title="Please wait before trying again."
        copy={`${resetRateLimitMessage} Guest checkout remains available.`}
      >
        <div className="gdg-account-actions">
          <Link href="/account/forgot-password" className="gdg-primary-button">Request New Link</Link>
          <Link href="/account/login" className="gdg-secondary-button">Back to Sign In</Link>
        </div>
      </AccountAuthPanel>
    );
  }
  if (!token || resetError === "invalid" || resetError === "expired" || resetError === "used") {
    return (
      <AccountAuthPanel
        overline="Reset Password"
        title="This reset link is invalid, expired, or already used."
        copy="Request a new password reset link to continue. Guest checkout is always available."
      >
        <div className="gdg-account-actions">
          <Link href="/account/forgot-password" className="gdg-primary-button">Request New Link</Link>
          <Link href="/account/login" className="gdg-secondary-button">Back to Sign In</Link>
        </div>
      </AccountAuthPanel>
    );
  }
  return (
    <AccountAuthPanel
      overline="Reset Password"
      title="Choose a new password."
      copy="Use at least 8 characters. This link can only be used once."
    >
      {resetError === "password" ? <p className="gdg-account-notice error">Passwords must match and be at least 8 characters.</p> : null}
      <form className="gdg-account-form gdg-login-form" action="/api/account/reset-password" method="post">
        <input type="hidden" name="token" value={token} />
        <label className="gdg-login-field">
          <span>New password</span>
          <span className="gdg-login-input">
            <LockKeyhole size={17} aria-hidden="true" />
            <input name="password" type="password" autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" />
          </span>
        </label>
        <label className="gdg-login-field">
          <span>Confirm password</span>
          <span className="gdg-login-input">
            <LockKeyhole size={17} aria-hidden="true" />
            <input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required placeholder="Re-enter password" />
          </span>
        </label>
        <button className="gdg-primary-button wide" type="submit">Update Password</button>
      </form>
      <p className="gdg-account-helper">
        Guest checkout is always available.
      </p>
    </AccountAuthPanel>
  );
}

export function AccountOrders({
  account,
  orders,
  view = "active"
}: {
  account: CurrentCustomerAccount;
  orders: CustomerAccountOrderHistoryItem[];
  view?: AccountOrderHistoryView;
}) {
  const visibleOrders = orderHistoryFiltered(orders, view);
  const hasAnyOrders = orders.length > 0;
  return (
    <>
      <AccountNavigation active="orders" />
      <div className="gdg-account-card hero">
        <p className="gdg-overline">Order History</p>
        <h1>Your GameDayGrabs orders.</h1>
        <p>
          These orders were placed with your verified email, including guest checkout orders. No payment method details
          are shown.
        </p>
        <p>Verified email: <strong>{account.email}</strong>. Guest order lookup remains available.</p>
        <div className="gdg-account-mini-grid" aria-label="Order history privacy notes">
          <span>Verified email only</span>
          <span>No payment method details shown</span>
          <span>Test orders hidden</span>
          <span>Guest checkout unchanged</span>
        </div>
        <nav className="gdg-account-order-filters" aria-label="Order history filters">
          {orderHistoryFilters.map((filter) => (
            <Link key={filter.view} href={filter.href} className={view === filter.view ? "active" : ""}>
              {filter.label}
            </Link>
          ))}
        </nav>
      </div>
      {visibleOrders.length ? (
        <div className="gdg-account-orders">
          {visibleOrders.map((order) => {
            const historyNote = refundedCanceledNote(order);
            return (
            <article key={order.orderNumber} className="gdg-account-order-card">
              <header>
                <div>
                  <span>{dateLabel(order.orderDate)}</span>
                  <h2>{order.orderNumber}</h2>
                </div>
                <strong>{money(order.totalPaid)}</strong>
              </header>
              <div className="gdg-account-order-grid">
                <div>
                  <span>Status</span>
                  <strong>{order.status}</strong>
                </div>
                <div>
                  <span>Fulfillment</span>
                  <strong>{order.fulfillmentMethod === "local_pickup" ? "Local Pickup" : order.shippingMethodLabel || "Standard Shipping"}</strong>
                </div>
                <div>
                  <span>Shipping charged</span>
                  <strong>{money(order.shippingCharged)}</strong>
                </div>
                <div>
                  <span>{order.fulfillmentMethod === "local_pickup" ? "Pickup status" : "Tracking"}</span>
                  {order.fulfillmentMethod === "local_pickup" ? (
                    <strong>{order.pickupStatus || "Pickup pending"}</strong>
                  ) : order.trackingNumber ? (
                    order.trackingUrl ? <a href={order.trackingUrl}>{order.trackingNumber}</a> : <strong>{order.trackingNumber}</strong>
                  ) : (
                  <strong>Not provided yet</strong>
                  )}
                </div>
              </div>
              {historyNote ? <p className="gdg-account-notice">{historyNote}</p> : null}
              <section>
                <h3>Items</h3>
                {order.items.map((item) => (
                  <p key={`${order.orderNumber}-${item.title}`}>{item.quantity} x {item.title}</p>
                ))}
              </section>
              {order.refundStatus ? (
                <p className="gdg-account-notice">
                  Refund/cancel status: {order.refundStatus}
                  {order.refundedAmount > 0 ? ` (${money(order.refundedAmount)} recorded)` : ""}.
                </p>
              ) : null}
              <div className="gdg-account-actions">
                <Link href={`/account/orders/${encodeURIComponent(order.orderNumber)}`} className="gdg-secondary-button">View Details</Link>
              </div>
            </article>
            );
          })}
        </div>
      ) : (
        <div className="gdg-account-card compact">
          <h2>{orderHistoryEmptyTitle(view, hasAnyOrders)}</h2>
          <p>{orderHistoryEmptyMessage(view, hasAnyOrders)}</p>
          <Link href="/order-status" className="gdg-secondary-button">Check an Order as Guest</Link>
        </div>
      )}
    </>
  );
}

export function AccountOrderNotFound() {
  return (
    <div className="gdg-account-card hero">
      <p className="gdg-overline">Order Details</p>
      <h1>Order not found.</h1>
      <p>
        We could not find an order for this verified account. Use guest order lookup or contact support if you need help.
      </p>
      <div className="gdg-account-actions">
        <Link href="/account/orders" className="gdg-secondary-button">Back to My Orders</Link>
        <Link href="/order-status" className="gdg-primary-button">Use Guest Order Lookup</Link>
      </div>
    </div>
  );
}

export function AccountOrderDetail({ account, order }: { account: CurrentCustomerAccount; order: CustomerAccountOrderDetail }) {
  const fulfillmentLabel = order.fulfillmentMethod === "local_pickup" ? "Local Pickup" : order.shippingMethodLabel || "Standard Shipping";
  const carrierService = [order.shippingCarrier, order.shippingService].filter(Boolean).join(" / ") || "Not provided yet";

  return (
    <>
      <AccountNavigation active="orders" />
      <div className="gdg-account-card hero">
        <p className="gdg-overline">Order Details</p>
        <h1>{order.orderNumber}</h1>
        <p>
          Showing safe customer-facing details for <strong>{account.email}</strong>. Guest checkout and order status
          lookup remain available.
        </p>
        <div className="gdg-account-actions">
          <Link href="/account/orders" className="gdg-secondary-button">Back to My Orders</Link>
          <Link href="/policies" className="gdg-secondary-button">View Policies</Link>
        </div>
      </div>

      <div className="gdg-account-detail-layout">
        <article className="gdg-account-order-card">
          <header>
            <div>
              <span>Placed</span>
              <h2>{dateLabel(order.orderDate)}</h2>
            </div>
            <strong>{money(order.totalPaid)}</strong>
          </header>
          <div className="gdg-account-order-grid">
            <div>
              <span>Status</span>
              <strong>{order.status}</strong>
            </div>
            <div>
              <span>Fulfillment method</span>
              <strong>{fulfillmentLabel}</strong>
            </div>
            <div>
              <span>{order.fulfillmentMethod === "local_pickup" ? "Pickup status" : "Carrier / service"}</span>
              <strong>{order.fulfillmentMethod === "local_pickup" ? order.pickupStatus || "Pickup pending" : carrierService}</strong>
            </div>
            <div>
              <span>{order.fulfillmentMethod === "local_pickup" ? "Tracking" : "Tracking number"}</span>
              {order.fulfillmentMethod === "local_pickup" ? (
                <strong>Not required</strong>
              ) : order.trackingNumber ? (
                order.trackingUrl ? <a href={order.trackingUrl}>{order.trackingNumber}</a> : <strong>{order.trackingNumber}</strong>
              ) : (
                <strong>Not provided yet</strong>
              )}
            </div>
          </div>
          <section>
            <h3>Items</h3>
            {order.items.map((item) => (
              <p key={`${order.orderNumber}-${item.title}`}>
                {item.quantity} x {item.title} - {money(item.lineTotal)}
              </p>
            ))}
          </section>
        </article>

        <aside className="gdg-account-card compact">
          <h2>Order Summary</h2>
          <div className="gdg-account-order-grid two">
            <div>
              <span>Subtotal</span>
              <strong>{money(order.subtotal)}</strong>
            </div>
            <div>
              <span>Shipping charged</span>
              <strong>{money(order.shippingCharged)}</strong>
            </div>
            <div>
              <span>Total paid</span>
              <strong>{money(order.totalPaid)}</strong>
            </div>
            <div>
              <span>Support</span>
              <a href={`mailto:${order.supportEmail}`}>{order.supportEmail}</a>
            </div>
          </div>
          {order.refundStatus || order.canceledAt ? (
            <p className="gdg-account-notice">
              Refund/cancel status: {order.refundStatus || "Canceled"}
              {order.refundedAmount > 0 ? ` (${money(order.refundedAmount)} recorded)` : ""}.
            </p>
          ) : null}
          <p>
            Need help with this order? Contact support and include your order number. Customer account pages do not provide
            cancellation or refund actions.
          </p>
          <div className="gdg-account-actions">
            <a href={`mailto:${order.supportEmail}`} className="gdg-primary-button">Contact Support</a>
            <Link href="/policies" className="gdg-secondary-button">Policies</Link>
          </div>
        </aside>
      </div>
    </>
  );
}

const rewardLevels = [
  { label: "Rookie Collector", points: 0 },
  { label: "Card Hunter", points: 500 },
  { label: "Pack Pro", points: 1500 },
  { label: "Elite Trainer", points: 3000 },
  { label: "Master Collector", points: 5000 }
] as const;

function rewardLevelProgress(lifetimeEarnedPoints: number) {
  const points = Math.max(0, lifetimeEarnedPoints);
  const currentIndex = rewardLevels.reduce((selectedIndex, level, index) => (points >= level.points ? index : selectedIndex), 0);
  const currentLevel = rewardLevels[currentIndex] ?? rewardLevels[0];
  const nextLevel = rewardLevels[currentIndex + 1] ?? null;
  const nextThreshold = nextLevel?.points ?? currentLevel.points;
  const pointsToNext = nextLevel ? Math.max(0, nextLevel.points - points) : 0;
  const fullTrackMax = rewardLevels[rewardLevels.length - 1]?.points ?? 5000;
  const rawTrackPercent = fullTrackMax > 0 ? (Math.min(points, fullTrackMax) / fullTrackMax) * 100 : 100;
  const visualTrackPercent = points > 0 ? Math.max(3, Math.min(100, rawTrackPercent)) : 0;
  return { currentLevel, nextLevel, nextThreshold, points, pointsToNext, visualTrackPercent };
}

function rewardActivityView(entry: CustomerRewardActivityItem) {
  const lowerReason = entry.reason.toLowerCase();
  const reversed = entry.points < 0 || entry.status === "reversed";
  const pending = entry.status === "pending";
  const pos = lowerReason.includes("pos");
  const online = Boolean(entry.orderNumber);
  const title = reversed
    ? "Points reversed"
    : pending
      ? online
        ? "Online order pending"
        : pos
          ? "POS sale pending"
          : "Points pending"
      : online
        ? "Online order earned"
        : pos
          ? "POS sale earned"
          : "Points earned";
  const status = reversed ? "Reversed" : pending ? "Pending" : "Earned";
  const tone = reversed ? "reversed" : pending ? "pending" : "earned";
  const Icon = reversed ? RefreshCcw : pending ? Gift : CheckCircle2;
  return { title, status, tone, Icon };
}

export function AccountRewards({ account, activity = [] }: { account: CurrentCustomerAccount; activity?: CustomerRewardActivityItem[] }) {
  const balance = account.rewardBalance;
  const availablePoints = balance?.availablePoints ?? 0;
  const lifetimeEarnedPoints = balance?.lifetimeEarnedPoints ?? 0;
  const pendingPoints = balance?.pendingPoints ?? 0;
  const visibleReversedPoints = Math.abs(activity.filter((entry) => entry.points < 0).reduce((sum, entry) => sum + entry.points, 0));
  const progress = rewardLevelProgress(lifetimeEarnedPoints);
  const progressMax = progress.nextLevel ? progress.nextThreshold : progress.points || progress.nextThreshold || 1;
  const progressNow = Math.min(progress.points, progressMax);
  const milestoneMax = rewardLevels[rewardLevels.length - 1]?.points ?? 5000;
  const pointsLabel = (value: number) => value.toLocaleString();
  const summaryCards = [
    {
      label: "Available points",
      value: availablePoints,
      detail: "Ready when redemption launches",
      tone: "gold",
      icon: Star
    },
    {
      label: "Points pending",
      value: pendingPoints,
      detail: "Until shipped, picked up, or cleared",
      tone: "violet",
      icon: Gift
    },
    {
      label: "Lifetime earned",
      value: lifetimeEarnedPoints,
      detail: "Collector progress total",
      tone: "green",
      icon: TrendingUp
    },
    {
      label: "Points reversed",
      value: visibleReversedPoints,
      detail: "Visible recent activity",
      tone: "blue",
      icon: RefreshCcw
    }
  ] as const;

  return (
    <>
      <AccountNavigation active="rewards" />
      <section className="gdg-account-card gdg-rewards-spotlight" aria-labelledby="gdg-rewards-title">
        <div className="gdg-rewards-spotlight-mascot">
          <GrabbyMascot variant="rewards" size="large" />
        </div>
        <div className="gdg-rewards-spotlight-copy">
          <h1 id="gdg-rewards-title">Keep earning with Grabby!</h1>
          <p>Earn 1 point per $1 spent on eligible product purchases.</p>
          <p>Rewards redemption is coming soon. Points are display-only and do not affect checkout totals yet.</p>
          <div className="gdg-rewards-spotlight-actions">
            <Link href="/policies" className="gdg-primary-button">
              Rewards rules
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
            <span className="gdg-rewards-coming-soon">
              <Gift size={15} aria-hidden="true" />
              Redemption coming soon
            </span>
          </div>
        </div>
        <div className="gdg-rewards-spotlight-rules" aria-label="Rewards quick rules">
          <div>
            <AccountIconBadge tone="gold" icon={Trophy} />
            <p><strong>Earn points</strong><span>1 pt per $1 spent</span></p>
          </div>
          <div>
            <AccountIconBadge tone="violet" icon={Gift} />
            <p><strong>Points pending</strong><span>Until shipped, picked up, or cleared</span></p>
          </div>
          <div>
            <AccountIconBadge tone="green" icon={ShieldCheck} />
            <p><strong>Refunds may</strong><span>Reverse points</span></p>
          </div>
          <div>
            <AccountIconBadge tone="blue" icon={Coins} />
            <p><strong>No cash value</strong><span>Or exchange</span></p>
          </div>
        </div>
      </section>

      <div className="gdg-rewards-summary-grid" aria-label="Rewards points summary">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.label} className={`gdg-rewards-summary-card ${card.tone}`}>
              <span className="gdg-rewards-summary-icon">
                <Icon size={24} aria-hidden="true" />
              </span>
              <div>
                <span>{card.label}</span>
                <strong>{pointsLabel(card.value)}</strong>
                <small>{card.detail}</small>
              </div>
            </article>
          );
        })}
      </div>

      <div className="gdg-rewards-dashboard-grid">
        <section className="gdg-account-card gdg-rewards-level-card" aria-labelledby="gdg-rewards-level-title">
          <div className="gdg-account-panel-heading">
            <div>
              <p className="gdg-overline">Your level</p>
              <h2 id="gdg-rewards-level-title">{progress.currentLevel.label}</h2>
              <p className="gdg-account-panel-copy">Keep going. You are on your way to the next level.</p>
            </div>
            <AccountIconBadge tone="gold" icon={Trophy} />
          </div>
          <div
            className="gdg-rewards-progress-track"
            role="progressbar"
            aria-label={`${pointsLabel(progress.points)} of ${pointsLabel(progressMax)} points toward ${progress.nextLevel?.label ?? progress.currentLevel.label}`}
            aria-valuemin={progress.currentLevel.points}
            aria-valuemax={progressMax}
            aria-valuenow={progressNow}
          >
            <span style={{ width: `${progress.visualTrackPercent}%` }} />
          </div>
          <div className="gdg-rewards-progress-label">
            <strong>{pointsLabel(progress.points)} / {pointsLabel(progressMax)} points</strong>
            <span>{progress.nextLevel ? `Next level: ${progress.nextLevel.label}` : "Top level reached"}</span>
          </div>
          <div className="gdg-rewards-milestones" aria-hidden="true">
            {rewardLevels.map((level) => (
              <span
                key={level.points}
                className={progress.points >= level.points ? "reached" : ""}
                style={{ left: `${milestoneMax > 0 ? (level.points / milestoneMax) * 100 : 0}%` }}
              >
                <i />
                <b>{level.points.toLocaleString()}</b>
              </span>
            ))}
          </div>
          <div className="gdg-rewards-next-callout">
            <Rocket size={22} aria-hidden="true" />
            <p>
              <strong>
                {progress.nextLevel
                  ? `Earn ${pointsLabel(progress.pointsToNext)} more points to reach ${progress.nextLevel.label}`
                  : "You have reached the current top rewards level"}
              </strong>
              <span>More points unlock more rewards when redemption launches.</span>
            </p>
          </div>
        </section>

        <section className="gdg-account-card gdg-rewards-explainer" aria-labelledby="gdg-rewards-how-title">
          <div className="gdg-account-panel-heading">
            <div>
              <p className="gdg-overline">How points work</p>
              <h2 id="gdg-rewards-how-title">Rewards rules</h2>
            </div>
            <AccountIconBadge tone="green" icon={ShieldCheck} />
          </div>
          <ul>
            {[
              "Earn 1 point per $1 on eligible product purchases.",
              "Points may remain pending until the order is shipped, picked up, or cleared.",
              "Shipping, tax, discounts, canceled orders, refunded items, and test/smoke orders do not earn points.",
              "Refunds/cancellations may reverse points.",
              "Points have no cash value."
            ].map((copy) => (
              <li key={copy}>
                <CheckCircle2 size={17} aria-hidden="true" />
                <span>{copy}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="gdg-rewards-bottom-grid">
        <section className="gdg-account-card compact gdg-rewards-activity-card" aria-labelledby="gdg-rewards-activity-title">
          <div className="gdg-account-panel-heading">
            <div>
              <p className="gdg-overline">Recent activity</p>
              <h2 id="gdg-rewards-activity-title">Recent activity</h2>
            </div>
            <Link href="/account/orders">View orders <ArrowRight size={14} aria-hidden="true" /></Link>
          </div>
          {activity.length ? (
            <div className="gdg-reward-activity-list">
              {activity.map((entry) => {
                const item = rewardActivityView(entry);
                const Icon = item.Icon;
                return (
                  <article key={entry.id} className={item.tone}>
                    <span className="gdg-reward-activity-icon">
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <span>
                        {entry.orderNumber ? `Order ${entry.orderNumber}` : "Account activity"} - {dateLabel(entry.createdAt)}
                      </span>
                    </div>
                    <b className={entry.points >= 0 ? "positive" : "negative"}>{entry.points >= 0 ? "+" : ""}{entry.points} pts</b>
                    <em>{item.status}</em>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="gdg-rewards-empty-state">
              <Gift size={24} aria-hidden="true" />
              <strong>Start earning points on your next eligible purchase.</strong>
              <p>Eligible paid orders and matched POS sales will appear here after points are recorded.</p>
            </div>
          )}
        </section>

        <aside className="gdg-account-card compact gdg-rewards-links-card" aria-labelledby="gdg-rewards-links-title">
          <div className="gdg-rewards-help-icon">
            <Headphones size={24} aria-hidden="true" />
          </div>
          <p className="gdg-overline">Need help?</p>
          <h2 id="gdg-rewards-links-title">We are here for you.</h2>
          <p>If you have any questions about rewards, reach out or review the current rules.</p>
          <div className="gdg-account-support-links">
            <Link href="/account/orders">
              <ShoppingBag size={15} aria-hidden="true" />
              View orders
            </Link>
            <Link href="/policies">
              <ShieldCheck size={15} aria-hidden="true" />
              Rewards rules
            </Link>
            <a href={`mailto:${GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL}`}>
              <Headphones size={15} aria-hidden="true" />
              Contact support
            </a>
          </div>
        </aside>
      </div>
    </>
  );
}

export function AccountAddresses({ account, status }: { account: CurrentCustomerAccount; status?: string | null }) {
  const message = addressStatusMessage(status);
  return (
    <>
      <AccountNavigation active="addresses" />
      <div className="gdg-account-card hero">
        <p className="gdg-overline">Saved Addresses</p>
        <h1>Your address book.</h1>
        <p>
          Save addresses for your account only. Checkout still collects shipping or pickup details normally and does not
          prefill from this address book yet.
        </p>
        <div className="gdg-account-mini-grid" aria-label="Saved address privacy notes">
          <span>Verified account only</span>
          <span>Checkout unchanged</span>
          <span>Private to your email</span>
        </div>
        {message ? (
          <p className={`gdg-account-notice ${status === "error" ? "error" : "good"}`}>{message}</p>
        ) : null}
      </div>
      <div className="gdg-account-card compact">
        <h2>Add an address</h2>
        <p className="gdg-account-helper">Use this for account convenience only. It will not change checkout yet.</p>
        <form className="gdg-address-form" action="/api/account/addresses" method="post">
          <input type="hidden" name="action" value="create" />
          <label>
            Label or recipient name
            <input name="name" autoComplete="name" placeholder="Home, Office, or recipient name" />
          </label>
          <label className="wide">
            Street address
            <input name="street1" autoComplete="address-line1" required placeholder="123 Main St" />
          </label>
          <label className="wide">
            Apartment, suite, or unit
            <input name="street2" autoComplete="address-line2" placeholder="Optional" />
          </label>
          <label>
            City
            <input name="city" autoComplete="address-level2" required />
          </label>
          <label>
            State
            <input name="state" autoComplete="address-level1" required maxLength={32} />
          </label>
          <label>
            ZIP
            <input name="zip" autoComplete="postal-code" required pattern="\d{5}(-\d{4})?" inputMode="numeric" />
          </label>
          <label>
            Country
            <input name="country" autoComplete="country" defaultValue="US" required maxLength={2} />
          </label>
          <label className="gdg-checkbox-row wide">
            <input name="isDefault" type="checkbox" />
            <span>Make this my default saved address</span>
          </label>
          <button className="gdg-primary-button wide" type="submit">Save Address</button>
        </form>
      </div>
      {account.savedAddresses.length ? (
        <div className="gdg-address-list">
          {account.savedAddresses.map((address) => (
            <article key={address.id} className="gdg-address-card">
              <div className="gdg-address-card-main">
                <span>{address.isDefault ? "Default address" : "Saved address"}</span>
                <strong>{address.name || "Address"}</strong>
                <p>{address.street1}{address.street2 ? `, ${address.street2}` : ""}</p>
                <p>{address.city}, {address.state} {address.zip}</p>
                <p>{address.country}</p>
              </div>
              <details className="gdg-address-edit">
                <summary>Edit address</summary>
                <form className="gdg-address-form compact" action="/api/account/addresses" method="post">
                  <input type="hidden" name="action" value="update" />
                  <input type="hidden" name="addressId" value={address.id} />
                  <label>
                    Label or recipient name
                    <input name="name" defaultValue={address.name ?? ""} />
                  </label>
                  <label className="wide">
                    Street address
                    <input name="street1" defaultValue={address.street1} required />
                  </label>
                  <label className="wide">
                    Apartment, suite, or unit
                    <input name="street2" defaultValue={address.street2 ?? ""} />
                  </label>
                  <label>
                    City
                    <input name="city" defaultValue={address.city} required />
                  </label>
                  <label>
                    State
                    <input name="state" defaultValue={address.state} required maxLength={32} />
                  </label>
                  <label>
                    ZIP
                    <input name="zip" defaultValue={address.zip} required pattern="\d{5}(-\d{4})?" inputMode="numeric" />
                  </label>
                  <label>
                    Country
                    <input name="country" defaultValue={address.country} required maxLength={2} />
                  </label>
                  <label className="gdg-checkbox-row wide">
                    <input name="isDefault" type="checkbox" defaultChecked={address.isDefault} />
                    <span>Make this my default saved address</span>
                  </label>
                  <button className="gdg-primary-button wide" type="submit">Save Changes</button>
                </form>
              </details>
              <div className="gdg-address-actions">
                {!address.isDefault ? (
                  <form action="/api/account/addresses" method="post">
                    <input type="hidden" name="action" value="default" />
                    <input type="hidden" name="addressId" value={address.id} />
                    <button className="gdg-secondary-button" type="submit">Make Default</button>
                  </form>
                ) : null}
                <form action="/api/account/addresses" method="post">
                  <input type="hidden" name="action" value="delete" />
                  <input type="hidden" name="addressId" value={address.id} />
                  <button className="gdg-danger-link" type="submit">Delete</button>
                </form>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="gdg-account-card compact">
          <h2>No saved addresses</h2>
          <p>Saved addresses will appear here after you add one. Checkout still collects shipping or pickup details securely when you order.</p>
        </div>
      )}
    </>
  );
}
