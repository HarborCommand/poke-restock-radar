export type StorefrontEmailItem = {
  name: string;
  quantity: number;
  lineTotal: number;
  imageUrl?: string | null;
};

export type StorefrontEmailAddress = {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

type StorefrontEmailBase = {
  orderNumber: string;
  supportEmail: string;
  logoUrl?: string | null;
  storeName?: string | null;
};

export type StorefrontRenderedEmail = {
  subject: string;
  text: string;
  html: string;
};

export const STOREFRONT_CUSTOMER_EMAIL_TEMPLATE_MARKER = "GDD_EMAIL_TEMPLATE=light-v3";
const STOREFRONT_ORDER_STATUS_URL = "https://www.gamedaygrabs.com/order-status";
const STOREFRONT_POLICIES_URL = "https://www.gamedaygrabs.com/policies";

export type OrderConfirmationEmailInput = StorefrontEmailBase & {
  items: StorefrontEmailItem[];
  subtotal: number;
  shippingCharged: number;
  totalPaid: number;
  shippingMethod: string | null;
  isLocalPickup?: boolean;
  pickupStatus?: string | null;
};

export type ShippingConfirmationEmailInput = StorefrontEmailBase & {
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl?: string | null;
  shippingAddress: StorefrontEmailAddress | null;
};

export type RefundCancellationEmailInput = StorefrontEmailBase & {
  statusLabel: string;
  refundAmount: number;
  reasonLabel?: string | null;
};

export type LocalPickupEmailInput = StorefrontEmailBase & {
  pickupLocationLines: string[];
  pickupNotes: string[];
};

export type CheckoutExpiredEmailInput = StorefrontEmailBase & {
  items: StorefrontEmailItem[];
  reason: string;
};

const emailColors = {
  background: "#FFF7EB",
  card: "#FFFFFF",
  text: "#101828",
  muted: "#475467",
  label: "#667085",
  border: "#D0D5DD",
  accent: "#FF6A00",
  gold: "#FFB800",
  softAccent: "#FFF3E2",
  green: "#087443"
};

function lightBackgroundStyle(color: string) {
  return `background-color:${color} !important;background-image:linear-gradient(${color},${color}) !important;`;
}

function textColorStyle(color: string) {
  return `color:${color} !important;-webkit-text-fill-color:${color} !important;`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function compactLines(lines: Array<string | null | undefined>) {
  return lines.map((line) => line?.trim()).filter((line): line is string => Boolean(line));
}

function addressLines(address: StorefrontEmailAddress | null | undefined) {
  if (!address) return [];
  return compactLines([
    address.name,
    address.line1,
    address.line2,
    [address.city, address.state, address.postalCode].filter(Boolean).join(", "),
    address.country
  ]);
}

function paragraph(text: string, style = "") {
  return `<p style="margin:0;${style}">${escapeHtml(text)}</p>`;
}

function withLineBreaks(text: string) {
  return text
    .split(/\r?\n/)
    .map(escapeHtml)
    .join("<br />");
}

function label(text: string) {
  return `<p class="gdg-email-muted" style="margin:0 0 5px;${textColorStyle(emailColors.label)}font-size:11px;line-height:1.35;text-transform:uppercase;letter-spacing:.08em;font-weight:800;">${escapeHtml(text)}</p>`;
}

function orderNumberBlock(orderNumber: string) {
  return [
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${emailColors.card}" class="gdg-email-panel" style="border:1px solid ${emailColors.border};border-radius:14px;border-collapse:separate;margin:20px 0;${lightBackgroundStyle(emailColors.card)}">`,
    "<tr>",
    `<td align="center" bgcolor="${emailColors.card}" class="gdg-email-panel-cell" style="padding:15px 18px;${lightBackgroundStyle(emailColors.card)}">`,
    label("Order number"),
    `<p class="gdg-email-accent" style="margin:0;${textColorStyle(emailColors.accent)}font-size:18px;line-height:1.3;font-weight:800;letter-spacing:.01em;">${escapeHtml(orderNumber)}</p>`,
    "</td>",
    "</tr>",
    "</table>"
  ].join("");
}

function card(content: string, extraStyle = "", backgroundColor = emailColors.card) {
  const className = backgroundColor === emailColors.softAccent ? "gdg-email-panel gdg-email-soft-panel" : "gdg-email-panel";
  return [
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${backgroundColor}" class="${className}" style="border:1px solid ${emailColors.border};border-radius:14px;border-collapse:separate;margin:14px 0;${lightBackgroundStyle(backgroundColor)}${textColorStyle(emailColors.text)}${extraStyle}">`,
    "<tr>",
    `<td bgcolor="${backgroundColor}" class="gdg-email-panel-cell" style="padding:18px;${lightBackgroundStyle(backgroundColor)}${textColorStyle(emailColors.text)}">`,
    content,
    "</td>",
    "</tr>",
    "</table>"
  ].join("");
}

function noteCard(title: string, body: string) {
  return card(
    [
      `<p style="margin:0 0 7px;${textColorStyle(emailColors.text)}font-size:14px;line-height:1.4;font-weight:900;">${escapeHtml(title)}</p>`,
      `<p style="margin:0;${textColorStyle(emailColors.text)}font-size:14px;line-height:1.58;font-weight:650;">${escapeHtml(body)}</p>`
    ].join(""),
    `border-color:#D98F45;`,
    emailColors.softAccent
  );
}

function summaryRow(labelText: string, value: string, isStrong = false) {
  return [
    "<tr>",
    `<td class="${isStrong ? "" : "gdg-email-muted"}" style="padding:5px 0;${textColorStyle(isStrong ? emailColors.text : emailColors.muted)}font-size:${isStrong ? "15px" : "13px"};line-height:1.4;font-weight:${isStrong ? "900" : "700"};">${escapeHtml(labelText)}</td>`,
    `<td align="right" class="${isStrong ? "gdg-email-accent" : ""}" style="padding:5px 0;${textColorStyle(isStrong ? emailColors.accent : emailColors.text)}font-size:${isStrong ? "15px" : "13px"};line-height:1.4;font-weight:${isStrong ? "900" : "800"};">${escapeHtml(value)}</td>`,
    "</tr>"
  ].join("");
}

function productRows(items: StorefrontEmailItem[]) {
  const rows = items.length
    ? items
        .map((item) => {
          const image = item.imageUrl
            ? `<img src="${escapeHtml(item.imageUrl)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:10px;border:1px solid ${emailColors.border};object-fit:cover;" />`
            : `<div class="gdg-email-soft-panel gdg-email-accent" style="width:56px;height:56px;border-radius:10px;${lightBackgroundStyle(emailColors.softAccent)}border:1px solid ${emailColors.border};text-align:center;line-height:56px;${textColorStyle(emailColors.accent)}font-weight:800;font-size:13px;">GDG</div>`;
          return [
            "<tr>",
            `<td width="66" valign="top" style="padding:0 10px 12px 0;">${image}</td>`,
            '<td valign="top" style="padding:0 8px 12px 0;">',
            `<p style="margin:0;${textColorStyle(emailColors.text)}font-size:13px;line-height:1.35;font-weight:800;">${item.quantity} x ${escapeHtml(item.name)}</p>`,
            "</td>",
            `<td align="right" valign="top" style="padding:0 0 12px 8px;${textColorStyle(emailColors.text)}font-size:13px;line-height:1.35;font-weight:800;white-space:nowrap;">${formatMoney(item.lineTotal)}</td>`,
            "</tr>"
          ].join("");
        })
        .join("")
    : `<tr><td class="gdg-email-muted" style="${textColorStyle(emailColors.muted)}font-size:13px;line-height:1.5;">No line items were stored for this order.</td></tr>`;

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>`;
}

function orderSummaryCard(input: {
  items: StorefrontEmailItem[];
  subtotal: number;
  shippingCharged: number;
  totalPaid: number;
  shippingMethod: string | null;
  isLocalPickup?: boolean;
}) {
  const shippingLabel = input.isLocalPickup ? "Shipping charged" : `Shipping${input.shippingMethod ? ` (${input.shippingMethod})` : ""}`;
  return card(
    [
      `<p style="margin:0 0 12px;${textColorStyle(emailColors.text)}font-size:12px;line-height:1.3;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Order summary</p>`,
      productRows(input.items),
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid ${emailColors.border};padding-top:10px;">`,
      summaryRow("Subtotal", formatMoney(input.subtotal)),
      summaryRow(shippingLabel, formatMoney(input.shippingCharged)),
      summaryRow("Total paid", formatMoney(input.totalPaid), true),
      "</table>"
    ].join("")
  );
}

