import Link from "next/link";
import type { ReactNode } from "react";
import { StorefrontFooter, StorefrontHeader } from "@/components/StorefrontClient";
import { getStorefrontHomeHref } from "@/lib/storefront-navigation";
import { getStorefrontSettings } from "@/lib/storefront";
import {
  customerAccountsEnabled,
  type CurrentCustomerAccount,
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
        Use a secure email link to view your order history and account placeholders. Guest checkout remains available.
      </p>
      <div className="gdg-account-actions">
        <Link href="/account/login" className="gdg-primary-button">Email Me a Sign-In Link</Link>
        <Link href="/order-status" className="gdg-secondary-button">Use Guest Order Lookup</Link>
      </div>
    </div>
  );
}

export function AccountDashboard({ account }: { account: CurrentCustomerAccount }) {
  const rewardBalance = account.rewardBalance;
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
        <Link href="/account/orders" className="gdg-account-tile">
          <span>Order History</span>
          <strong>View your orders</strong>
          <p>Orders appear after your checkout email matches this verified account.</p>
        </Link>
        <Link href="/account/rewards" className="gdg-account-tile">
          <span>Rewards</span>
          <strong>{rewardBalance ? `${rewardBalance.availablePoints} points` : "Rewards placeholder"}</strong>
          <p>Rewards are being prepared and do not affect checkout totals yet.</p>
        </Link>
        <Link href="/account/addresses" className="gdg-account-tile">
          <span>Addresses</span>
          <strong>{account.savedAddresses.length ? `${account.savedAddresses.length} saved` : "No saved addresses"}</strong>
          <p>Saved address management is planned for a future phase.</p>
        </Link>
        <Link href="/order-status" className="gdg-account-tile">
          <span>Guest Lookup</span>
          <strong>Check an order</strong>
          <p>Use an order number and checkout email without signing in.</p>
        </Link>
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
  account
}: {
  sent?: string | null;
  error?: string | null;
  signedOut?: string | null;
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

  return (
    <div className="gdg-account-card hero">
      <p className="gdg-overline">Customer Login</p>
      <h1>Email yourself a secure sign-in link.</h1>
      <p>
        Customer accounts are optional. Use the same email you used at checkout to see matching order history after
        verification.
      </p>
      {sent ? (
        <p className="gdg-account-notice good">
          If that email can receive account links, a sign-in link has been sent. Check your inbox.
        </p>
      ) : null}
      {signedOut ? <p className="gdg-account-notice">You have been signed out.</p> : null}
      {error ? <p className="gdg-account-notice error">That sign-in link is invalid, expired, or already used.</p> : null}
      <form className="gdg-account-form" action="/api/account/magic-link/request" method="post">
        <label>
          Email address
          <input name="email" type="email" autoComplete="email" required placeholder="you@example.com" />
        </label>
        <button className="gdg-primary-button wide" type="submit">Send Sign-In Link</button>
      </form>
      <p className="gdg-account-helper">
        No password is required. This does not change checkout; you can still buy as a guest.
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

export function AccountRewards({ account, activity = [] }: { account: CurrentCustomerAccount; activity?: CustomerRewardActivityItem[] }) {
  const balance = account.rewardBalance;
  return (
    <>
      <div className="gdg-account-card hero">
        <p className="gdg-overline">Rewards</p>
        <h1>Track your GameDayGrabs points.</h1>
        <p>Earn 1 point per eligible item-subtotal dollar after paid orders. Shipping, taxes, refunds, and test orders do not earn points.</p>
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

export function AccountAddresses({ account }: { account: CurrentCustomerAccount }) {
  return (
    <>
      <div className="gdg-account-card hero">
        <p className="gdg-overline">Saved Addresses</p>
        <h1>Address book placeholder.</h1>
        <p>Saved address editing is planned for a later phase. Checkout can still collect shipping details as usual.</p>
      </div>
      {account.savedAddresses.length ? (
        <div className="gdg-account-grid">
          {account.savedAddresses.map((address) => (
            <article key={address.id} className="gdg-account-tile">
              <span>{address.isDefault ? "Default address" : "Saved address"}</span>
              <strong>{address.name || "Address"}</strong>
              <p>{address.street1}{address.street2 ? `, ${address.street2}` : ""}</p>
              <p>{address.city}, {address.state} {address.zip}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="gdg-account-card compact">
          <h2>No saved addresses</h2>
          <p>Checkout still collects shipping or pickup details securely when you order.</p>
        </div>
      )}
    </>
  );
}
