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

export type OrderConfirmationEmailInput = StorefrontEmailBase & {
  items: StorefrontEmailItem[];
  subtotal: number;
  shippingCharged: number;
  totalPaid: number;
  shippingMethod: string | null;
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
  background: "#F5F7FA",
  card: "#FFFFFF",
  text: "#111111",
  muted: "#5F6B7A",
  border: "#E6EAF0",
  accent: "#FF6A00",
  gold: "#FFB800",
  softAccent: "#FFF8F0",
  green: "#16713F"
};

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
  return `<p style="margin:0 0 4px;color:${emailColors.muted};font-size:11px;line-height:1.35;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">${escapeHtml(text)}</p>`;
}

function orderNumberBlock(orderNumber: string) {
  return [
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${emailColors.border};border-radius:14px;border-collapse:separate;margin:20px 0;background:${emailColors.card};">`,
    "<tr>",
    '<td align="center" style="padding:15px 18px;">',
    label("Order number"),
    `<p style="margin:0;color:${emailColors.accent};font-size:18px;line-height:1.3;font-weight:800;letter-spacing:.01em;">${escapeHtml(orderNumber)}</p>`,
    "</td>",
    "</tr>",
    "</table>"
  ].join("");
}

function card(content: string, extraStyle = "") {
  return [
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${emailColors.border};border-radius:14px;border-collapse:separate;margin:14px 0;background:${emailColors.card};${extraStyle}">`,
    "<tr>",
    '<td style="padding:18px;">',
    content,
    "</td>",
    "</tr>",
    "</table>"
  ].join("");
}

function noteCard(title: string, body: string) {
  return card(
    [
      `<p style="margin:0 0 5px;color:${emailColors.text};font-size:13px;line-height:1.4;font-weight:800;">${escapeHtml(title)}</p>`,
      `<p style="margin:0;color:${emailColors.text};font-size:13px;line-height:1.55;">${escapeHtml(body)}</p>`
    ].join(""),
    `background:${emailColors.softAccent};border-color:#F2D8BD;`
  );
}

function summaryRow(labelText: string, value: string, isStrong = false) {
  return [
    "<tr>",
    `<td style="padding:5px 0;color:${isStrong ? emailColors.text : emailColors.muted};font-size:${isStrong ? "15px" : "13px"};line-height:1.4;font-weight:${isStrong ? "800" : "500"};">${escapeHtml(labelText)}</td>`,
    `<td align="right" style="padding:5px 0;color:${isStrong ? emailColors.accent : emailColors.text};font-size:${isStrong ? "15px" : "13px"};line-height:1.4;font-weight:${isStrong ? "800" : "700"};">${escapeHtml(value)}</td>`,
    "</tr>"
  ].join("");
}

function productRows(items: StorefrontEmailItem[]) {
  const rows = items.length
    ? items
        .map((item) => {
          const image = item.imageUrl
            ? `<img src="${escapeHtml(item.imageUrl)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:10px;border:1px solid ${emailColors.border};object-fit:cover;" />`
            : `<div style="width:56px;height:56px;border-radius:10px;background:${emailColors.softAccent};border:1px solid ${emailColors.border};text-align:center;line-height:56px;color:${emailColors.accent};font-weight:800;font-size:13px;">GDG</div>`;
          return [
            "<tr>",
            `<td width="66" valign="top" style="padding:0 10px 12px 0;">${image}</td>`,
            '<td valign="top" style="padding:0 8px 12px 0;">',
            `<p style="margin:0;color:${emailColors.text};font-size:13px;line-height:1.35;font-weight:800;">${item.quantity} x ${escapeHtml(item.name)}</p>`,
            "</td>",
            `<td align="right" valign="top" style="padding:0 0 12px 8px;color:${emailColors.text};font-size:13px;line-height:1.35;font-weight:800;white-space:nowrap;">${formatMoney(item.lineTotal)}</td>`,
            "</tr>"
          ].join("");
        })
        .join("")
    : `<tr><td style="color:${emailColors.muted};font-size:13px;line-height:1.5;">No line items were stored for this order.</td></tr>`;

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>`;
}

function orderSummaryCard(input: {
  items: StorefrontEmailItem[];
  subtotal: number;
  shippingCharged: number;
  totalPaid: number;
  shippingMethod: string | null;
}) {
  return card(
    [
      `<p style="margin:0 0 12px;color:${emailColors.text};font-size:12px;line-height:1.3;font-weight:800;text-transform:uppercase;letter-spacing:.06em;">Order summary</p>`,
      productRows(input.items),
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid ${emailColors.border};padding-top:10px;">`,
      summaryRow("Subtotal", formatMoney(input.subtotal)),
      summaryRow(`Shipping${input.shippingMethod ? ` (${input.shippingMethod})` : ""}`, formatMoney(input.shippingCharged)),
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
      `<p style="margin:0;color:${emailColors.text};font-size:13px;line-height:1.45;font-weight:700;">${withLineBreaks(left.body)}</p>`,
      "</td>",
      '<td valign="top" width="50%" style="padding-left:14px;">',
      label(right.title),
      `<p style="margin:0;color:${emailColors.text};font-size:13px;line-height:1.45;font-weight:700;">${withLineBreaks(right.body)}</p>`,
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
          `<p style="margin:0;color:${emailColors.text};font-size:14px;line-height:1.45;font-weight:800;">${withLineBreaks(row.value || "")}</p>`,
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
        ? lines.map((line) => `<p style="margin:0;color:${emailColors.text};font-size:13px;line-height:1.45;">${escapeHtml(line)}</p>`).join("")
        : paragraph("Not provided", `color:${emailColors.muted};font-size:13px;line-height:1.45;`)
    ].join("")
  );
}

