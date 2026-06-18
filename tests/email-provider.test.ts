import assert from "node:assert/strict";
import test from "node:test";
import { emailProviderConfig, renderEmailHtml, sendEmailViaProvider } from "../src/lib/email-provider";
import { sendStorefrontEmail } from "../src/lib/storefront";
import {
  buildCheckoutExpiredEmail,
  buildLocalPickupEmail,
  buildOrderConfirmationEmail,
  buildRefundCancellationEmail,
  buildShippingConfirmationEmail,
  STOREFRONT_CUSTOMER_EMAIL_TEMPLATE_MARKER,
  type StorefrontRenderedEmail
} from "../src/lib/storefront-email-templates";

const resendEnv = {
  RESEND_API_KEY: "test_resend_api_key",
  EMAIL_FROM: "GameDayGrabs Orders <orders@example.com>",
  EMAIL_REPLY_TO: "support@example.com"
};
const darkTemplatePattern = /background(?:-color)?:\s*(?:#111(?:111)?|#222(?:222)?|#242424|#0f3b23|#102314|black)|dark-wrapper|dark-card/i;
const backgroundShorthandPattern = /background(?!-color)\s*:/i;
const whiteTextPattern = /(?<!background-)color:\s*(?:#fff(?:fff)?|white)\b/i;
const paleTextPattern = /(?<!background-)color:\s*(?:#f5f5f5|#eaeaea|#f7f7f7|#fafafa)\b/i;

async function captureStorefrontResendHtml(email: StorefrontRenderedEmail) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "email_customer_template_test" }), { status: 200 });
  };

  const result = await sendStorefrontEmail(
    "buyer@example.com",
    email.subject,
    email.text,
    "customer_email.order_confirmation:order_test:default",
    email.html,
    { env: resendEnv, fetchImpl }
  );

  assert.equal(result.status, "sent");
  assert.equal(result.provider, "resend");
  assert.equal(requests.length, 1);
  const body = JSON.parse(String(requests[0].init?.body)) as Record<string, unknown>;
  return String(body.html);
}