function twoColumnInfoCard(left: { title: string; body: string }, right: { title: string; body: string }) {
  return card(
    [
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">',
      "<tr>",
      `<td valign="top" width="50%" style="padding-right:14px;border-right:1px solid ${emailColors.border};">`,
      label(left.title),
      `<p style="margin:0;${textColorStyle(emailColors.text)}font-size:13px;line-height:1.45;font-weight:700;">${withLineBreaks(left.body)}</p>`,
      "</td>",
      '<td valign="top" width="50%" style="padding-left:14px;">',
      label(right.title),
      `<p style="margin:0;${textColorStyle(emailColors.text)}font-size:13px;line-height:1.45;font-weight:700;">${withLineBreaks(right.body)}</p>`,
      "</td>",
      "</tr>",
      "</table>"
    ].join("")
  );
}

function detailRows(rows: Array<{ label: string; value: string | null | undefined }>) {
  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">',
    rows
      .filter((row) => Boolean(row.value))
      .map((row) =>
        [
          "<tr>",
          `<td valign="top" width="42" style="padding:0 12px 16px 0;color:${emailColors.green};font-size:20px;line-height:1;">•</td>`,
          '<td valign="top" style="padding:0 0 16px 0;">',
          label(row.label),
          `<p style="margin:0;${textColorStyle(emailColors.text)}font-size:15px;line-height:1.48;font-weight:900;">${withLineBreaks(row.value || "")}</p>`,
          "</td>",
          "</tr>"
        ].join("")
      )
      .join(""),
    "</table>"
  ].join("");
}