function supportCard(supportEmail: string) {
  return card(
    [
      '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>',
      '<td width="48" valign="middle" style="font-size:26px;line-height:1;">&#9742;</td>',
      '<td valign="middle">',
      `<p style="margin:0 0 4px;color:${emailColors.text};font-size:13px;line-height:1.35;font-weight:800;text-transform:uppercase;letter-spacing:.04em;">Questions?</p>`,
      `<p style="margin:0;color:${emailColors.text};font-size:13px;line-height:1.45;">Contact us anytime at <a href="mailto:${escapeHtml(supportEmail)}" style="color:${emailColors.accent};font-weight:800;text-decoration:none;">${escapeHtml(supportEmail)}</a></p>`,
      "</td>",
      "</tr></table>"
    ].join("")
  );
}

function footer(supportEmail: string) {
  return [
    `<p style="margin:22px 0 8px;text-align:center;color:${emailColors.text};font-size:12px;line-height:1.45;font-weight:800;">Thank you for supporting GameDayGrabs.</p>`,
    `<p style="margin:0 0 8px;text-align:center;color:${emailColors.muted};font-size:11px;line-height:1.45;">Need help? <a href="mailto:${escapeHtml(supportEmail)}" style="color:${emailColors.accent};text-decoration:none;font-weight:700;">${escapeHtml(supportEmail)}</a></p>`,
    `<p style="margin:0;text-align:center;color:${emailColors.muted};font-size:10px;line-height:1.45;">GameDayGrabs is not affiliated with The Pokemon Company International. All trademarks are property of their respective owners.</p>`
  ].join("");
}

function headerLogo(logoUrl?: string | null) {
  if (logoUrl) {
    return `<img src="${escapeHtml(logoUrl)}" width="190" alt="GameDayGrabs" style="display:block;width:190px;max-width:190px;height:auto;border:0;" />`;
  }
  return [
    `<p style="margin:0;color:${emailColors.text};font-size:20px;line-height:1.1;font-weight:900;letter-spacing:.01em;">GameDay<span style="color:${emailColors.accent};">Grabs</span></p>`,
    `<p style="margin:3px 0 0;color:${emailColors.muted};font-size:9px;line-height:1.2;font-weight:800;letter-spacing:.18em;text-transform:uppercase;">Collect. Play. Invest.</p>`
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
    ? `<div style="margin:10px auto 14px;width:54px;height:54px;border-radius:27px;background:${emailColors.softAccent};color:${emailColors.accent};font-size:28px;line-height:54px;text-align:center;">${escapeHtml(input.heroIcon)}</div>`
    : "";
  return [
    '<!doctype html>',
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<style>@media only screen and (max-width:620px){.gdg-email-shell{padding:16px!important}.gdg-email-card{border-radius:16px!important}.gdg-email-content{padding:22px!important}.gdg-email-title{font-size:24px!important}.gdg-email-logo img{width:170px!important}}</style>',
    "</head>",
    `<body style="margin:0;padding:0;background:${emailColors.background};font-family:Arial,Helvetica,sans-serif;color:${emailColors.text};">`,
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${emailColors.background};border-collapse:collapse;">`,
    '<tr><td class="gdg-email-shell" align="center" style="padding:28px 14px;">',
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" class="gdg-email-card" style="max-width:600px;background:${emailColors.card};border:1px solid ${emailColors.border};border-radius:22px;border-collapse:separate;overflow:hidden;box-shadow:0 18px 42px rgba(17,24,39,.08);">`,
    `<tr><td class="gdg-email-logo" style="padding:24px 26px 18px;border-bottom:1px solid ${emailColors.border};">${headerLogo(input.logoUrl)}</td></tr>`,
    '<tr><td class="gdg-email-content" style="padding:28px 26px 18px;">',
    heroIcon,
    `<h1 class="gdg-email-title" style="margin:0 0 8px;text-align:center;color:${emailColors.text};font-size:28px;line-height:1.18;font-weight:900;">${escapeHtml(input.title)}</h1>`,
    `<p style="margin:0 auto 8px;max-width:430px;text-align:center;color:${emailColors.muted};font-size:14px;line-height:1.55;">${escapeHtml(input.subtitle)}</p>`,
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
    "",
    "Thank you for supporting GameDayGrabs.",
    "GameDayGrabs is not affiliated with The Pokemon Company International. All trademarks are property of their respective owners."
  ].join("\n");
}

export function buildOrderConfirmationEmail(input: OrderConfirmationEmailInput): StorefrontRenderedEmail {
  const shippingMethod = input.shippingMethod || "Not captured";
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
    `Shipping (${shippingMethod}): ${formatMoney(input.shippingCharged)}`,
    `Total paid: ${formatMoney(input.totalPaid)}`,
    "",
    `Shipping method: ${shippingMethod}`,
    "Payment method: Securely processed by Stripe",
    "We'll send tracking once your order ships.",
    textFooter(input.supportEmail)
  ].join("\n");
  const html = renderLayout({
    supportEmail: input.supportEmail,
    logoUrl: input.logoUrl,
    title: "Thanks for your order! 🎉",
    subtitle: "We've received your payment and we're getting it ready for you.",
    bodyHtml: [
      orderNumberBlock(input.orderNumber),
      orderSummaryCard(input),
      twoColumnInfoCard(
        { title: "Shipping method", body: `${shippingMethod}\nWe'll send tracking once your order ships.` },
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
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;"><tr><td align="center"><a href="${escapeHtml(input.trackingUrl)}" style="display:block;background:${emailColors.accent};color:#ffffff;text-decoration:none;font-size:14px;line-height:1.3;font-weight:900;border-radius:10px;padding:14px 20px;">Track Your Package</a></td></tr></table>`
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
