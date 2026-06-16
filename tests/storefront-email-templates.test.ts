import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalPickupEmail,
  buildOrderConfirmationEmail,
  buildRefundCancellationEmail,
  buildShippingConfirmationEmail
} from "../src/lib/storefront-email-templates";

const supportEmail = "gamedaygrabs@outlook.com";
const logoUrl = "https://www.gamedaygrabs.com/brand/gamedaygrabs-logo-horizontal.png";
const sensitivePaymentPattern = /card number|card_number|cardNumber|CVC|cvc|cvv|payment_method_details|payment_method_data|raw Stripe|raw PaymentIntent|raw Checkout Session|webhook body/i;

const orderEmail = buildOrderConfirmationEmail({
  orderNumber: "PR-20260616-Y9SW07",
  supportEmail,
  logoUrl,
  items: [
    {
      name: "Mega Evolution Perfect Order Booster Bundle",
      quantity: 1,
      lineTotal: 44.99,
      imageUrl: "https://www.gamedaygrabs.com/product.jpg"
    }
  ],
  subtotal: 44.99,
  shippingCharged: 4.99,
  totalPaid: 49.98,
  shippingMethod: "Standard Shipping"
});

test("order confirmation email uses the light GameDayGrabs template", () => {
  assert.equal(orderEmail.subject, "GameDayGrabs order confirmed: PR-20260616-Y9SW07");
  assert.match(orderEmail.html, /#F5F7FA/);
  assert.match(orderEmail.html, /#FF6A00/);
  assert.match(orderEmail.html, /gamedaygrabs-logo-horizontal\.png/);
  assert.match(orderEmail.html, /Thanks for your order!/);
  assert.match(orderEmail.html, /PR-20260616-Y9SW07/);
  assert.match(orderEmail.html, /Mega Evolution Perfect Order Booster Bundle/);
  assert.match(orderEmail.html, /Total paid/);
  assert.match(orderEmail.html, /\$49\.98/);
  assert.match(orderEmail.html, /Shipping method/);
  assert.match(orderEmail.html, /Securely processed by Stripe/);
  assert.match(orderEmail.html, /gamedaygrabs@outlook\.com/);
  assert.doesNotMatch(orderEmail.html, /#0f3b23|#102314|background:#0f3b23/i);
  assert.doesNotMatch(orderEmail.html + orderEmail.text, sensitivePaymentPattern);
  assert.match(orderEmail.text, /Thanks for your order!/);
  assert.match(orderEmail.text, /Payment method: Securely processed by Stripe/);
});

test("shipping confirmation email includes tracking details and optional tracking button", () => {
  const email = buildShippingConfirmationEmail({
    orderNumber: "PR-20260616-Y9SW07",
    supportEmail,
    logoUrl,
    carrier: "Test Carrier",
    trackingNumber: "TEST-PR-20260616-Y9SW07",
    trackingUrl: "https://carrier.example/track/TEST-PR-20260616-Y9SW07",
    shippingAddress: {
      name: "GameDayGrabs Test",
      line1: "123 Test St",
      city: "Miami",
      state: "FL",
      postalCode: "33101",
      country: "US"
    }
  });

  assert.equal(email.subject, "Your GameDayGrabs order has shipped: PR-20260616-Y9SW07");
  assert.match(email.html, /Your order is on the way!/);
  assert.match(email.html, /Test Carrier/);
  assert.match(email.html, /TEST-PR-20260616-Y9SW07/);
  assert.match(email.html, /Track Your Package/);
  assert.match(email.html, /Tracking updates may take up to 24 hours/);
  assert.match(email.text, /Tracking link: https:\/\/carrier\.example/);
  assert.doesNotMatch(email.html + email.text, sensitivePaymentPattern);
});

test("refund and cancellation email includes refund status, amount, reason, and timing copy", () => {
  const email = buildRefundCancellationEmail({
    orderNumber: "PR-20260616-Y9SW07",
    supportEmail,
    logoUrl,
    statusLabel: "Order refunded",
    refundAmount: 49.98,
    reasonLabel: "Customer requested cancellation"
  });

  assert.equal(email.subject, "GameDayGrabs order update: PR-20260616-Y9SW07");
  assert.match(email.html, /Order update/);
  assert.match(email.html, /Order refunded/);
  assert.match(email.html, /\$49\.98/);
  assert.match(email.html, /Customer requested cancellation/);
  assert.match(email.html, /Refunds typically appear in your account within 3-10 business days/);
  assert.match(email.text, /Refund amount: \$49\.98/);
  assert.doesNotMatch(email.html + email.text, sensitivePaymentPattern);
});

test("local pickup email includes pickup instructions with no sensitive payment data", () => {
  const email = buildLocalPickupEmail({
    orderNumber: "PR-20260616-Y9SW07",
    supportEmail,
    logoUrl,
    pickupLocationLines: ["GameDayGrabs", "123 Test St", "Miami, FL 33101"],
    pickupNotes: ["Please bring a valid ID.", "We'll confirm your order details when you arrive."]
  });

  assert.equal(email.subject, "GameDayGrabs pickup instructions: PR-20260616-Y9SW07");
  assert.match(email.html, /Pickup ready!/);
  assert.match(email.html, /Pickup location/);
  assert.match(email.html, /123 Test St/);
  assert.match(email.html, /Please bring a valid ID/);
  assert.match(email.text, /Pickup notes:/);
  assert.match(email.text, /gamedaygrabs@outlook\.com/);
  assert.doesNotMatch(email.html + email.text, sensitivePaymentPattern);
});

test("all customer email templates include clean footer and support copy", () => {
  const emails = [
    orderEmail,
    buildShippingConfirmationEmail({ orderNumber: "PR-TEST", supportEmail, carrier: null, trackingNumber: null, shippingAddress: null }),
    buildRefundCancellationEmail({ orderNumber: "PR-TEST", supportEmail, statusLabel: "Order canceled", refundAmount: 0 }),
    buildLocalPickupEmail({ orderNumber: "PR-TEST", supportEmail, pickupLocationLines: [], pickupNotes: [] })
  ];

  for (const email of emails) {
    assert.match(email.html, /Thank you for supporting GameDayGrabs/);
    assert.match(email.html, /Questions\?/);
    assert.match(email.html, /GameDayGrabs is not affiliated with The Pokemon Company International/);
    assert.match(email.text, /Questions\? Contact gamedaygrabs@outlook\.com/);
    assert.doesNotMatch(email.html, /display:grid|grid-template|linear-gradient|#0f3b23|#102314/i);
    assert.doesNotMatch(email.html + email.text, sensitivePaymentPattern);
  }
});
