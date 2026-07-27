import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildReceiptEmail,
  fallbackReceiptEmailDelivery,
  maskReceiptEmail,
  notRequestedReceiptEmailDelivery,
  normalizeReceiptEmail,
  receiptEmailDeliveryAvailable,
  receiptEmailFeatureConfig,
  type ReceiptEmailSnapshot
} from "../src/lib/receipt-email";

const source = (path: string) => readFileSync(path, "utf8");

const receiptEmailSource = source("src/lib/receipt-email.ts");
const radarServiceSource = source("src/lib/radar-service.ts");
const storefrontSource = source("src/lib/storefront.ts");
const radarAppSource = source("src/components/RadarApp.tsx");
const validationSource = source("src/lib/validation.ts");
const rateLimitSource = source("src/lib/rate-limit.ts");
const posSaleRouteSource = source("src/app/api/radar/pos/sales/route.ts");
const posResendRouteSource = source("src/app/api/radar/pos/sales/[saleReference]/receipt-email/route.ts");
const storefrontResendRouteSource = source("src/app/api/radar/storefront/orders/[orderId]/receipt-email/route.ts");
const schemaSource = source("prisma/schema.prisma");
const migrationSource = source("prisma/migrations/20260727120000_receipt_email_deliveries/migration.sql");

const hiddenInternalPattern =
  /cost basis|costBasis|profit|internal note|admin note|private note|inventory lot|lot id|stripe secret|payment_method_details|card number|cvc|cvv|idempotency key|database id/i;

const storefrontSnapshot: ReceiptEmailSnapshot = {
  sourceType: "STOREFRONT_ORDER",
  receiptNumber: "GDD-20260727-ABCD",
  completedAt: "2026-07-27T16:45:00.000Z",
  customerName: "Guest Collector",
  lineItems: [
    {
      name: "Mega Evolution Perfect Order Booster Bundle <script>alert('x')</script>",
      quantity: 2,
      unitPrice: 44.99,
      lineTotal: 89.98
    },
    {
      name: "Pokémon TCG: Mega Moonlit Tin",
      quantity: 1,
      unitPrice: 39.99,
      lineTotal: 39.99
    }
  ],
  subtotal: 129.97,
  discount: 10,
  shipping: 4.99,
  tax: 8.75,
  total: 133.71,
  paymentMethodLabel: "Securely processed by Stripe",
  fulfillmentMethod: "Shipping",
  fulfillmentSummary: "Ships to the checkout address.",
  supportEmail: "gamedaygrabs@outlook.com",
  orderStatusUrl: "https://www.gamedaygrabs.com/order-status?order=GDD-20260727-ABCD"
};

const posSnapshot: ReceiptEmailSnapshot = {
  sourceType: "POS_SALE",
  receiptNumber: "POS-7F2D19A8",
  completedAt: "2026-07-27T18:15:00.000Z",
  customerName: "Linked Collector",
  lineItems: [
    {
      name: "Pitch Black Elite Trainer Box",
      quantity: 1,
      unitPrice: 75,
      lineTotal: 75
    },
    {
      name: "Chaos Rising Premium Checklane Blister",
      quantity: 3,
      unitPrice: 19.99,
      lineTotal: 59.97
    }
  ],
  subtotal: 134.97,
  discount: 5,
  shipping: 0,
  tax: 9.1,
  total: 139.07,
  paymentMethodLabel: "Manual POS payment",
  fulfillmentMethod: "In-person pickup",
  fulfillmentSummary: "Completed at the counter.",
  supportEmail: "gamedaygrabs@outlook.com"
};