function addressCard(title: string, lines: string[]) {
  return card(
    [
      label(title),
      lines.length
        ? lines.map((line) => `<p style="margin:0;${textColorStyle(emailColors.text)}font-size:13px;line-height:1.45;">${escapeHtml(line)}</p>`).join("")
        : paragraph("Not provided", `${textColorStyle(emailColors.muted)}font-size:13px;line-height:1.45;`)
    ].join("")
  );
}

function supportCard(supportEmail: string) {
  return card(
    [
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>',
      '<td width="48" valign="middle" style="font-size:26px;line-height:1;">&#9742;</td>',
      '<td valign="middle">',
      `<p style="margin:0 0 4px;${textColorStyle(emailColors.text)}font-size:13px;line-height:1.35;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">Questions?</p>`,
      `<p style="margin:0;${textColorStyle(emailColors.text)}font-size:13px;line-height:1.45;">Contact us anytime at <a class="gdg-email-accent" href="mailto:${escapeHtml(supportEmail)}" style="${textColorStyle(emailColors.accent)}font-weight:800;text-decoration:none;">${escapeHtml(supportEmail)}</a></p>`,
      `<p style="margin:8px 0 0;${textColorStyle(emailColors.text)}font-size:13px;line-height:1.45;">Check your order anytime at <a class="gdg-email-accent" href="${STOREFRONT_ORDER_STATUS_URL}" style="${textColorStyle(emailColors.accent)}font-weight:800;text-decoration:none;">Check order status</a>.</p>`,
      "</td>",
      "</tr></table>"
    ].join("")
  );
}

function footer(supportEmail: string) {
  return [
    `<p style="margin:22px 0 8px;text-align:center;${textColorStyle(emailColors.text)}font-size:12px;line-height:1.45;font-weight:800;">Thank you for supporting GameDayGrabs.</p>`,
    `<p class="gdg-email-muted" style="margin:0 0 8px;text-align:center;${textColorStyle(emailColors.muted)}font-size:11px;line-height:1.45;">Need help? <a class="gdg-email-accent" href="mailto:${escapeHtml(supportEmail)}" style="${textColorStyle(emailColors.accent)}text-decoration:none;font-weight:700;">${escapeHtml(supportEmail)}</a></p>`,
    `<p class="gdg-email-muted" style="margin:0 0 8px;text-align:center;${textColorStyle(emailColors.muted)}font-size:11px;line-height:1.45;"><a class="gdg-email-accent" href="${STOREFRONT_ORDER_STATUS_URL}" style="${textColorStyle(emailColors.accent)}text-decoration:none;font-weight:700;">Check order status</a> &nbsp;|&nbsp; <a class="gdg-email-accent" href="${STOREFRONT_POLICIES_URL}" style="${textColorStyle(emailColors.accent)}text-decoration:none;font-weight:700;">Store policies</a></p>`,
    `<p class="gdg-email-muted" style="margin:0;text-align:center;${textColorStyle(emailColors.muted)}font-size:10px;line-height:1.45;">GameDayGrabs is not affiliated with The Pokemon Company International. All trademarks are property of their respective owners.</p>`
  ].join("");
}

