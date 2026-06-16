import assert from "node:assert/strict";
import test from "node:test";
import { emailProviderConfig, renderEmailHtml, sendEmailViaProvider } from "../src/lib/email-provider";

const resendEnv = {
  RESEND_API_KEY: "test_resend_api_key",
  EMAIL_FROM: "GameDayGrabs Orders <orders@example.com>",
  EMAIL_REPLY_TO: "support@example.com"
};

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
      text: "Thanks for your order.\n\nOrder: PR-TEST"
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
  assert.match(String(body.html), /GameDayGrabs/);
  assert.doesNotMatch(JSON.stringify(result), /test_resend_api_key|orders@example\.com|support@example\.com/);
  assert.doesNotMatch(JSON.stringify(body), /test_resend_api_key/);
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
  assert.doesNotMatch(html, /payment_method_details|payment_method_data|card_number|cardNumber|CVC|cvc|cvv|raw Stripe/i);
});
