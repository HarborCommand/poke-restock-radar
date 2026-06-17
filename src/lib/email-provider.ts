export type EmailProviderStatus = "sent" | "not_configured" | "failed";
export type EmailProviderKind = "resend" | "smtp" | "none";

export type EmailProviderEnv = Record<string, string | undefined>;

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

export type EmailSendOptions = {
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

function fallbackLightBackgroundStyle(color: string) {
  return `background-color:${color}!important;background-image:linear-gradient(${color},${color})!important;`;
}

function fallbackTextColorStyle(color: string) {
  return `color:${color}!important;-webkit-text-fill-color:${color}!important;`;
}

export function renderEmailHtml(subject: string, text: string) {
  const sections = text
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean)
    .map((section) => `<p>${section.split(/\n/).map(escapeHtml).join("<br />")}</p>`)
    .join("");

  return [
    '<!doctype html>',
    `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /><meta name="color-scheme" content="light" /><meta name="supported-color-schemes" content="light" /><style>:root{color-scheme:light;supported-color-schemes:light;}body,.gdg-email-root{${fallbackLightBackgroundStyle("#F5F7FA")}${fallbackTextColorStyle("#111111")}}.gdg-email-card,.gdg-email-content,.gdg-email-panel{${fallbackLightBackgroundStyle("#FFFFFF")}${fallbackTextColorStyle("#111111")}}.gdg-email-muted{${fallbackTextColorStyle("#5F6B7A")}}.gdg-email-accent,.gdg-email-content a{${fallbackTextColorStyle("#FF6A00")}}[data-ogsc] body,[data-ogsb] body,[data-ogsc] .gdg-email-root,[data-ogsb] .gdg-email-root{${fallbackLightBackgroundStyle("#F5F7FA")}${fallbackTextColorStyle("#111111")}}[data-ogsc] .gdg-email-card,[data-ogsb] .gdg-email-card,[data-ogsc] .gdg-email-content,[data-ogsb] .gdg-email-content,[data-ogsc] .gdg-email-panel,[data-ogsb] .gdg-email-panel{${fallbackLightBackgroundStyle("#FFFFFF")}${fallbackTextColorStyle("#111111")}}@media (prefers-color-scheme:dark){body,.gdg-email-root{${fallbackLightBackgroundStyle("#F5F7FA")}${fallbackTextColorStyle("#111111")}}.gdg-email-card,.gdg-email-content,.gdg-email-panel{${fallbackLightBackgroundStyle("#FFFFFF")}${fallbackTextColorStyle("#111111")}}}</style></head>`,
    `<body bgcolor="#F5F7FA" style="margin:0;padding:0;${fallbackLightBackgroundStyle("#F5F7FA")}font-family:Arial,Helvetica,sans-serif;${fallbackTextColorStyle("#111111")}">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#F5F7FA" class="gdg-email-root" style="${fallbackLightBackgroundStyle("#F5F7FA")}border-collapse:collapse;"><tr><td align="center" bgcolor="#F5F7FA" style="padding:24px;${fallbackLightBackgroundStyle("#F5F7FA")}">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#FFFFFF" class="gdg-email-card" style="max-width:640px;${fallbackLightBackgroundStyle("#FFFFFF")}border:1px solid #E6EAF0;border-radius:18px;border-collapse:separate;overflow:hidden;">`,
    `<tr><td bgcolor="#FFFFFF" class="gdg-email-panel" style="padding:20px 24px;${fallbackLightBackgroundStyle("#FFFFFF")}border-bottom:1px solid #E6EAF0;">`,
    `<strong style="font-size:18px;${fallbackTextColorStyle("#111111")}">GameDay<span class="gdg-email-accent" style="${fallbackTextColorStyle("#FF6A00")}">Grabs</span></strong>`,
    `<div class="gdg-email-muted" style="margin-top:3px;${fallbackTextColorStyle("#5F6B7A")}font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;">Collect. Play. Invest.</div>`,
    "</td></tr>",
    `<tr><td bgcolor="#FFFFFF" class="gdg-email-content" style="padding:22px;${fallbackLightBackgroundStyle("#FFFFFF")}${fallbackTextColorStyle("#111111")}">`,
    `<h1 style="margin:0 0 14px;${fallbackTextColorStyle("#111111")}font-size:22px;line-height:1.25;">${escapeHtml(subject)}</h1>`,
    `<div style="font-size:15px;line-height:1.55;${fallbackTextColorStyle("#111111")}">${sections}</div>`,
    `<p class="gdg-email-muted" style="margin-top:22px;${fallbackTextColorStyle("#5F6B7A")}font-size:13px;">Payment is securely processed through Stripe.</p>`,
    "</td></tr>",
    "</table>",
    "</td></tr></table>",
    "</body></html>"
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
