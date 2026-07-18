export type CustomerSafeOrderStage = "complete" | "current" | "pending" | "attention";

export type CustomerSafeOrderStatusInput = {
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  fulfillmentMethod: "shipping" | "local_pickup" | "in_store";
  pickupStatus?: string | null;
  trackingNumber?: string | null;
  refundStatus?: string | null;
  refundedAmount?: number | null;
  canceledAt?: string | null;
};

export type CustomerSafeOrderMilestone = {
  label: "Order received" | "Processing" | "Ready for pickup" | "Shipped" | "Delivered" | "Refunded" | "Canceled" | "Support available";
  state: CustomerSafeOrderStage;
  detail: string;
};

function hasStatus(value: string | null | undefined, needle: string) {
  return (value ?? "").toLowerCase().replace(/[_-]+/g, " ").includes(needle);
}

export function formatCustomerStatus(value: string | null | undefined) {
  if (!value) return "Not provided";
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function customerSafeOrderMilestones(order: CustomerSafeOrderStatusInput): CustomerSafeOrderMilestone[] {
  const refunded = Boolean(order.refundStatus) || (order.refundedAmount ?? 0) > 0 || hasStatus(order.status, "refund") || hasStatus(order.paymentStatus, "refund");
  const canceled = Boolean(order.canceledAt) || hasStatus(order.status, "canceled") || hasStatus(order.paymentStatus, "canceled");
  const shipped = Boolean(order.trackingNumber) || hasStatus(order.fulfillmentStatus, "shipped") || hasStatus(order.status, "shipped");
  const delivered = hasStatus(order.fulfillmentStatus, "delivered") || hasStatus(order.status, "delivered");
  const pickupReady = hasStatus(order.fulfillmentStatus, "pickup ready") || hasStatus(order.pickupStatus, "ready for pickup") || hasStatus(order.status, "ready for pickup");

  if (canceled) {
    return [
      { label: "Order received", state: "complete", detail: "The order was recorded." },
      { label: "Canceled", state: "attention", detail: "The order is canceled. No customer action is available here." },
      { label: "Support available", state: "current", detail: "Contact support if you need help with this record." }
    ];
  }

  if (refunded) {
    return [
      { label: "Order received", state: "complete", detail: "The order was recorded." },
      { label: "Processing", state: "complete", detail: "The refund or cancellation review has been processed." },
      { label: "Refunded", state: "attention", detail: "A refund state is recorded. Totals below show any recorded refund amounts." }
    ];
  }

  if (order.fulfillmentMethod === "in_store") {
    return [
      { label: "Order received", state: "complete", detail: "The linked in-store purchase is recorded." },
      { label: "Delivered", state: "complete", detail: "In-store purchase receipt details are available in this account." }
    ];
  }

  if (order.fulfillmentMethod === "local_pickup") {
    return [
      { label: "Order received", state: "complete", detail: "Checkout has been recorded." },
      { label: "Processing", state: pickupReady ? "complete" : "current", detail: "The order is being prepared for local pickup." },
      { label: "Ready for pickup", state: pickupReady ? "current" : "pending", detail: pickupReady ? "Bring your order number when picking up." : "Pickup readiness will appear here when available." }
    ];
  }

  return [
    { label: "Order received", state: "complete", detail: "Checkout has been recorded." },
    { label: "Processing", state: shipped || delivered ? "complete" : "current", detail: "The order is being packed for shipment." },
    { label: "Shipped", state: delivered ? "complete" : shipped ? "current" : "pending", detail: shipped ? "Tracking is available below when provided by the carrier." : "Tracking will appear here after shipment." },
    { label: "Delivered", state: delivered ? "current" : "pending", detail: delivered ? "Carrier delivery is recorded." : "Delivery status depends on carrier updates." }
  ];
}

export function customerSafeSupportCue(order: CustomerSafeOrderStatusInput) {
  if (Boolean(order.canceledAt) || hasStatus(order.status, "canceled")) return "This order was canceled. Contact support if you need help with the record.";
  if (Boolean(order.refundStatus) || (order.refundedAmount ?? 0) > 0 || hasStatus(order.status, "refund")) return "A refund state is recorded. Contact support if anything looks off.";
  if (order.fulfillmentMethod === "local_pickup" && hasStatus(order.pickupStatus, "ready for pickup")) return "Local pickup is ready. Bring your order number when picking up.";
  if (order.fulfillmentMethod === "local_pickup") return "Local pickup readiness will appear here as soon as the order is prepared.";
  if (order.fulfillmentMethod === "shipping" && order.trackingNumber) return "Tracking is available. Carrier delivery timing may update outside GameDayGrabs.";
  if (order.fulfillmentMethod === "shipping") return "Tracking will appear here after the order ships.";
  return "This linked in-store purchase is recorded in your account.";
}