test("receipt renderer produces branded storefront HTML and text from persisted values", () => {
  const email = buildReceiptEmail(storefrontSnapshot);
  const combined = `${email.subject}\n${email.html}\n${email.text}`;

  assert.equal(email.subject, "Your GameDayGrabs receipt GDD-20260727-ABCD");
  assert.match(email.html, /GameDay<span style="color:#FF6A00;">Grabs<\/span>/);
  assert.match(combined, /GDD-20260727-ABCD/);
  assert.match(combined, /Guest Collector/);
  assert.match(combined, /Mega Evolution Perfect Order Booster Bundle/);
  assert.match(combined, /Pokémon TCG: Mega Moonlit Tin/);
  assert.match(combined, /2 x Mega Evolution Perfect Order Booster Bundle/);
  assert.match(email.html, /Qty 2 &times; \$44\.99/);
  assert.match(combined, /Discount: -\$10\.00/);
  assert.match(combined, /Subtotal: \$129\.97/);
  assert.match(combined, /Shipping: \$4\.99/);
  assert.match(combined, /Tax: \$8\.75/);
  assert.match(combined, /Total paid: \$133\.71/);
  assert.match(combined, /Securely processed by Stripe/);
  assert.match(combined, /Ships to the checkout address/);
  assert.match(combined, /gamedaygrabs@outlook\.com/);
  assert.match(combined, /https:\/\/www\.gamedaygrabs\.com\/order-status/);
  assert.doesNotMatch(email.html, /<script>/i);
  assert.match(email.html, /&lt;script&gt;alert/);
  assert.doesNotMatch(combined, hiddenInternalPattern);
});

test("receipt renderer produces POS receipt content without exposing internals", () => {
  const email = buildReceiptEmail(posSnapshot);
  const combined = `${email.subject}\n${email.html}\n${email.text}`;

  assert.equal(email.subject, "Your GameDayGrabs receipt POS-7F2D19A8");
  assert.match(combined, /POS-7F2D19A8/);
  assert.match(combined, /Linked Collector/);
  assert.match(combined, /Pitch Black Elite Trainer Box/);
  assert.match(combined, /Chaos Rising Premium Checklane Blister/);
  assert.match(combined, /3 x Chaos Rising Premium Checklane Blister @ \$19\.99 = \$59\.97/);
  assert.match(combined, /Discount: -\$5\.00/);
  assert.match(combined, /Subtotal: \$134\.97/);
  assert.doesNotMatch(combined, /Shipping:/);
  assert.match(combined, /Tax: \$9\.10/);
  assert.match(combined, /Total paid: \$139\.07/);
  assert.match(combined, /Manual POS payment/);
  assert.match(combined, /In-person pickup/);
  assert.doesNotMatch(combined, hiddenInternalPattern);
});

test("receipt email configuration defaults disabled and normalizes recipients safely", () => {
  assert.deepEqual(receiptEmailFeatureConfig({}), {
    storefrontReceiptEmailsEnabled: false,
    posReceiptEmailsEnabled: false
  });
  assert.deepEqual(
    receiptEmailFeatureConfig({
      STOREFRONT_RECEIPT_EMAILS_ENABLED: "true",
      POS_RECEIPT_EMAILS_ENABLED: " TRUE "
    }),
    { storefrontReceiptEmailsEnabled: true, posReceiptEmailsEnabled: true }
  );
  assert.equal(normalizeReceiptEmail(" Collector@Example.COM "), "collector@example.com");
  assert.equal(normalizeReceiptEmail("not-an-email"), null);
  assert.equal(maskReceiptEmail("Collector@Example.COM"), "c***@example.com");
});

