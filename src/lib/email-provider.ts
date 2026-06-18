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

export type EmailProviderTag = {
  name: string;
  value: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
  tags?: EmailProviderTag[];
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

const allowedCustomerEmailHeaders = new Set(["X-Entity-Ref-ID", "X-GDD-Notification-Type", "X-GDD-Order-Number"]);

function cleanHeaderValue(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 240);
}

function sanitizedMessageHeaders(headers: EmailMessage["headers"]) {
  const safe: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (!allowedCustomerEmailHeaders.has(name) || typeof value !== "string") continue;
    const cleanValue = cleanHeaderValue(value);
    if (cleanValue) safe[name] = cleanValue;
  }
  return safe;
}

function sanitizedTagName(value: string) {
  const clean = value.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
  return clean || null;
}

function sanitizedMessageTags(tags: EmailMessage["tags"]) {
  return (tags ?? [])
    .map((tag) => {
      const name = sanitizedTagName(tag.name);
      const value = cleanHeaderValue(tag.value).slice(0, 256);
      return name && value ? { name, value } : null;
    })
    .filter((tag): tag is EmailProviderTag => Boolean(tag));
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
  const backgroundColor = "#FFF7EB";
  const cardColor = "#FFFFFF";
  const textColor = "#101828";
  const mutedColor = "#475467";
  const borderColor = "#D0D5DD";
  const accentColor = "#FF6A00";

  return [
    '<!doctype html>',
    `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /><meta name="color-scheme" content="light" /><meta name="supported-color-schemes" content="light" /><style>:root{color-scheme:light;supported-color-schemes:light;}body,.gdg-email-root{${fallbackLightBackgroundStyle(backgroundColor)}${fallbackTextColorStyle(textColor)}}.gdg-email-card,.gdg-email-content,.gdg-email-panel{${fallbackLightBackgroundStyle(cardColor)}${fallbackTextColorStyle(textColor)}}.gdg-email-muted{${fallbackTextColorStyle(mutedColor)}}.gdg-email-accent,.gdg-email-content a{${fallbackTextColorStyle(accentColor)}}[data-ogsc] body,[data-ogsb] body,[data-ogsc] .gdg-email-root,[data-ogsb] .gdg-email-root{${fallbackLightBackgroundStyle(backgroundColor)}${fallbackTextColorStyle(textColor)}}[data-ogsc] .gdg-email-card,[data-ogsb] .gdg-email-card,[data-ogsc] .gdg-email-content,[data-ogsb] .gdg-email-content,[data-ogsc] .gdg-email-panel,[data-ogsb] .gdg-email-panel{${fallbackLightBackgroundStyle(cardColor)}${fallbackTextColorStyle(textColor)}}@media (prefers-color-scheme:dark){body,.gdg-email-root{${fallbackLightBackgroundStyle(backgroundColor)}${fallbackTextColorStyle(textColor)}}.gdg-email-card,.gdg-email-content,.gdg-email-panel{${fallbackLightBackgroundStyle(cardColor)}${fallbackTextColorStyle(textColor)}}}</style></head>`,
    `<body bgcolor="${backgroundColor}" style="margin:0;padding:0;${fallbackLightBackgroundStyle(backgroundColor)}font-family:Arial,Helvetica,sans-serif;${fallbackTextColorStyle(textColor)}">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${backgroundColor}" class="gdg-email-root" style="${fallbackLightBackgroundStyle(backgroundColor)}border-collapse:collapse;"><tr><td align="center" bgcolor="${backgroundColor}" style="padding:24px;${fallbackLightBackgroundStyle(backgroundColor)}">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${cardColor}" class="gdg-email-card" style="max-width:640px;${fallbackLightBackgroundStyle(cardColor)}${fallbackTextColorStyle(textColor)}border:1px solid ${borderColor};border-radius:18px;border-collapse:separate;overflow:hidden;">`,
    `<tr><td bgcolor="${cardColor}" class="gdg-email-panel" style="padding:20px 24px;${fallbackLightBackgroundStyle(cardColor)}border-bottom:1px solid ${borderColor};">`,
    `<strong style="font-size:18px;${fallbackTextColorStyle(textColor)}">GameDay<span class="gdg-email-accent" style="${fallbackTextColorStyle(accentColor)}">Grabs</span></strong>`,
    `<div class="gdg-email-muted" style="margin-top:3px;${fallbackTextColorStyle(mutedColor)}font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:800;">Collect. Play. Invest.</div>`,
    "</td></tr>",
    `<tr><td bgcolor="${cardColor}" class="gdg-email-content" style="padding:22px;${fallbackLightBackgroundStyle(cardColor)}${fallbackTextColorStyle(textColor)}">`,
    `<h1 style="margin:0 0 14px;${fallbackTextColorStyle(textColor)}font-size:22px;line-height:1.25;">${escapeHtml(subject)}</h1>`,
    `<div style="font-size:15px;line-height:1.55;font-weight:650;${fallbackTextColorStyle(textColor)}">${sections}</div>`,
    `<p class="gdg-email-muted" style="margin-top:22px;${fallbackTextColorStyle(mutedColor)}font-size:13px;font-weight:700;">Payment is securely processed through Stripe.</p>`,
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
  const apiHeaders: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
  if (idempotencyKey) apiHeaders["Idempotency-Key"] = idempotencyKey.slice(0, 256);
  const emailHeaders = sanitizedMessageHeaders(message.headers);
  const tags = sanitizedMessageTags(message.tags);
  const body: Record<string, unknown> = {
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html ?? renderEmailHtml(message.subject, message.text),
    reply_to: replyTo || undefined
  };
  if (Object.keys(emailHeaders).length > 0) body.headers = emailHeaders;
  if (tags.length > 0) body.tags = tags;

  const response = await fetchImpl(resendEndpoint, {
    method: "POST",
    headers: apiHeaders,
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Resend send failed with status ${response.status}.`);
  return true;
}

async function sendWithSmtp(message: EmailMessage, env: EmailProviderEnv) {
  const host = envValue(env, "SMTP_HOST");
  const from = envValue(env, "SMTP_FROM");
  const replyTo = envValue(env, "EMAIL_REPLY_TO");
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
    html: message.html ?? renderEmailHtml(message.subject, message.text),
    replyTo: replyTo || undefined,
    headers: sanitizedMessageHeaders(message.headers)
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