function headerLogo(logoUrl?: string | null) {
  if (logoUrl) {
    return `<img src="${escapeHtml(logoUrl)}" width="190" alt="GameDayGrabs" style="display:block;width:190px;max-width:190px;height:auto;border:0;" />`;
  }
  return [
    `<p style="margin:0;${textColorStyle(emailColors.text)}font-size:20px;line-height:1.1;font-weight:900;letter-spacing:.01em;">GameDay<span class="gdg-email-accent" style="${textColorStyle(emailColors.accent)}">Grabs</span></p>`,
    `<p class="gdg-email-muted" style="margin:3px 0 0;${textColorStyle(emailColors.muted)}font-size:9px;line-height:1.2;font-weight:900;letter-spacing:.18em;text-transform:uppercase;">Collect. Play. Invest.</p>`
  ].join("");
}

function renderLayout(input: {
  supportEmail: string;
  logoUrl?: string | null;
  title: string;
  subtitle: string;
  heroIcon?: string;
  bodyHtml: string;
}) {
  const heroIcon = input.heroIcon
    ? `<div class="gdg-email-soft-panel gdg-email-accent" style="margin:8px auto 14px;width:54px;height:54px;border-radius:27px;border:1px solid #FFD0A6;${lightBackgroundStyle(emailColors.softAccent)}${textColorStyle(emailColors.accent)}font-size:28px;line-height:54px;text-align:center;font-weight:900;">${escapeHtml(input.heroIcon)}</div>`
    : "";
  const emailCss = [
    ":root{color-scheme:light;supported-color-schemes:light;}",
    `body{${lightBackgroundStyle(emailColors.background)}${textColorStyle(emailColors.text)}}`,
    `.gdg-email-root,.gdg-email-shell{${lightBackgroundStyle(emailColors.background)}${textColorStyle(emailColors.text)}}`,
    `.gdg-email-card,.gdg-email-logo,.gdg-email-content,.gdg-email-panel,.gdg-email-panel-cell{${lightBackgroundStyle(emailColors.card)}${textColorStyle(emailColors.text)}}`,
    `.gdg-email-soft-panel,.gdg-email-soft-panel .gdg-email-panel-cell{${lightBackgroundStyle(emailColors.softAccent)}${textColorStyle(emailColors.text)}}`,
    `.gdg-email-muted{${textColorStyle(emailColors.muted)}}`,
    `.gdg-email-accent,.gdg-email-content a{${textColorStyle(emailColors.accent)}}`,
    `.gdg-email-title{${textColorStyle(emailColors.text)}}`,
    `[data-ogsc] body,[data-ogsb] body,[data-ogsc] .gdg-email-root,[data-ogsb] .gdg-email-root,[data-ogsc] .gdg-email-shell,[data-ogsb] .gdg-email-shell{${lightBackgroundStyle(emailColors.background)}${textColorStyle(emailColors.text)}}`,
    `[data-ogsc] .gdg-email-card,[data-ogsb] .gdg-email-card,[data-ogsc] .gdg-email-logo,[data-ogsb] .gdg-email-logo,[data-ogsc] .gdg-email-content,[data-ogsb] .gdg-email-content,[data-ogsc] .gdg-email-panel,[data-ogsb] .gdg-email-panel,[data-ogsc] .gdg-email-panel-cell,[data-ogsb] .gdg-email-panel-cell{${lightBackgroundStyle(emailColors.card)}${textColorStyle(emailColors.text)}}`,
    `[data-ogsc] .gdg-email-soft-panel,[data-ogsb] .gdg-email-soft-panel,[data-ogsc] .gdg-email-soft-panel .gdg-email-panel-cell,[data-ogsb] .gdg-email-soft-panel .gdg-email-panel-cell{${lightBackgroundStyle(emailColors.softAccent)}${textColorStyle(emailColors.text)}}`,
    `[data-ogsc] .gdg-email-muted,[data-ogsb] .gdg-email-muted{${textColorStyle(emailColors.muted)}}`,
    `[data-ogsc] .gdg-email-accent,[data-ogsb] .gdg-email-accent,[data-ogsc] .gdg-email-content a,[data-ogsb] .gdg-email-content a{${textColorStyle(emailColors.accent)}}`,
    `@media (prefers-color-scheme:dark){body,.gdg-email-root,.gdg-email-shell{${lightBackgroundStyle(emailColors.background)}${textColorStyle(emailColors.text)}}.gdg-email-card,.gdg-email-logo,.gdg-email-content,.gdg-email-panel,.gdg-email-panel-cell{${lightBackgroundStyle(emailColors.card)}${textColorStyle(emailColors.text)}}.gdg-email-soft-panel,.gdg-email-soft-panel .gdg-email-panel-cell{${lightBackgroundStyle(emailColors.softAccent)}${textColorStyle(emailColors.text)}}.gdg-email-muted{${textColorStyle(emailColors.muted)}}.gdg-email-accent,.gdg-email-content a{${textColorStyle(emailColors.accent)}}}`,
    "@media only screen and (max-width:620px){.gdg-email-shell{padding:12px!important}.gdg-email-card{border-radius:16px!important}.gdg-email-content{padding:22px 20px!important}.gdg-email-title{font-size:24px!important;line-height:1.22!important}.gdg-email-logo{padding:22px 20px 16px!important}.gdg-email-logo img{width:170px!important}.gdg-email-panel-cell{padding:16px!important}}"
  ].join("");
  return [
    '<!doctype html>',
    `<!-- ${STOREFRONT_CUSTOMER_EMAIL_TEMPLATE_MARKER} -->`,
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /><meta name="color-scheme" content="light" /><meta name="supported-color-schemes" content="light" /><meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<style>${emailCss}</style>`,
    "</head>",
    `<body bgcolor="${emailColors.background}" style="margin:0;padding:0;${lightBackgroundStyle(emailColors.background)}font-family:Arial,Helvetica,sans-serif;${textColorStyle(emailColors.text)}">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${emailColors.background}" class="gdg-email-root" style="${lightBackgroundStyle(emailColors.background)}border-collapse:collapse;">`,
    `<tr><td class="gdg-email-shell" align="center" bgcolor="${emailColors.background}" style="padding:28px 14px;${lightBackgroundStyle(emailColors.background)}${textColorStyle(emailColors.text)}">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${emailColors.card}" class="gdg-email-card" style="max-width:600px;${lightBackgroundStyle(emailColors.card)}${textColorStyle(emailColors.text)}border:1px solid ${emailColors.border};border-radius:22px;border-collapse:separate;overflow:hidden;box-shadow:0 18px 42px rgba(16,24,40,.10);">`,
    `<tr><td class="gdg-email-logo" bgcolor="${emailColors.card}" style="padding:24px 26px 18px;border-bottom:1px solid ${emailColors.border};${lightBackgroundStyle(emailColors.card)}${textColorStyle(emailColors.text)}">${headerLogo(input.logoUrl)}</td></tr>`,
    `<tr><td class="gdg-email-content" bgcolor="${emailColors.card}" style="padding:28px 26px 18px;${lightBackgroundStyle(emailColors.card)}${textColorStyle(emailColors.text)}">`,
    heroIcon,
    `<h1 class="gdg-email-title" style="margin:0 0 8px;text-align:center;${textColorStyle(emailColors.text)}font-size:28px;line-height:1.18;font-weight:900;">${escapeHtml(input.title)}</h1>`,
    `<p class="gdg-email-muted" style="margin:0 auto 8px;max-width:430px;text-align:center;${textColorStyle(emailColors.muted)}font-size:14px;line-height:1.55;font-weight:700;">${escapeHtml(input.subtitle)}</p>`,
    input.bodyHtml,
    supportCard(input.supportEmail),
    footer(input.supportEmail),
    "</td></tr>",
    "</table>",
    "</td></tr>",
    "</table>",
    "</body></html>"
  ].join("");
}

