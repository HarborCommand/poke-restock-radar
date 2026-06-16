export type EmailProviderStatus = "sent" | "not_configured" | "failed";
export type EmailProviderKind = "resend" | "smtp" | "none";

type EmailProviderEnv = Record<string, string | undefined>;

export type EmailProviderConfig = {
  configured: boolean;
  provider: EmailProviderKind;
  resendConfigured: boolean;
  resendApiKeyConfigured: boolean;
  emailFromConfigured: boolean;
  emailReplyToConfigured: boolean;
  smtpConfigured: boolean;
  smtpHostConfigured: boolean;
  smtpFromConfigured: boolean;
  partiallyConfigured: boolean;
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult = {
  status: EmailProviderStatus;
  provider: EmailProviderKind;
  sentAt: Date | null;
  detail: string;
  failureReason: string | null;
};

type EmailSendOptions = {
  env?: EmailProviderEnv;
  fetchImpl?: typeof fetch;
  idempotencyKey?: string;
};

const resendEndpoint = "https://api.resend.com/emails";

function envValue(env: EmailProviderEnv, name: string) {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

export function emailProviderConfig(env: EmailProviderEnv = process.env): EmailProviderConfig {
  const resendApiKeyConfigured = Boolean(envValue(env, "RESEND_API_KEY"));
  const emailFromConfigured = Boolean(envValue(env, "EMAIL_FROM"));
  const emailReplyToConfigured = Boolean(envValue(env, "EMAIL_REPLY_TO"));
  const smtpHostConfigured = Boolean(envValue(env, "SMTP_HOST"));
  const smtpFromConfigured = Boolean(envValue(env, "SMTP_FROM"));
  const resendConfigured = resendApiKeyConfigured && emailFromConfigured;
  const smtpConfigured = smtpHostConfigured && smtpFromConfigured;
  const hasAnyEmailEnv =
    resendApiKeyConfigured ||
    emailFromConfigured ||
    emailReplyToConfigured ||
    smtpHostConfigured ||
    smtpFromConfigured ||
    Boolean(envValue(env, "SMTP_PORT")) ||
    Boolean(envValue(env, "SMTP_SECURE")) ||
    Boolean(envValue(env, "SMTP_USER")) ||
    Boolean(envValue(env, "SMTP_PASS"));

  return {
    configured: resendConfigured || smtpConfigured,
    provider: resendConfigured ? "resend" : smtpConfigured ? "smtp" : "none",
    resendConfigured,
    resendApiKeyConfigured,
    emailFromConfigured,
    emailReplyToConfigured,
    smtpConfigured,
    smtpHostConfigured,
    smtpFromConfigured,
    partiallyConfigured: hasAnyEmailEnv && !resendConfigured && !smtpConfigured
  };
}

export function emailProviderConfigured(env: EmailProviderEnv = process.env) {
  return emailProviderConfig(env).configured;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderEmailHtml(subject: string, text: string) {
  const sections = text
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean)
    .map((section) => `<p>${section.split(/\n/).map(escapeHtml).join("<br />")}</p>`)
    .join("");

  return [
    '<div style="margin:0;background:#F5F7FA;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111111;">',
    '<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #E6EAF0;border-radius:18px;overflow:hidden;">',
    '<div style="padding:20px 24px;background:#ffffff;border-bottom:1px solid #E6EAF0;">',
    '<strong style="font-size:18px;color:#111111;">GameDay<span style="color:#FF6A00;">Grabs</span></strong>',
    '<div style="margin-top:3px;color:#5F6B7A;font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;">Collect. Play. Invest.</div>',
    "</div>",
    '<div style="padding:22px;">',
    `<h1 style="margin:0 0 14px;color:#111111;font-size:22px;line-height:1.25;">${escapeHtml(subject)}</h1>`,
    `<div style="font-size:15px;line-height:1.55;color:#111111;">${sections}</div>`,
    '<p style="margin-top:22px;color:#5F6B7A;font-size:13px;">Payment is securely processed through Stripe.</p>',
    "</div>",
    "</div>",
    "</div>"
  ].join("");
}

export function sanitizedEmailFailure(provider: EmailProviderKind = "none") {
  if (provider === "resend") return "Resend send failed.";
  if (provider === "smtp") return "SMTP send failed.";
  return "Email provider send failed.";
}

async function sendWithResend(message: EmailMessage, env: EmailProviderEnv, fetchImpl: typeof fetch, idempotencyKey?: string) {
  const apiKey = envValue(env, "RESEND_API_KEY");
  const from = envValue(env, "EMAIL_FROM");
  const replyTo = envValue(env, "EMAIL_REPLY_TO");
  if (!apiKey || !from) return false;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey.slice(0, 256);

  const response = await fetchImpl(resendEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html ?? renderEmailHtml(message.subject, message.text),
      reply_to: replyTo || undefined
    })
  });
  if (!response.ok) throw new Error(`Resend send failed with status ${response.status}.`);
  return true;
}

async function sendWithSmtp(message: EmailMessage, env: EmailProviderEnv) {
  const host = envValue(env, "SMTP_HOST");
  const from = envValue(env, "SMTP_FROM");
  if (!host || !from) return false;
  const { createTransport } = await import("nodemailer");
  const transporter = createTransport({
    host,
    port: Number(envValue(env, "SMTP_PORT") || 587),
    secure: envValue(env, "SMTP_SECURE") === "true",
    auth: envValue(env, "SMTP_USER")
      ? {
          user: envValue(env, "SMTP_USER") || "",
          pass: envValue(env, "SMTP_PASS") || ""
        }
      : undefined
  });
  await transporter.sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html ?? renderEmailHtml(message.subject, message.text)
  });
  return true;
}

export async function sendEmailViaProvider(message: EmailMessage, options: EmailSendOptions = {}): Promise<EmailSendResult> {
  const env = options.env ?? process.env;
  const config = emailProviderConfig(env);
  if (!config.configured) {
    return {
      status: "not_configured",
      provider: "none",
      sentAt: null,
      detail: "Email provider is not configured. Set RESEND_API_KEY and EMAIL_FROM, or configure SMTP fallback.",
      failureReason: null
    };
  }

  try {
    const sent =
      config.provider === "resend"
        ? await sendWithResend(message, env, options.fetchImpl ?? fetch, options.idempotencyKey)
        : await sendWithSmtp(message, env);
    if (!sent) {
      return {
        status: "not_configured",
        provider: config.provider,
        sentAt: null,
        detail: "Email provider is not configured.",
        failureReason: null
      };
    }
    return {
      status: "sent",
      provider: config.provider,
      sentAt: new Date(),
      detail: config.provider === "resend" ? "Email sent to customer with Resend." : "Email sent to customer with SMTP.",
      failureReason: null
    };
  } catch {
    return {
      status: "failed",
      provider: config.provider,
      sentAt: null,
      detail: "Email delivery failed without blocking the workflow.",
      failureReason: sanitizedEmailFailure(config.provider)
    };
  }
}