test("delivery persistence is narrowly scoped, idempotent, and does not store rendered receipt bodies", () => {
  assert.match(schemaSource, /model ReceiptEmailDelivery/);
  assert.match(schemaSource, /idempotencyKey\s+String\s+@unique/);
  assert.match(schemaSource, /sourceType\s+String/);
  assert.match(schemaSource, /sourceId\s+String/);
  assert.match(schemaSource, /recipientEmailNormalized\s+String/);
  assert.match(schemaSource, /recipientEmailMasked\s+String/);
  assert.match(schemaSource, /requestedByUserId\s+String\?/);
  assert.match(migrationSource, /CREATE TABLE "ReceiptEmailDelivery"/);
  assert.match(migrationSource, /ReceiptEmailDelivery_idempotencyKey_key/);
  assert.doesNotMatch(schemaSource, /htmlBody|textBody|emailBody|renderedBody/);
  assert.match(receiptEmailSource, /P2002/);
  assert.match(receiptEmailSource, /findUniqueOrThrow\(\{ where: \{ idempotencyKey/);
  assert.match(receiptEmailSource, /delivery\.status === "SENT" \|\| delivery\.status === "FAILED" \|\| delivery\.attemptCount > 0/);
});

test("storefront sends exactly one automatic order-confirmation receipt on the durable paid side effect", () => {
  assert.match(storefrontSource, /async function completePaidCheckoutSideEffects\(order/);
  assert.match(storefrontSource, /if \(order\.paymentStatus !== "paid"\) return;/);
  assert.match(storefrontSource, /await sendStorefrontOrderConfirmationEmail\(order\);/);
  assert.doesNotMatch(storefrontSource, /await sendStorefrontReceiptEmail\(order\);/);
  assert.doesNotMatch(storefrontSource, /receipt:storefront:initial:\$\{order\.id\}:\$\{recipient\}/);
  assert.match(storefrontSource, /Your GameDayGrabs order confirmation and receipt/);
  assert.match(storefrontSource, /customerEmailEventId\("order_confirmation", order\.id\)/);
  assert.match(storefrontSource, /catch \{\s*\/\/ Customer email delivery\/status persistence is best-effort/);
  assert.match(storefrontSource, /normalizeReceiptEmail\(order\.customerEmail\) \?\? normalizeReceiptEmail\(order\.customer\?\.email\)/);
  assert.doesNotMatch(storefrontSource, /createCheckoutSession[\s\S]{0,1000}sendStorefrontReceiptEmail/);
  assert.match(storefrontSource, /sendStorefrontOrderReceiptEmail/);
  assert.match(storefrontResendRouteSource, /export async function GET/);
  assert.match(storefrontResendRouteSource, /getStorefrontOrderReceiptEmailStatus/);
  assert.match(storefrontResendRouteSource, /requireUser/);
  assert.match(storefrontResendRouteSource, /authorizeAdminMutation/);
  assert.match(storefrontResendRouteSource, /checkPublicRateLimit/);
  assert.match(storefrontResendRouteSource, /sendStorefrontOrderReceiptEmail/);
});

test("POS checkout keeps email optional, validates when checked, and never creates accounts from guest receipt email", () => {
  assert.match(validationSource, /emailReceipt/);
  assert.match(validationSource, /receiptEmail/);
  assert.match(validationSource, /Enter an email address for the receipt\./);
  assert.match(radarAppSource, /const \[emailReceipt, setEmailReceipt\] = useState\(false\)/);
  assert.match(radarAppSource, /Email receipt/);
  assert.match(radarAppSource, /Receipt email is not configured/);
  assert.match(radarAppSource, /No account is required/);
  assert.match(radarAppSource, /setReceiptEmail\(result\.match\.displayEmail\)/);
  assert.match(radarAppSource, /emailReceipt && posReceiptEmailReady && !validReceiptEmail\(receiptEmail\)/);
  assert.match(radarAppSource, /receiptEmail: posReceiptEmailReady && emailReceipt \? receiptEmail\.trim\(\) : undefined/);
  assert.match(radarServiceSource, /input\.emailReceipt && posReceiptEmailReady \? normalizeReceiptEmail/);
  assert.match(radarAppSource, /Receipt not emailed/);
  assert.match(radarAppSource, /Change email and send/);
  assert.doesNotMatch(radarServiceSource, /receiptEmail[\s\S]{0,300}createCustomerAccount/);
  assert.doesNotMatch(radarServiceSource, /receiptEmail[\s\S]{0,300}connectOrCreate/);
});

test("POS sale integrity is independent from receipt-email delivery failure", () => {
  assert.match(posSaleRouteSource, /requestId/);
  assert.match(radarServiceSource, /emailReceipt\?: boolean/);
  assert.match(radarServiceSource, /requestReceiptEmailDelivery\(/);
  assert.match(radarServiceSource, /return \{ \.\.\.receipt, receiptEmailDelivery: delivery \};/);
  assert.match(radarServiceSource, /fallbackReceiptEmailDelivery/);
  assert.match(radarServiceSource, /The sale completed, but the receipt email could not be sent\./);
  assert.match(receiptEmailSource, /sendEmailViaProvider/);
  assert.match(receiptEmailSource, /const status = sendResult\.status === "sent" \? "SENT" : "FAILED";/);
  assert.match(receiptEmailSource, /sanitizedFailureCode/);
  assert.doesNotMatch(receiptEmailSource, /throw sendResult|throw new Error\(sendResult/);
});

test("manual POS receipt resend is admin-only, rate limited, and constrained to canonical receipts", () => {
  assert.match(posResendRouteSource, /requireUser/);
  assert.match(posResendRouteSource, /authorizeAdminMutation/);
  assert.match(posResendRouteSource, /receiptEmailResendSchema/);
  assert.match(posResendRouteSource, /admin_receipt_email/);
  assert.match(posResendRouteSource, /sendPosReceiptEmail/);
  assert.match(rateLimitSource, /"admin_receipt_email"/);
  assert.match(radarServiceSource, /receiptForExistingPosSale/);
  assert.match(radarServiceSource, /posReceiptEmailSnapshot\(receipt/);
  assert.match(radarServiceSource, /Receipt resend idempotency key is required\./);
  assert.match(validationSource, /idempotencyKey: z\.string\(\)\.trim\(\)\.min\(8\)\.max\(120\)\.regex/);
  assert.doesNotMatch(radarServiceSource, /receipt:pos:resend:[\s\S]{0,120}Date\.now/);
  assert.doesNotMatch(storefrontSource, /receipt:storefront:resend:[\s\S]{0,120}Date\.now/);
  assert.doesNotMatch(radarAppSource, /receipt-resend[^\\n]*Date\.now/);
  assert.doesNotMatch(radarAppSource, /order-receipt-resend[^\\n]*Date\.now/);
  assert.doesNotMatch(posResendRouteSource, /html|body|subject/);
});

test("audit events use masked metadata and never log full receipt bodies", () => {
  assert.match(receiptEmailSource, /pos\.receipt_email\.requested/);
  assert.match(receiptEmailSource, /receipt_email\.\$\{input\.deliveryType === "RESEND" && status === "SENT" \? "resent" : status === "SENT" \? "sent" : "failed"\}/);
  assert.match(receiptEmailSource, /maskedEmail: delivery\.recipientEmailMasked/);
  assert.match(receiptEmailSource, /attemptNumber: updated\.attemptCount/);
  assert.doesNotMatch(receiptEmailSource, /metadata:[\s\S]{0,500}(html|text|lineItems|recipientEmailNormalized)/);
});

test("receipt delivery availability is deterministic and does not create disabled pending attempts", () => {
  const configured = {
    POS_RECEIPT_EMAILS_ENABLED: "true",
    STOREFRONT_RECEIPT_EMAILS_ENABLED: "true",
    RESEND_API_KEY: "test_resend_key",
    EMAIL_FROM: "GameDayGrabs <receipts@example.com>"
  };
  assert.equal(receiptEmailDeliveryAvailable("POS_SALE", configured), true);
  assert.equal(receiptEmailDeliveryAvailable("STOREFRONT_ORDER", configured), true);
  assert.equal(receiptEmailDeliveryAvailable("POS_SALE", { ...configured, POS_RECEIPT_EMAILS_ENABLED: "false" }), false);
  assert.equal(receiptEmailDeliveryAvailable("POS_SALE", { POS_RECEIPT_EMAILS_ENABLED: "true" }), false);
  assert.deepEqual(notRequestedReceiptEmailDelivery(), {
    status: "NOT_REQUESTED",
    deliveryType: null,
    maskedRecipient: null,
    sentAt: null,
    lastAttemptAt: null,
    attemptCount: 0,
    sanitizedFailureCode: null,
    sanitizedFailureMessage: null
  });
  assert.doesNotMatch(receiptEmailSource, /RECEIPT_EMAILS_DISABLED[\s\S]{0,240}status: "PENDING"/);
});

test("receipt delivery fallback DTOs are sanitized and preserve completed-sale behavior", () => {
  const delivery = fallbackReceiptEmailDelivery({
    status: "FAILED",
    deliveryType: "INITIAL",
    recipientEmail: "Collector@example.com",
    sanitizedFailureCode: "RECEIPT_EMAIL_UNAVAILABLE",
    sanitizedFailureMessage: "The sale completed, but the receipt email could not be sent."
  });
  assert.equal(delivery.status, "FAILED");
  assert.equal(delivery.deliveryType, "INITIAL");
  assert.equal(delivery.maskedRecipient, "c***@example.com");
  assert.equal(delivery.attemptCount, 1);
  assert.equal(delivery.sanitizedFailureCode, "RECEIPT_EMAIL_UNAVAILABLE");
  assert.equal(delivery.sanitizedFailureMessage, "The sale completed, but the receipt email could not be sent.");
});
