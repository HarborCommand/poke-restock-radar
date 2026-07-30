import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCheckoutExpiredEmail,
  buildLocalPickupEmail,
  buildOrderConfirmationEmail,
  buildRefundCancellationEmail,
  buildShippingConfirmationEmail,
  STOREFRONT_CUSTOMER_EMAIL_TEMPLATE_MARKER
} from "../src/lib/storefront-email-templates";

const supportEmail = "gamedaygrabs@outlook.com";
const logoUrl = "https://www.gamedaygrabs.com/brand/gamedaygrabs-logo-horizontal.png";
const sensitivePaymentPattern = /card number|card_number|cardNumber|CVC|cvc|cvv|payment_method_details|payment_method_data|raw Stripe|raw PaymentIntent|raw Checkout Session|webhook body/i;
const darkTemplatePattern = /background(?:-color)?:\s*(?:#111(?:111)?|#222(?:222)?|#242424|#0f3b23|#102314|black)|dark-wrapper|dark-card/i;
const whiteTextPattern = /(?<!background-)color:\s*(?:#fff(?:fff)?|white)\b/i;
const paleTextPattern = /(?<!background-)color:\s*(?:#f5f5f5|#eaeaea|#f7f7f7|#fafafa)\b/i;

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
  assert.match(orderEmail.html, new RegExp(STOREFRONT_CUSTOMER_EMAIL_TEMPLATE_MARKER));
  assert.match(orderEmail.html, /<meta name="color-scheme" content="light" \/>/);
  assert.match(orderEmail.html, /<meta name="supported-color-schemes" content="light" \/>/);
  assert.match(orderEmail.html, /bgcolor="#FFF7EB"/);
  assert.match(orderEmail.html, /background-color:#FFF7EB/);
  assert.match(orderEmail.html, /background-image:linear-gradient\(#FFF7EB,#FFF7EB\)/);
  assert.match(orderEmail.html, /bgcolor="#FFFFFF"/);
  assert.match(orderEmail.html, /background-color:#FFFFFF/);
  assert.match(orderEmail.html, /background-image:linear-gradient\(#FFFFFF,#FFFFFF\)/);
  assert.match(orderEmail.html, /border:1px solid #D0D5DD/);
  assert.match(orderEmail.html, /-webkit-text-fill-color:#101828/);
  assert.match(orderEmail.html, /-webkit-text-fill-color:#FF6A00/);
  assert.match(orderEmail.html, /-webkit-text-fill-color:#475467/);
  assert.match(orderEmail.html, /color:#101828/);
  assert.match(orderEmail.html, /#FF6A00/);
  assert.match(orderEmail.html, /gamedaygrabs-logo-horizontal\.png/);
  assert.match(orderEmail.html, /Thanks for your order!/);
  assert.match(orderEmail.html, /PR-20260616-Y9SW07/);
  assert.match(orderEmail.html, /Mega Evolution Perfect Order Booster Bundle/);
  assert.match(orderEmail.html, /Total paid/);
  assert.match(orderEmail.html, /\$49\.98/);
  assert.match(orderEmail.html, /Shipping method/);
  assert.match(orderEmail.html + orderEmail.text, /We'll send tracking once your order ships\./);
  assert.match(orderEmail.html, /Securely processed by Stripe/);
  assert.match(orderEmail.html, /gamedaygrabs@outlook\.com/);
  assert.match(orderEmail.html + orderEmail.text, /Check order status/);
  assert.match(orderEmail.html + orderEmail.text, /https:\/\/www\.gamedaygrabs\.com\/order-status/);
  assert.match(orderEmail.html + orderEmail.text, /https:\/\/www\.gamedaygrabs\.com\/policies/);
  assert.doesNotMatch(orderEmail.html, /background(?!-color)\s*:/i);
  assert.doesNotMatch(orderEmail.html, darkTemplatePattern);
  assert.doesNotMatch(orderEmail.html, whiteTextPattern);
  assert.doesNotMatch(orderEmail.html, paleTextPattern);
  assert.doesNotMatch(orderEmail.html + orderEmail.text, sensitivePaymentPattern);
  assert.match(orderEmail.text, /Thanks for your order!/);
  assert.match(orderEmail.text, /Payment method: Securely processed by Stripe/);
});

test("order confirmation preserves taxed, authoritative zero-tax, and historical unknown snapshots", () => {
  const base = {
    orderNumber: "PR-TAX-SNAPSHOT",
    supportEmail,
    items: [{ name: "Test product", quantity: 1, lineTotal: 25, imageUrl: null }],
    subtotal: 25,
    discount: 2,
    shippingCharged: 5,
    totalPaid: 29.61,
    shippingMethod: "USPS Ground Advantage"
  };
  const taxed = buildOrderConfirmationEmail({ ...base, tax: 1.61 });
  const zero = buildOrderConfirmationEmail({ ...base, tax: 0, totalPaid: 28 });
  const unknown = buildOrderConfirmationEmail({ ...base, tax: null, totalPaid: 28 });

  assert.match(taxed.html + taxed.text, /Discount/);
  assert.match(taxed.html + taxed.text, /-\$2\.00/);
  assert.match(taxed.html + taxed.text, /Sales tax[^]*\$1\.61/);
  assert.match(zero.html + zero.text, /Sales tax[^]*\$0\.00/);
  assert.match(unknown.html + unknown.text, /Sales tax[^]*Not recorded/);
  for (const email of [taxed, zero, unknown]) {
    assert.doesNotMatch(email.html + email.text, /taxCalculationId|stripeCheckoutSessionId|stripePaymentIntentId|providerReference|postal_code|customer_address/i);
  }
});

test("local pickup order confirmation uses pickup wording instead of shipping tracking copy", () => {
  const email = buildOrderConfirmationEmail({
    orderNumber: "PR-20260618-9C3KQ3",
    supportEmail,
    logoUrl,
    items: [
      {
        name: "Perfect Order Premium Checklane Blister - Meganium",
        quantity: 1,
        lineTotal: 18,
        imageUrl: "https://www.gamedaygrabs.com/meganium.jpg"
      }
    ],
    subtotal: 18,
    shippingCharged: 0,
    totalPaid: 18,
    shippingMethod: "Local Pickup",
    isLocalPickup: true,
    pickupStatus: "unfulfilled"
  });

  assert.equal(email.subject, "GameDayGrabs order confirmed: PR-20260618-9C3KQ3");
  assert.match(email.html, /Fulfillment method/);
  assert.match(email.html, /Local Pickup/);
  assert.match(email.html, /Pickup status/);
  assert.match(email.html, /Pickup pending/);
  assert.match(email.html + email.text, /We'll send pickup instructions when your order is ready\./);
  assert.match(email.text, /Fulfillment method: Local Pickup/);
  assert.match(email.text, /Shipping charged: \$0\.00/);
  assert.match(email.text, /Pickup status: Pickup pending/);
  assert.match(email.text, /gamedaygrabs@outlook\.com/);
  assert.doesNotMatch(email.html + email.text, /tracking once your order ships|Your order is on the way|has shipped|Track Your Package/i);
  assert.doesNotMatch(email.html + email.text, sensitivePaymentPattern);
});

test("order confirmation can include a safe optional account and rewards CTA", () => {
  const email = buildOrderConfirmationEmail({
    orderNumber: "PR-REWARDS",
    supportEmail,
    logoUrl,
    items: [
      {
        name: "Mega Evolution Perfect Order Booster Bundle",
        quantity: 1,
        lineTotal: 44.99,
        imageUrl: null
      }
    ],
    subtotal: 44.99,
    shippingCharged: 5.7,
    totalPaid: 50.69,
    shippingMethod: "USPS Ground Advantage",
    accountCtaEnabled: true,
    rewardsCtaEnabled: true
  });

  assert.match(email.html + email.text, /Create your GameDayGrabs account to track orders and rewards/);
  assert.match(email.html + email.text, /Earn points on eligible purchases\. Redemption coming soon/);
  assert.doesNotMatch(email.html + email.text, /Reward earning is currently paused/);
  assert.match(email.html, /https:\/\/www\.gamedaygrabs\.com\/account\/login/);
  assert.doesNotMatch(email.html + email.text, /redeem points|apply points|coupon/i);
  assert.doesNotMatch(email.html + email.text, sensitivePaymentPattern);
});

test("order confirmation account CTA stays order-only when rewards are disabled", () => {
  const email = buildOrderConfirmationEmail({
    orderNumber: "PR-ACCOUNT-ONLY",
    supportEmail,
    logoUrl,
    items: [
      {
        name: "Mega Evolution Perfect Order Booster Bundle",
        quantity: 1,
        lineTotal: 44.99,
        imageUrl: null
      }
    ],
    subtotal: 44.99,
    shippingCharged: 5.7,
    totalPaid: 50.69,
    shippingMethod: "USPS Ground Advantage",
    accountCtaEnabled: true,
    rewardsCtaEnabled: false
  });

  assert.match(email.html + email.text, /Create your GameDayGrabs account to track orders/);
  assert.match(email.html + email.text, /Guest checkout remains available/);
  assert.doesNotMatch(email.html + email.text, /Earn points on eligible purchases|Reward earning is currently paused|track orders and rewards/i);
  assert.match(email.html, /https:\/\/www\.gamedaygrabs\.com\/account\/login/);
  assert.doesNotMatch(email.html + email.text, sensitivePaymentPattern);
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
  assert.match(email.html + email.text, /Check order status/);
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
    refundedTax: 2.98,
    remainingTotal: 0,
    reasonLabel: "Customer requested cancellation"
  });

  assert.equal(email.subject, "GameDayGrabs order update: PR-20260616-Y9SW07");
  assert.match(email.html, /Order update/);
  assert.match(email.html, /Order refunded/);
  assert.match(email.html, /\$49\.98/);
  assert.match(email.html, /Customer requested cancellation/);
  assert.match(email.html, /Refunds typically appear in your account within 3-10 business days/);
  assert.match(email.html + email.text, /Store policies|https:\/\/www\.gamedaygrabs\.com\/policies/);
  assert.match(email.html + email.text, /Check order status/);
  assert.match(email.html, /Status/);
  assert.match(email.html, /Refund amount/);
  assert.match(email.html, /Reason/);
  assert.match(email.html, /-webkit-text-fill-color:#101828[^>]+font-size:15px[^>]+font-weight:900/);
  assert.match(email.html, /border-color:#D98F45/);
  assert.match(email.html, /bgcolor="#FFF3E2"/);
  assert.doesNotMatch(email.html, whiteTextPattern);
  assert.doesNotMatch(email.html, paleTextPattern);
  assert.match(email.text, /Refund amount: \$49\.98/);
  assert.match(email.html + email.text, /Sales tax refunded/);
  assert.match(email.text, /Sales tax refunded: \$2\.98/);
  assert.match(email.text, /Remaining paid total: \$0\.00/);
  assert.doesNotMatch(email.html + email.text, sensitivePaymentPattern);
});

test("partial refund email shows refunded tax and the updated remaining paid total", () => {
  const email = buildRefundCancellationEmail({
    orderNumber: "PR-PARTIAL-REFUND",
    supportEmail,
    statusLabel: "Partially refunded",
    refundAmount: 12,
    refundedTax: 0.72,
    remainingTotal: 37.98,
    reasonLabel: "Customer requested partial return"
  });
  assert.match(email.html + email.text, /Partially refunded/);
  assert.match(email.html + email.text, /Sales tax refunded/);
  assert.match(email.html + email.text, /\$0\.72/);
  assert.match(email.html + email.text, /Remaining paid total/);
  assert.match(email.html + email.text, /\$37\.98/);
  assert.doesNotMatch(email.html + email.text, /taxCalculationId|stripeCheckoutSessionId|stripePaymentIntentId|providerReference|admin note/i);
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
  assert.match(email.html + email.text, /Check order status/);
  assert.match(email.text, /Pickup notes:/);
  assert.match(email.text, /gamedaygrabs@outlook\.com/);
  assert.doesNotMatch(email.html + email.text, sensitivePaymentPattern);
});

test("all customer email templates include clean footer and support copy", () => {
  const emails = [
    orderEmail,
    buildShippingConfirmationEmail({ orderNumber: "PR-TEST", supportEmail, carrier: null, trackingNumber: null, shippingAddress: null }),
    buildRefundCancellationEmail({ orderNumber: "PR-TEST", supportEmail, statusLabel: "Order canceled", refundAmount: 0, refundedTax: null, remainingTotal: 0 }),
    buildLocalPickupEmail({ orderNumber: "PR-TEST", supportEmail, pickupLocationLines: [], pickupNotes: [] }),
    buildCheckoutExpiredEmail({ orderNumber: "PR-TEST", supportEmail, items: [], reason: "Checkout expired before payment." })
  ];

  for (const email of emails) {
    assert.match(email.html, /<meta name="color-scheme" content="light" \/>/);
    assert.match(email.html, new RegExp(STOREFRONT_CUSTOMER_EMAIL_TEMPLATE_MARKER));
    assert.match(email.html, /bgcolor="#FFF7EB"/);
    assert.match(email.html, /background-color:#FFFFFF/);
    assert.match(email.html, /background-image:linear-gradient\(#FFFFFF,#FFFFFF\)/);
    assert.match(email.html, /border:1px solid #D0D5DD/);
    assert.match(email.html, /-webkit-text-fill-color:#101828/);
    assert.match(email.html, /-webkit-text-fill-color:#475467/);
    assert.match(email.html, /color:#101828/);
    assert.match(email.html, /#FF6A00/);
    assert.match(email.html, /Thank you for supporting GameDayGrabs/);
    assert.match(email.html, /Questions\?/);
    assert.match(email.html, /Check order status/);
    assert.match(email.html, /Store policies/);
    assert.match(email.html, /GameDayGrabs is not affiliated with The Pokemon Company International/);
    assert.match(email.text, /Questions\? Contact gamedaygrabs@outlook\.com/);
    assert.match(email.text, /Check order status: https:\/\/www\.gamedaygrabs\.com\/order-status/);
    assert.match(email.text, /Store policies: https:\/\/www\.gamedaygrabs\.com\/policies/);
    assert.doesNotMatch(email.html, /background(?!-color)\s*:/i);
    assert.doesNotMatch(email.html, /display:grid|grid-template|#0f3b23|#102314/i);
    assert.doesNotMatch(email.html, darkTemplatePattern);
    assert.doesNotMatch(email.html, whiteTextPattern);
    assert.doesNotMatch(email.html, paleTextPattern);
    assert.doesNotMatch(email.html + email.text, sensitivePaymentPattern);
  }
});
