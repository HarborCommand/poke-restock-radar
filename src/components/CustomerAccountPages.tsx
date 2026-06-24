import Link from "next/link";
import type { ReactNode } from "react";
import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { getStorefrontSettings } from "@/lib/storefront";
import {
  customerAccountsEnabled,
  type CurrentCustomerAccount,
  type CustomerAccountOrderDetail,
  type CustomerAccountOrderHistoryItem
} from "@/lib/customer-account-auth";
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
  if (value === "sent") return "If that email matches an account, a password reset link has been sent.";
  return null;
}

export async function CustomerAccountShell({ children }: { children: ReactNode }) {
  const [settings, homeHref] = await Promise.all([getStorefrontSettings(), getStorefrontHomeHref()]);
  return (
    <main className="shop-shell">
      <StorefrontHeader settings={settings} homeHref={homeHref} />
      <section className="gdg-account-shell">{children}</section>
      <StorefrontFooter settings={settings} homeHref={homeHref} />
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

export function AccountDashboard({ account }: { account: CurrentCustomerAccount }) {
  const rewardBalance = account.rewardBalance;
  const tiles = [
    {
      href: "/account/orders",
      label: "My Orders",
      value: "View your orders",
      copy: "Track paid orders, shipping, pickup, and refund status tied to this verified email."
    },
    {
      href: "/account/rewards",
      label: "Rewards",
      value: rewardBalance ? `${rewardBalance.availablePoints} points` : "0 points",
      copy: "Earn points on eligible purchases. Redemption coming soon."
    },
    {
      href: "/account/addresses",
      label: "Saved Addresses",
      value: account.savedAddresses.length ? `${account.savedAddresses.length} saved` : "No saved addresses",
      copy: "Manage address book entries for your account. Checkout still collects details normally."
    },
    {
      href: "/order-status",
      label: "Order Status",
      value: "Guest lookup",
      copy: "Use an order number and checkout email without signing in."
    },
    {
      href: "/contact",
      label: "Support",
      value: "Contact us",
      copy: "Questions about orders, pickup, or products go directly to GameDayGrabs support."
    }
  ];

  return (
    <>
      <div className="gdg-account-card hero">
        <p className="gdg-overline">My Account</p>
        <h1>Welcome{account.displayName ? `, ${account.displayName}` : ""}.</h1>
        <p>
          Signed in as <strong>{account.email}</strong>. Your account is optional; guest checkout stays available for
          every order.
        </p>
        <form action="/api/account/logout" method="post">
          <button className="gdg-secondary-button" type="submit">Sign Out</button>
        </form>
      </div>
      <div className="gdg-account-grid">
        {tiles.map((tile) => (
          <Link key={tile.label} href={tile.href} className="gdg-account-tile">
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
            <p>{tile.copy}</p>
          </Link>
        ))}
      </div>
      <div className="gdg-account-card compact">
        <h2>Need support?</h2>
        <p>
          Contact <a href={`mailto:${GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL}`}>{GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL}</a> for
          order, pickup, or product questions.
        </p>
      </div>
    </>
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
  account
}: {
  sent?: string | null;
  error?: string | null;
  signedOut?: string | null;
  accountStatus?: string | null;
  mode?: string | null;
  loginError?: string | null;
  registerError?: string | null;
  account: CurrentCustomerAccount | null;
}) {
  if (!customerAccountsEnabled()) return <CustomerAccountsComingSoon />;
  if (account) {
    return (
      <div className="gdg-account-card hero">
        <p className="gdg-overline">Already Signed In</p>
        <h1>Your account is ready.</h1>
        <p>You are signed in as {account.email}.</p>
        <div className="gdg-account-actions">
          <Link href="/account" className="gdg-primary-button">Go to Account</Link>
          <form action="/api/account/logout" method="post">
            <button className="gdg-secondary-button" type="submit">Sign Out</button>
          </form>
        </div>
      </div>
    );
  }

  const activeMode = mode === "create" ? "create" : "signin";
  const statusMessage = accountStatusMessage(accountStatus);

  return (
    <div className="gdg-account-card hero">
      <p className="gdg-overline">Customer Login</p>
      <h1>Sign in or create an account.</h1>
      <p>
        No password needed if you prefer email login. We'll send a secure sign-in link to your email.
      </p>
      <p>Customer accounts are optional. Guest checkout is always available.</p>
      <div className="gdg-account-tabs" role="tablist" aria-label="Customer account options">
        <Link href="/account/login?mode=signin" className={activeMode === "signin" ? "active" : ""}>Sign In</Link>
        <Link href="/account/login?mode=create" className={activeMode === "create" ? "active" : ""}>Create Account</Link>
      </div>
      {statusMessage ? <p className="gdg-account-notice good">{statusMessage}</p> : null}
      {sent ? (
        <p className="gdg-account-notice good">
          If that email can receive account links, a sign-in link has been sent. Check your inbox.
        </p>
      ) : null}
      {signedOut ? <p className="gdg-account-notice">You have been signed out.</p> : null}
      {error ? <p className="gdg-account-notice error">That sign-in link is invalid, expired, or already used.</p> : null}
      {loginError ? <p className="gdg-account-notice error">Email or password is incorrect.</p> : null}
      {registerError ? <p className="gdg-account-notice error">We could not create that account. Check the fields and try again.</p> : null}
      {activeMode === "signin" ? (
        <form className="gdg-account-form" action="/api/account/login" method="post">
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required placeholder="Your password" />
          </label>
          <div className="gdg-account-form-row">
            <button className="gdg-primary-button wide" type="submit">Sign In</button>
            <Link href="/account/forgot-password" className="gdg-inline-link">Forgot Password?</Link>
          </div>
        </form>
      ) : (
        <form className="gdg-account-form" action="/api/account/register" method="post">
          <label>
            Name
            <input name="displayName" type="text" autoComplete="name" placeholder="Your name" />
          </label>
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" />
          </label>
          <label>
            Confirm password
            <input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required placeholder="Re-enter password" />
          </label>
          <button className="gdg-primary-button wide" type="submit">Create Account</button>
        </form>
      )}
      <div className="gdg-account-magic-option">
        <h2>Email sign-in link</h2>
        <p>Prefer not to use a password? We can send a secure one-time sign-in link instead.</p>
        <form className="gdg-account-form compact" action="/api/account/magic-link/request" method="post">
          <label>
            Email address
            <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
          </label>
          <button className="gdg-secondary-button" type="submit">Send Sign-In Link</button>
        </form>
      </div>
      <p className="gdg-account-helper">
        Use the same email you used at checkout to see matching order history after verification. This does not change
        checkout; you can still buy as a guest.
      </p>
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
      <div className="gdg-account-card hero">
        <p className="gdg-overline">Password</p>
        <h1>You are already signed in.</h1>
        <p>You are signed in as {account.email}. You can sign out first if you need to reset a different account.</p>
        <div className="gdg-account-actions">
          <Link href="/account" className="gdg-primary-button">Go to Account</Link>
          <form action="/api/account/logout" method="post">
            <button className="gdg-secondary-button" type="submit">Sign Out</button>
          </form>
        </div>
      </div>
    );
  }
  const statusMessage = resetStatusMessage(resetStatus);
  return (
    <div className="gdg-account-card hero">
      <p className="gdg-overline">Forgot Password</p>
      <h1>Reset your password.</h1>
      <p>Enter your account email. If it matches an account, we'll send a secure reset link.</p>
      {statusMessage ? <p className="gdg-account-notice good">{statusMessage}</p> : null}
      <form className="gdg-account-form" action="/api/account/forgot-password" method="post">
        <label>
          Email address
          <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
        </label>
        <button className="gdg-primary-button wide" type="submit">Send Reset Link</button>
      </form>
      <p className="gdg-account-helper">
        Guest checkout remains available. Password reset emails never include password hashes or payment details.
      </p>
    </div>
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
  if (!token || resetError === "invalid" || resetError === "expired" || resetError === "used") {
    return (
      <div className="gdg-account-card hero">
        <p className="gdg-overline">Reset Password</p>
        <h1>This reset link is invalid, expired, or already used.</h1>
        <p>Request a new password reset link to continue. Guest checkout remains available.</p>
        <div className="gdg-account-actions">
          <Link href="/account/forgot-password" className="gdg-primary-button">Request New Link</Link>
          <Link href="/account/login" className="gdg-secondary-button">Back to Sign In</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="gdg-account-card hero">
      <p className="gdg-overline">Reset Password</p>
      <h1>Choose a new password.</h1>
      <p>Use at least 8 characters. This link can only be used once.</p>
      {resetError === "password" ? <p className="gdg-account-notice error">Passwords must match and be at least 8 characters.</p> : null}
      <form className="gdg-account-form" action="/api/account/reset-password" method="post">
        <input type="hidden" name="token" value={token} />
        <label>
          New password
          <input name="password" type="password" autoComplete="new-password" minLength={8} required placeholder="At least 8 characters" />
        </label>
        <label>
          Confirm password
          <input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required placeholder="Re-enter password" />
        </label>
        <button className="gdg-primary-button wide" type="submit">Update Password</button>
      </form>
      <p className="gdg-account-helper">
        Password reset is only for your customer account. It does not change checkout, orders, or payment processing.
      </p>
    </div>
  );
}

export function AccountOrders({ account, orders }: { account: CurrentCustomerAccount; orders: CustomerAccountOrderHistoryItem[] }) {
  return (
    <>
      <div className="gdg-account-card hero">
        <p className="gdg-overline">Order History</p>
        <h1>Your GameDayGrabs orders.</h1>
        <p>Showing orders for verified email <strong>{account.email}</strong>. Guest order lookup remains available.</p>
        <div className="gdg-account-mini-grid" aria-label="Order history privacy notes">
          <span>Verified email only</span>
          <span>No payment details shown</span>
          <span>Guest checkout unchanged</span>
        </div>
      </div>
      {orders.length ? (
        <div className="gdg-account-orders">
          {orders.map((order) => (
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
          ))}
        </div>
      ) : (
        <div className="gdg-account-card compact">
          <h2>No orders yet</h2>
          <p>Orders will appear here after your verified account email matches a checkout email.</p>
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

export function AccountRewards({ account, activity = [] }: { account: CurrentCustomerAccount; activity?: CustomerRewardActivityItem[] }) {
  const balance = account.rewardBalance;
  return (
    <>
      <div className="gdg-account-card hero">
        <p className="gdg-overline">Rewards</p>
        <h1>Track your GameDayGrabs points.</h1>
        <p>Earn points on eligible purchases. You earn 1 point per eligible item-subtotal dollar after paid orders.</p>
        <p>Shipping, taxes, refunds, and test orders do not earn points.</p>
        <p className="gdg-account-notice">Redemption coming soon. Points are display-only and do not affect checkout totals yet.</p>
        <div className="gdg-account-order-grid">
          <div>
            <span>Available points</span>
            <strong>{balance?.availablePoints ?? 0}</strong>
          </div>
          <div>
            <span>Lifetime earned</span>
            <strong>{balance?.lifetimeEarnedPoints ?? 0}</strong>
          </div>
          <div>
            <span>Pending</span>
            <strong>{balance?.pendingPoints ?? 0}</strong>
          </div>
        </div>
      </div>
      <div className="gdg-account-card compact">
        <h2>Recent activity</h2>
        {activity.length ? (
          <div className="gdg-reward-activity-list">
            {activity.map((entry) => (
              <article key={entry.id}>
                <div>
                  <strong>{entry.reason}</strong>
                  <span>{entry.orderNumber ? `Order ${entry.orderNumber}` : "Account activity"} - {dateLabel(entry.createdAt)}</span>
                </div>
                <b className={entry.points >= 0 ? "positive" : "negative"}>{entry.points >= 0 ? "+" : ""}{entry.points} pts</b>
              </article>
            ))}
          </div>
        ) : (
          <p>No reward activity yet. Eligible paid orders will appear here after payment is confirmed.</p>
        )}
      </div>
    </>
  );
}

export function AccountAddresses({ account, status }: { account: CurrentCustomerAccount; status?: string | null }) {
  const message = addressStatusMessage(status);
  return (
    <>
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
