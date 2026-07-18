"use client";

import Image from "next/image";
import { type FormEvent, useState } from "react";
import { Mail, PackageCheck, Search, Truck } from "lucide-react";
import { GrabbyCard } from "@/components/brand/GrabbyCard";
import { customerSafeOrderMilestones, customerSafeSupportCue, formatCustomerStatus } from "@/lib/order-status-presentation";
import type { PublicOrderStatusLookupDTO } from "@/types/radar";

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

export function OrderStatusLookupClient() {
  const [result, setResult] = useState<PublicOrderStatusLookupDTO | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/storefront/order-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderNumber: String(form.get("orderNumber") || ""),
          email: String(form.get("email") || "")
        })
      });
      const data = (await response.json()) as PublicOrderStatusLookupDTO & { error?: string };
      if (!response.ok) throw new Error(data.error || "Enter the order number and checkout email.");
      setResult(data);
    } catch (lookupError) {
      setError(lookupError instanceof Error ? lookupError.message : "Order lookup failed.");
    } finally {
      setLoading(false);
    }
  }

  const order = result?.order;
  const milestones = order ? customerSafeOrderMilestones(order) : [];
  const supportCue = order ? customerSafeSupportCue(order) : "";

  return (
    <section className="order-status-shell">
      <div className="order-status-card">
        <div className="gdg-section-header">
          <div>
            <p className="gdg-overline">Order status</p>
            <h1>Check your GameDayGrabs order.</h1>
            <p>Enter your order number and the email used at checkout. This page is read-only and cannot edit, cancel, or refund an order.</p>
          </div>
        </div>
        <form className="order-status-form" onSubmit={submit}>
          <label>
            Order number
            <input name="orderNumber" autoComplete="off" placeholder="PR-20260618-9C3KQ3" required />
          </label>
          <label>
            Email used at checkout
            <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
          </label>
          <button className="gdg-primary-button" type="submit" disabled={loading}>
            <Search size={16} />
            {loading ? "Checking..." : "Check Order Status"}
          </button>
        </form>
        <GrabbyCard variant="order-status" compact className="order-status-grabby-card" />
        {error ? <p className="order-status-message error">{error}</p> : null}
        {result && !result.found ? <p className="order-status-message">{result.message}</p> : null}
      </div>

      {order ? (
        <div className="order-status-result">
          <div className="order-status-result-header">
            <span className="order-status-icon"><PackageCheck size={22} /></span>
            <div>
              <small>Order {order.orderNumber}</small>
              <h2>{order.status}</h2>
              <p>Placed {dateLabel(order.orderDate)}</p>
            </div>
          </div>
          <div className="order-status-summary-grid">
            <article>
              <small>Payment</small>
              <strong>{formatCustomerStatus(order.paymentStatus)}</strong>
            </article>
            <article>
              <small>Fulfillment</small>
              <strong>{order.fulfillmentMethod === "local_pickup" ? "Local Pickup" : "Shipping"}</strong>
            </article>
            <article>
              <small>{order.fulfillmentMethod === "local_pickup" ? "Pickup status" : "Shipping method"}</small>
              <strong>{order.fulfillmentMethod === "local_pickup" ? order.pickupStatus || "Pickup pending" : order.shippingMethodLabel || "Not captured"}</strong>
            </article>
            <article>
              <small>Order date</small>
              <strong>{dateLabel(order.orderDate)}</strong>
            </article>
          </div>
          <section className="order-status-timeline" aria-label="Customer-safe order timeline">
            <h3>Status timeline</h3>
            <ol>
              {milestones.map((milestone) => (
                <li key={milestone.label} className={milestone.state}>
                  <span>{milestone.label}</span>
                  <p>{milestone.detail}</p>
                </li>
              ))}
            </ol>
          </section>
          <section className="order-status-totals" aria-label="Order total summary">
            <h3>Order summary</h3>
            <dl>
              <div><dt>Merchandise subtotal</dt><dd>{money(order.merchandiseSubtotal)}</dd></div>
              <div><dt>Discount</dt><dd>{order.discount > 0 ? `-${money(order.discount)}` : money(0)}</dd></div>
              <div><dt>Shipping</dt><dd>{money(order.shippingCharged)}</dd></div>
              <div><dt>Sales tax</dt><dd>{order.tax === null ? "Not recorded" : money(order.tax)}</dd></div>
              <div className="total"><dt>Total paid</dt><dd>{money(order.totalPaid)}</dd></div>
            </dl>
          </section>
          <section className="order-status-items">
            <h3>Items</h3>
            {order.items.map((item) => (
              <article key={`${item.title}-${item.quantity}`}>
                <span className="order-status-item-image">
                  {item.imageUrl ? <Image src={item.imageUrl} alt={item.title} width={56} height={56} unoptimized /> : <PackageCheck size={20} />}
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <small>Qty {item.quantity}</small>
                </div>
              </article>
            ))}
          </section>
          {order.trackingNumber ? (
            <section className="order-status-info-card">
              <Truck size={18} />
              <div>
                <strong>Tracking</strong>
                <p>{[order.carrier, order.trackingNumber].filter(Boolean).join(" - ")}</p>
                {order.trackingUrl ? <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer">Track package</a> : null}
              </div>
            </section>
          ) : null}
          {order.refundStatus || order.refundedAmount > 0 || order.canceledAt ? (
            <section className="order-status-info-card warning">
              <PackageCheck size={18} />
              <div>
                <strong>Refund / cancellation status</strong>
                <p>{order.refundStatus ? formatCustomerStatus(order.refundStatus) : order.canceledAt ? "Canceled" : "Refund recorded"}</p>
                {order.refundedAmount > 0 ? <p>Refunded amount: {money(order.refundedAmount)}</p> : null}
                {order.refundedAmount > 0 ? <p>Sales tax refunded: {order.refundedTax === null ? "Not recorded" : money(order.refundedTax)}</p> : null}
              </div>
            </section>
          ) : null}
          <section className="order-status-info-card">
            <Mail size={18} />
            <div>
              <strong>Need help?</strong>
              <p>{supportCue}</p>
              <a href={`mailto:${order.supportEmail}`}>{order.supportEmail}</a>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