function textFooter(supportEmail: string) {
  return [
    "",
    `Questions? Contact ${supportEmail}.`,
    `Check order status: ${STOREFRONT_ORDER_STATUS_URL}`,
    `Store policies: ${STOREFRONT_POLICIES_URL}`,
    "",
    "Thank you for supporting GameDayGrabs.",
    "GameDayGrabs is not affiliated with The Pokemon Company International. All trademarks are property of their respective owners."
  ].join("\n");
}

function isLocalPickupMethod(input: Pick<OrderConfirmationEmailInput, "isLocalPickup" | "shippingMethod">) {
  return Boolean(input.isLocalPickup || String(input.shippingMethod || "").trim().toLowerCase() === "local pickup");
}

function pickupStatusLabel(status: string | null | undefined) {
  if (status === "pickup_ready") return "Ready for pickup";
  if (status === "picked_up") return "Picked up";
  return "Pickup pending";
}

export function buildOrderConfirmationEmail(input: OrderConfirmationEmailInput): StorefrontRenderedEmail {
  const shippingMethod = input.shippingMethod || "Not captured";
  const isLocalPickup = isLocalPickupMethod(input);
  const methodLabel = isLocalPickup ? "Fulfillment method" : "Shipping method";
  const nextStepCopy = isLocalPickup ? "We'll send pickup instructions when your order is ready." : "We'll send tracking once your order ships.";
  const methodBody = isLocalPickup ? `${shippingMethod}\nPickup status: ${pickupStatusLabel(input.pickupStatus)}\n${nextStepCopy}` : `${shippingMethod}\n${nextStepCopy}`;
  const subject = `GameDayGrabs order confirmed: ${input.orderNumber}`;
  const text = [
    "Thanks for your order!",
    "",
    "We've received your payment and we're getting it ready for you.",
    `Order number: ${input.orderNumber}`,
    "",
    "Order summary:",
    ...(input.items.length ? input.items.map((item) => `${item.quantity} x ${item.name} - ${formatMoney(item.lineTotal)}`) : ["No line items were stored for this order."]),
    `Subtotal: ${formatMoney(input.subtotal)}`,
    isLocalPickup ? `Shipping charged: ${formatMoney(input.shippingCharged)}` : `Shipping (${shippingMethod}): ${formatMoney(input.shippingCharged)}`,
    `Total paid: ${formatMoney(input.totalPaid)}`,
    "",
    `${methodLabel}: ${shippingMethod}`,
    isLocalPickup ? `Pickup status: ${pickupStatusLabel(input.pickupStatus)}` : null,
    "Payment method: Securely processed by Stripe",
    nextStepCopy,
    textFooter(input.supportEmail)
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const html = renderLayout({
    supportEmail: input.supportEmail,
    logoUrl: input.logoUrl,
    title: "Thanks for your order! 🎉",
    subtitle: "We've received your payment and we're getting it ready for you.",
    bodyHtml: [
      orderNumberBlock(input.orderNumber),
      orderSummaryCard({ ...input, isLocalPickup }),
      twoColumnInfoCard(
        { title: methodLabel, body: methodBody },
        { title: "Payment method", body: "Securely processed by Stripe" }
      )
    ].join("")
  });
  return { subject, text, html };
}

export function buildShippingConfirmationEmail(input: ShippingConfirmationEmailInput): StorefrontRenderedEmail {
  const carrier = input.carrier || "Not provided";
  const trackingNumber = input.trackingNumber || "Not provided";
  const subject = `Your GameDayGrabs order has shipped: ${input.orderNumber}`;
  const shippingLines = addressLines(input.shippingAddress);
  const text = [
    "Your order is on the way!",
    "",
    "Great news - your order has shipped.",
    `Order number: ${input.orderNumber}`,
    `Carrier: ${carrier}`,
    `Tracking number: ${trackingNumber}`,
    input.trackingUrl ? `Tracking link: ${input.trackingUrl}` : null,
    "",
    "Shipping to:",
    ...(shippingLines.length ? shippingLines : ["Not provided"]),
    "",
    "Tracking updates may take up to 24 hours to appear.",
    textFooter(input.supportEmail)
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const trackingButton = input.trackingUrl
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;"><tr><td align="center"><a href="${escapeHtml(input.trackingUrl)}" class="gdg-email-accent" style="display:block;${lightBackgroundStyle(emailColors.softAccent)}${textColorStyle(emailColors.accent)}text-decoration:none;font-size:14px;line-height:1.3;font-weight:900;border-radius:10px;padding:14px 20px;">Track Your Package</a></td></tr></table>`
    : "";
  const html = renderLayout({
    supportEmail: input.supportEmail,
    logoUrl: input.logoUrl,
    title: "Your order is on the way! 🚚",
    subtitle: "Great news - your order has shipped.",
    bodyHtml: [
      orderNumberBlock(input.orderNumber),
      card([detailRows([{ label: "Carrier", value: carrier }, { label: "Tracking number", value: trackingNumber }]), trackingButton].join("")),
      addressCard("Shipping to", shippingLines),
      noteCard("Tracking update", "Tracking updates may take up to 24 hours to appear.")
    ].join("")
  });
  return { subject, text, html };
}

export function buildRefundCancellationEmail(input: RefundCancellationEmailInput): StorefrontRenderedEmail {
  const refundLabel = input.refundAmount > 0 ? formatMoney(input.refundAmount) : "No refund required";
  const subject = `GameDayGrabs order update: ${input.orderNumber}`;
  const text = [
    "Order update",
    "",
    "We've updated your order.",
    `Order number: ${input.orderNumber}`,
    `Status: ${input.statusLabel}`,
    `Refund amount: ${refundLabel}`,
    input.reasonLabel ? `Reason: ${input.reasonLabel}` : null,
    "",
    "Refunds typically appear in your account within 3-10 business days depending on your bank or card issuer.",
    textFooter(input.supportEmail)
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  const html = renderLayout({
    supportEmail: input.supportEmail,
    logoUrl: input.logoUrl,
    heroIcon: "↺",
    title: "Order update",
    subtitle: "We've updated your order.",
    bodyHtml: [
      orderNumberBlock(input.orderNumber),
      card(detailRows([{ label: "Status", value: input.statusLabel }, { label: "Refund amount", value: refundLabel }, { label: "Reason", value: input.reasonLabel }])),
      noteCard("Refund timing", "Refunds typically appear in your account within 3-10 business days depending on your bank or card issuer.")
    ].join("")
  });
  return { subject, text, html };
}

export function buildLocalPickupEmail(input: LocalPickupEmailInput): StorefrontRenderedEmail {
  const subject = `GameDayGrabs pickup instructions: ${input.orderNumber}`;
  const locationLines = input.pickupLocationLines.length ? input.pickupLocationLines : ["GameDayGrabs", "Pickup details will be confirmed by support."];
  const pickupNotes = input.pickupNotes.length
    ? input.pickupNotes
    : ["Please bring a valid ID.", "We'll confirm your order details when you arrive."];
  const text = [
    "Pickup ready!",
    "",
    "Your order is ready for pickup.",
    `Order number: ${input.orderNumber}`,
    "",
    "Pickup location:",
    ...locationLines,
    "",
    "Pickup notes:",
    ...pickupNotes,
    textFooter(input.supportEmail)
  ].join("\n");
  const html = renderLayout({
    supportEmail: input.supportEmail,
    logoUrl: input.logoUrl,
    heroIcon: "●",
    title: "Pickup ready!",
    subtitle: "Your order is ready for pickup.",
    bodyHtml: [
      orderNumberBlock(input.orderNumber),
      addressCard("Pickup location", locationLines),
      card(detailRows([{ label: "Pickup notes", value: pickupNotes.join("\n") }]))
    ].join("")
  });
  return { subject, text, html };
}

export function buildCheckoutExpiredEmail(input: CheckoutExpiredEmailInput): StorefrontRenderedEmail {
  const subject = `GameDayGrabs checkout ${input.orderNumber} expired`;
  const text = [
    "Your GameDayGrabs checkout expired.",
    "",
    `Order number: ${input.orderNumber}`,
    "No payment was collected for this checkout.",
    input.reason,
    "",
    "Items:",
    ...(input.items.length ? input.items.map((item) => `${item.quantity} x ${item.name} - ${formatMoney(item.lineTotal)}`) : ["No line items were stored for this order."]),
    "",
    "If you still want these items, start checkout again while inventory is available.",
    textFooter(input.supportEmail)
  ].join("\n");
  const html = renderLayout({
    supportEmail: input.supportEmail,
    logoUrl: input.logoUrl,
    heroIcon: "!",
    title: "Checkout expired",
    subtitle: "No payment was collected for this checkout.",
    bodyHtml: [
      orderNumberBlock(input.orderNumber),
      orderSummaryCard({
        items: input.items,
        subtotal: input.items.reduce((sum, item) => sum + item.lineTotal, 0),
        shippingCharged: 0,
        totalPaid: 0,
        shippingMethod: "Not paid"
      }),
      noteCard("What happened?", input.reason),
      noteCard("Want to order?", "If you still want these items, start checkout again while inventory is available.")
    ].join("")
  });
  return { subject, text, html };
}