function assertLightCustomerEmailHtml(html: string) {
  assert.match(html, new RegExp(STOREFRONT_CUSTOMER_EMAIL_TEMPLATE_MARKER));
  assert.match(html, /<meta name="color-scheme" content="light" \/>/);
  assert.match(html, /<meta name="supported-color-schemes" content="light" \/>/);
  assert.match(html, /bgcolor="#FFF7EB"/);
  assert.match(html, /background-color:#FFF7EB/);
  assert.match(html, /background-image:linear-gradient\(#FFF7EB,#FFF7EB\)/);
  assert.match(html, /bgcolor="#FFFFFF"/);
  assert.match(html, /background-color:#FFFFFF/);
  assert.match(html, /background-image:linear-gradient\(#FFFFFF,#FFFFFF\)/);
  assert.match(html, /border:1px solid #D0D5DD/);
  assert.match(html, /-webkit-text-fill-color:#101828/);
  assert.match(html, /-webkit-text-fill-color:#475467/);
  assert.match(html, /-webkit-text-fill-color:#FF6A00/);
  assert.match(html, /#FF6A00/);
  assert.match(html, /GameDayGrabs/);
  assert.doesNotMatch(html, backgroundShorthandPattern);
  assert.doesNotMatch(html, darkTemplatePattern);
  assert.doesNotMatch(html, whiteTextPattern);
  assert.doesNotMatch(html, paleTextPattern);
  assert.doesNotMatch(html, /payment_method_details|payment_method_data|card_number|cardNumber|CVC|cvc|cvv|raw Stripe|raw PaymentIntent|raw Checkout Session|webhook body/i);
}

test("Resend provider sends through mocked fetch without exposing the API key in stored results", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "email_test_123" }), { status: 200 });
  };

  const result = await sendEmailViaProvider(
    {
      to: "buyer@example.com",
      subject: "GameDayGrabs order confirmed: PR-TEST",
      text: "Thanks for your order.\n\nOrder: PR-TEST",
      headers: {
        "X-Entity-Ref-ID": "gdd:PR-TEST:order_confirmation",
        "X-GDD-Notification-Type": "order_confirmation",
        "X-GDD-Order-Number": "PR-TEST",
        "X-Unsafe-Header": "should not send"
      },
      tags: [
        { name: "orderNumber", value: "PR-TEST" },
        { name: "notificationType", value: "order_confirmation" },
        { name: "environment", value: "test" },
        { name: "bad tag name", value: "safe" }
      ]
    },
    { env: resendEnv, fetchImpl, idempotencyKey: "customer_email.order_confirmation:order_test:default" }
  );

  assert.equal(result.status, "sent");
  assert.equal(result.provider, "resend");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.resend.com/emails");

  const headers = requests[0].init?.headers as Record<string, string>;
  const body = JSON.parse(String(requests[0].init?.body)) as Record<string, unknown>;
  assert.equal(headers.Authorization, "Bearer test_resend_api_key");
  assert.equal(headers["Idempotency-Key"], "customer_email.order_confirmation:order_test:default");
  assert.equal(body.from, resendEnv.EMAIL_FROM);
  assert.equal(body.reply_to, resendEnv.EMAIL_REPLY_TO);
  assert.equal(body.to, "buyer@example.com");
  assert.equal(body.subject, "GameDayGrabs order confirmed: PR-TEST");
  assert.deepEqual(body.headers, {
    "X-Entity-Ref-ID": "gdd:PR-TEST:order_confirmation",
    "X-GDD-Notification-Type": "order_confirmation",
    "X-GDD-Order-Number": "PR-TEST"
  });
  assert.deepEqual(body.tags, [
    { name: "orderNumber", value: "PR-TEST" },
    { name: "notificationType", value: "order_confirmation" },
    { name: "environment", value: "test" },
    { name: "bad_tag_name", value: "safe" }
  ]);
  assert.match(String(body.html), /GameDayGrabs/);
  assert.match(String(body.html), /<meta name="color-scheme" content="light" \/>|<meta name="color-scheme" content="light"/);
  assert.match(String(body.html), /bgcolor="#FFF7EB"/);
  assert.match(String(body.html), /background-color:#FFFFFF/);
  assert.match(String(body.html), /#101828/);
  assert.match(String(body.html), /#475467/);
  assert.match(String(body.html), /#D0D5DD/);
  assert.match(String(body.html), /#FF6A00/);
  assert.doesNotMatch(String(body.html), darkTemplatePattern);
  assert.doesNotMatch(JSON.stringify(result), /test_resend_api_key|orders@example\.com|support@example\.com/);
  assert.doesNotMatch(JSON.stringify(body), /test_resend_api_key|payment_method_details|payment_method_data|card_number|CVC|raw Stripe/i);
  assert.doesNotMatch(JSON.stringify(body.headers), /secret|token|api_key|payment/i);
  assert.doesNotMatch(JSON.stringify(body.tags), /secret|token|api_key|payment_method|stripe/i);
});

test("storefront email helper can attach safe customer metadata to Resend payload", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: "email_metadata_test" }), { status: 200 });
  };

  const result = await sendStorefrontEmail(
    "buyer@example.com",
    "GameDayGrabs order confirmed: PR-20260617-META01",
    "Thanks for your order.\n\nOrder number: PR-20260617-META01",
    "customer_email.order_confirmation:order_meta:default",
    "<p>Thanks for your order.</p>",
    {
      env: resendEnv,
      fetchImpl,
      headers: {
        "X-Entity-Ref-ID": "gdd:PR-20260617-META01:order_confirmation",
        "X-GDD-Notification-Type": "order_confirmation",
        "X-GDD-Order-Number": "PR-20260617-META01"
      },
      tags: [
        { name: "orderNumber", value: "PR-20260617-META01" },
        { name: "notificationType", value: "order_confirmation" },
        { name: "environment", value: "test" }
      ]
    }
  );

  assert.equal(result.status, "sent");
  assert.equal(requests.length, 1);
  const apiHeaders = requests[0].init?.headers as Record<string, string>;
  const body = JSON.parse(String(requests[0].init?.body)) as Record<string, unknown>;
  assert.equal(apiHeaders["Idempotency-Key"], "customer_email.order_confirmation:order_meta:default");
  assert.deepEqual(body.headers, {
    "X-Entity-Ref-ID": "gdd:PR-20260617-META01:order_confirmation",
    "X-GDD-Notification-Type": "order_confirmation",
    "X-GDD-Order-Number": "PR-20260617-META01"
  });
  assert.deepEqual(body.tags, [
    { name: "orderNumber", value: "PR-20260617-META01" },
    { name: "notificationType", value: "order_confirmation" },
    { name: "environment", value: "test" }
  ]);
  assert.doesNotMatch(JSON.stringify(body), /payment_method_details|payment_method_data|card_number|CVC|raw Stripe|raw webhook/i);
});

test("storefront customer emails pass the light template HTML through to Resend", async () => {
  const supportEmail = "gamedaygrabs@outlook.com";
  const logoUrl = "https://www.gamedaygrabs.com/brand/gamedaygrabs-logo-horizontal.png";
  const templates = [
    buildOrderConfirmationEmail({
      orderNumber: "PR-20260617-CH8BO6",
      supportEmail,
      logoUrl,
      items: [{ name: "Pokemon Test Product", quantity: 1, lineTotal: 44.99, imageUrl: "https://www.gamedaygrabs.com/product.jpg" }],
      subtotal: 44.99,
      shippingCharged: 5.99,
      totalPaid: 50.98,
      shippingMethod: "Standard Shipping"
    }),
    buildShippingConfirmationEmail({
      orderNumber: "PR-20260617-CH8BO6",
      supportEmail,
      logoUrl,
      carrier: "Test Carrier",
      trackingNumber: "TEST-PR-20260617-CH8BO6",
      trackingUrl: "https://carrier.example/track/TEST-PR-20260617-CH8BO6",
      shippingAddress: { name: "GameDayGrabs Test", line1: "123 Test St", city: "Miami", state: "FL", postalCode: "33101", country: "US" }
    }),
    buildRefundCancellationEmail({
      orderNumber: "PR-20260617-CH8BO6",
      supportEmail,
      logoUrl,
      statusLabel: "Order refunded",
      refundAmount: 50.98,
      reasonLabel: "Customer requested cancellation"
    }),
    buildLocalPickupEmail({
      orderNumber: "PR-20260617-CH8BO6",
      supportEmail,
      logoUrl,
      pickupLocationLines: ["GameDayGrabs", "123 Test St", "Miami, FL 33101"],
      pickupNotes: ["Please bring a valid ID."]
    }),
    buildCheckoutExpiredEmail({
      orderNumber: "PR-20260617-CH8BO6",
      supportEmail,
      logoUrl,
      items: [{ name: "Pokemon Test Product", quantity: 1, lineTotal: 44.99 }],
      reason: "Stripe Checkout expired before payment completed."
    })
  ];

  for (const email of templates) {
    assert.ok(email.text.trim().length > 0);
    assert.match(email.subject, /GameDayGrabs/);
    assert.match(email.subject, /PR-20260617-CH8BO6/);
    assert.doesNotMatch(email.subject, /^[A-Z\s!]{18,}$/);
    const html = await captureStorefrontResendHtml(email);
    assertLightCustomerEmailHtml(html);
  }
});

test("missing Resend and SMTP config reports not_configured without throwing", async () => {
  const result = await sendEmailViaProvider(
    {
      to: "buyer@example.com",
      subject: "GameDayGrabs order update",
      text: "Order update"
    },
    { env: {} }
  );

  assert.equal(result.status, "not_configured");
  assert.equal(result.provider, "none");
  assert.match(result.detail, /RESEND_API_KEY and EMAIL_FROM/);
});

test("Resend failure is sanitized and does not leak provider response details", async () => {
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ message: "provider secret detail" }), { status: 500 });
  const result = await sendEmailViaProvider(
    {
      to: "buyer@example.com",
      subject: "GameDayGrabs order update",
      text: "Order update"
    },
    { env: resendEnv, fetchImpl }
  );

  assert.equal(result.status, "failed");
  assert.equal(result.provider, "resend");
  assert.equal(result.failureReason, "Resend send failed.");
  assert.doesNotMatch(JSON.stringify(result), /provider secret detail|test_resend_api_key/);
});

test("email provider configuration prefers Resend and keeps SMTP as fallback", () => {
  const resend = emailProviderConfig({ ...resendEnv, SMTP_HOST: "smtp.example.com", SMTP_FROM: "smtp@example.com" });
  const smtp = emailProviderConfig({ SMTP_HOST: "smtp.example.com", SMTP_FROM: "smtp@example.com" });
  const partial = emailProviderConfig({ RESEND_API_KEY: "test_resend_api_key" });

  assert.equal(resend.provider, "resend");
  assert.equal(resend.configured, true);
  assert.equal(resend.smtpConfigured, true);
  assert.equal(smtp.provider, "smtp");
  assert.equal(smtp.configured, true);
  assert.equal(partial.provider, "none");
  assert.equal(partial.partiallyConfigured, true);
});

test("email template keeps customer copy mobile-readable without raw payment data", () => {
  const html = renderEmailHtml(
    "GameDayGrabs order confirmed: PR-TEST",
    "Thanks for your order.\n\nOrder: PR-TEST\nTotal paid: $65.99"
  );

  assert.match(html, /GameDayGrabs/);
  assert.match(html, /Thanks for your order/);
  assert.match(html, /<meta name="color-scheme" content="light" \/>/);
  assert.match(html, /bgcolor="#FFF7EB"/);
  assert.match(html, /background-color:#FFF7EB/);
  assert.match(html, /background-image:linear-gradient\(#FFF7EB,#FFF7EB\)/);
  assert.match(html, /bgcolor="#FFFFFF"/);
  assert.match(html, /background-color:#FFFFFF/);
  assert.match(html, /background-image:linear-gradient\(#FFFFFF,#FFFFFF\)/);
  assert.match(html, /border:1px solid #D0D5DD/);
  assert.match(html, /-webkit-text-fill-color:#101828/);
  assert.match(html, /-webkit-text-fill-color:#475467/);
  assert.match(html, /color:#101828/);
  assert.match(html, /#FF6A00/);
  assert.doesNotMatch(html, /background(?!-color)\s*:/i);
  assert.doesNotMatch(html, darkTemplatePattern);
  assert.doesNotMatch(html, whiteTextPattern);
  assert.doesNotMatch(html, paleTextPattern);
  assert.doesNotMatch(html, /payment_method_details|payment_method_data|card_number|cardNumber|CVC|cvc|cvv|raw Stripe/i);
});
