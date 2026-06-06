import { prisma } from "@/lib/db";
import { exactProductActionUrl } from "@/lib/product-identity";
import { browserNotificationPayload, notificationRouteForAlert, sendPushAlertToUser, sendTestBrowserPush } from "@/lib/push";
import type { Priority, SessionUser } from "@/types/radar";

type AlertPayload = {
  title: string;
  reason: string;
  priority: Priority;
  entityType: string;
  entityId?: string;
  productId?: string;
  actionUrl?: string;
  dedupeKey?: string;
  score?: number;
  explanation?: string;
};

type DeliveryResult = {
  inAppCreated: number;
  emailSent: number;
  emailSkipped: number;
  smsSent: number;
  smsSkipped: number;
  pushSent: number;
  pushSkipped: number;
  pushFailed: number;
};

async function recordDeliveryLog(input: {
  alertId?: string | null;
  userId?: string | null;
  productId?: string | null;
  channel: string;
  status: string;
  reason?: string | null;
  detail?: string | null;
  dedupeKey?: string | null;
  priority?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}) {
  await prisma.notificationDeliveryLog
    .create({
      data: {
        alertId: input.alertId ?? null,
        userId: input.userId ?? null,
        productId: input.productId ?? null,
        channel: input.channel,
        status: input.status,
        reason: input.reason ?? null,
        detail: input.detail ?? null,
        dedupeKey: input.dedupeKey ?? null,
        priority: input.priority ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null
      }
    })
    .catch(() => null);
}

async function recordAlertDelivery(
  payload: AlertPayload,
  input: {
    alertId?: string | null;
    userId?: string | null;
    channel: string;
    status: string;
    reason?: string | null;
    detail?: string | null;
    dedupeKey?: string | null;
  }
) {
  await recordDeliveryLog({
    alertId: input.alertId,
    userId: input.userId,
    productId: payload.productId ?? null,
    channel: input.channel,
    status: input.status,
    reason: input.reason,
    detail: input.detail,
    dedupeKey: input.dedupeKey,
    priority: payload.priority,
    entityType: payload.entityType,
    entityId: payload.entityId ?? null
  });
}

const priorityRank: Record<Priority, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2
};

export function notificationSummary(result: DeliveryResult) {
  return `in-app ${result.inAppCreated}, email sent ${result.emailSent}/skipped ${result.emailSkipped}, SMS sent ${result.smsSent}/skipped ${result.smsSkipped}, push sent ${result.pushSent}/skipped ${result.pushSkipped}/failed ${result.pushFailed}`;
}

async function settingsForAllUsers() {
  const users = await prisma.user.findMany({
    where: { disabledAt: null },
    include: { notificationSettings: true },
    orderBy: { createdAt: "asc" }
  });

  const output = [];
  for (const user of users) {
    const settings =
      user.notificationSettings ||
      (await prisma.notificationSettings.create({
        data: {
          userId: user.id,
          inApp: true,
          email: false,
          sms: false,
          browserPush: false,
          emailTo: user.email,
          minimumPriority: "LOW"
        }
      }));
    output.push({ user, settings });
  }

  return output;
}

function isPriorityAllowed(priority: Priority, minimumPriority: string) {
  return priorityRank[priority] >= priorityRank[(minimumPriority as Priority) || "LOW"];
}

function minutesFromTime(value: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function isInQuietHours(start: string | null, end: string | null, now = new Date()) {
  const startMinutes = minutesFromTime(start);
  const endMinutes = minutesFromTime(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  if (startMinutes < endMinutes) {
    return current >= startMinutes && current < endMinutes;
  }
  return current >= startMinutes || current < endMinutes;
}

function alertDedupeKey(payload: AlertPayload) {
  if (payload.dedupeKey) return payload.dedupeKey.toLowerCase();
  return `${payload.entityType}:${payload.entityId || payload.productId || "system"}:${payload.title}`.toLowerCase();
}

function alertScore(payload: AlertPayload, product?: { priority: string; stockStatus: string } | null) {
  if (payload.score !== undefined) return Math.max(0, Math.min(100, Math.round(payload.score)));
  let score = payload.priority === "HIGH" ? 70 : payload.priority === "MEDIUM" ? 45 : 25;
  if (["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE"].includes(product?.stockStatus || "")) score += 18;
  if (product?.priority === "HIGH") score += 10;
  if (payload.entityType === "PRODUCT") score += 6;
  if (payload.entityType === "CARD" && payload.priority === "HIGH") score += 8;
  return Math.max(0, Math.min(100, score));
}

function listMatches(list: string | null, value: string | null | undefined) {
  const terms = (list || "")
    .split(/[\n,]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!terms.length) return true;
  const normalized = (value || "").toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function explanationFor(input: {
  payload: AlertPayload;
  score: number;
  quiet: boolean;
  digest: boolean;
  cooldownMinutes: number;
  productName?: string | null;
  retailerName?: string | null;
}) {
  if (input.payload.explanation) return input.payload.explanation;
  const parts = [
    `Score ${input.score}/100 from ${input.payload.priority.toLowerCase()} priority`,
    input.productName ? `product ${input.productName}` : `${input.payload.entityType.toLowerCase()} alert`,
    input.retailerName ? `retailer ${input.retailerName}` : null,
    input.quiet ? "quiet hours were active" : null,
    input.digest ? "digest mode kept external channels quiet" : null,
    input.cooldownMinutes ? `${input.cooldownMinutes} minute cooldown checked` : "no cooldown"
  ].filter(Boolean);
  return `${parts.join("; ")}. Reason: ${input.payload.reason}`;
}

async function createSuppressedAlert(input: {
  userId: string;
  payload: AlertPayload;
  score: number;
  dedupeKey: string;
  explanation: string;
}) {
  await prisma.alert.create({
    data: {
      title: `Suppressed: ${input.payload.title}`,
      reason: input.explanation,
      priority: input.payload.priority,
      entityType: input.payload.entityType,
      entityId: input.payload.entityId,
      productId: input.payload.productId,
      actionUrl: input.payload.actionUrl,
      userId: input.userId,
      read: true,
      score: input.score,
      dedupeKey: input.dedupeKey,
      explanation: input.explanation,
      suppressedAt: new Date()
    }
  });
}

function smtpReady() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

async function sendEmail(to: string, subject: string, text: string) {
  if (!smtpReady()) return false;
  const { createTransport } = await import("nodemailer");
  const transporter = createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || ""
        }
      : undefined
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text
  });
  return true;
}

function twilioReady() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

async function sendSms(to: string, body: string) {
  if (!twilioReady()) return false;
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      From: process.env.TWILIO_FROM_NUMBER!,
      To: to,
      Body: body
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Twilio request failed: ${message.slice(0, 240)}`);
  }
  return true;
}

export async function deliverAlert(payload: AlertPayload): Promise<DeliveryResult> {
  const result: DeliveryResult = {
    inAppCreated: 0,
    emailSent: 0,
    emailSkipped: 0,
    smsSent: 0,
    smsSkipped: 0,
    pushSent: 0,
    pushSkipped: 0,
    pushFailed: 0
  };

  const product = payload.productId
    ? await prisma.product.findUnique({
        where: { id: payload.productId },
        select: {
          id: true,
          name: true,
          priority: true,
          stockStatus: true,
          lastAlertSentAt: true,
          retailer: { select: { name: true } }
        }
      })
    : null;
  const dedupeKey = alertDedupeKey(payload);
  const score = alertScore(payload, product);
  const recipients = await settingsForAllUsers();
  for (const { user, settings } of recipients) {
    const priorityAllowed = isPriorityAllowed(payload.priority, settings.minimumPriority);
    const quiet = isInQuietHours(settings.quietHoursStart, settings.quietHoursEnd);
    const highPriorityOverride = payload.priority === "HIGH" && settings.highPriorityOverride;
    const pushAllowed = user.role === "ADMIN" || user.canReceivePushAlerts;
    const digestMode = settings.alertDigestMode && payload.priority !== "HIGH";
    const cooldownMinutes = Math.max(0, settings.alertCooldownMinutes ?? 30);
    const explanation = explanationFor({
      payload,
      score,
      quiet,
      digest: digestMode,
      cooldownMinutes,
      productName: product?.name,
      retailerName: product?.retailer.name
    });

    if (settings.urgentOnlyMode && payload.priority !== "HIGH") {
      await createSuppressedAlert({
        userId: user.id,
        payload,
        score,
        dedupeKey,
        explanation: `${explanation} Urgent-only mode suppressed it.`
      });
      await recordAlertDelivery(payload, {
        userId: user.id,
        channel: "all",
        status: "skipped",
        reason: "urgent_only_mode",
        detail: "Urgent-only mode suppressed a non-high-priority alert.",
        dedupeKey
      });
      continue;
    }

    if (
      product &&
      (!listMatches(settings.watchedRetailers, product.retailer.name) || !listMatches(settings.watchedProducts, product.name))
    ) {
      await createSuppressedAlert({
        userId: user.id,
        payload,
        score,
        dedupeKey,
        explanation: `${explanation} Watch-only filters suppressed it.`
      });
      await recordAlertDelivery(payload, {
        userId: user.id,
        channel: "all",
        status: "skipped",
        reason: "watch_only_filter",
        detail: "Watch-only product or retailer filters suppressed this alert.",
        dedupeKey
      });
      continue;
    }

    if (!priorityAllowed || (quiet && !highPriorityOverride)) {
      if (settings.email) result.emailSkipped += 1;
      if (settings.sms) result.smsSkipped += 1;
      if (settings.browserPush) result.pushSkipped += 1;
      await createSuppressedAlert({ userId: user.id, payload, score, dedupeKey, explanation });
      await recordAlertDelivery(payload, {
        userId: user.id,
        channel: "all",
        status: "skipped",
        reason: !priorityAllowed ? "priority_filter" : "quiet_hours",
        detail: explanation,
        dedupeKey
      });
      continue;
    }

    if (cooldownMinutes > 0) {
      const duplicateSince = new Date(Date.now() - cooldownMinutes * 60 * 1000);
      const duplicate = await prisma.alert.findFirst({
        where: {
          userId: user.id,
          dedupeKey,
          timestamp: { gte: duplicateSince },
          suppressedAt: null,
          falsePositiveAt: null
        }
      });
      const productCooldown =
        product?.lastAlertSentAt && product.lastAlertSentAt.getTime() >= duplicateSince.getTime() && !highPriorityOverride;
      if (duplicate || productCooldown) {
        await createSuppressedAlert({
          userId: user.id,
          payload,
          score,
          dedupeKey,
          explanation: `${explanation} Duplicate/cooldown suppression applied.`
        });
        await recordAlertDelivery(payload, {
          userId: user.id,
          channel: "all",
          status: "skipped",
          reason: "duplicate_or_cooldown",
          detail: "Duplicate suppression or product cooldown prevented repeat delivery.",
          dedupeKey
        });
        continue;
      }
    }

    let inAppAlertId: string | null = null;
    if (settings.inApp) {
      const alert = await prisma.alert.create({
        data: {
          title: payload.title,
          reason: payload.reason,
          priority: payload.priority,
          entityType: payload.entityType,
          entityId: payload.entityId,
          productId: payload.productId,
          actionUrl: payload.actionUrl,
          userId: user.id,
          score,
          dedupeKey,
          explanation,
          cooldownUntil: cooldownMinutes ? new Date(Date.now() + cooldownMinutes * 60 * 1000) : null
        }
      });
      inAppAlertId = alert.id;
      result.inAppCreated += 1;
      await recordAlertDelivery(payload, {
        alertId: alert.id,
        userId: user.id,
        channel: "in_app",
        status: "created",
        reason: "alert_created",
        detail: "In-app alert created.",
        dedupeKey
      });
    }

    if (digestMode) {
      if (settings.email) result.emailSkipped += 1;
      if (settings.sms) result.smsSkipped += 1;
      if (settings.browserPush) result.pushSkipped += 1;
      await recordAlertDelivery(payload, {
        alertId: inAppAlertId,
        userId: user.id,
        channel: "all_external",
        status: "skipped",
        reason: "digest_mode",
        detail: "Digest mode skipped immediate email, SMS, and push delivery.",
        dedupeKey
      });
      continue;
    }

    if (settings.email && settings.emailTo) {
      if (await sendEmail(settings.emailTo, payload.title, `${payload.reason}\n\n${payload.actionUrl || ""}`)) {
        result.emailSent += 1;
        await recordAlertDelivery(payload, {
          alertId: inAppAlertId,
          userId: user.id,
          channel: "email",
          status: "sent",
          reason: "sent",
          detail: `Email sent to ${settings.emailTo}.`,
          dedupeKey
        });
      } else {
        result.emailSkipped += 1;
        await recordAlertDelivery(payload, {
          alertId: inAppAlertId,
          userId: user.id,
          channel: "email",
          status: "skipped",
          reason: "provider_not_configured",
          detail: "Email was enabled but SMTP was not configured.",
          dedupeKey
        });
      }
    } else if (settings.email) {
      result.emailSkipped += 1;
      await recordAlertDelivery(payload, {
        alertId: inAppAlertId,
        userId: user.id,
        channel: "email",
        status: "skipped",
        reason: "missing_destination",
        detail: "Email was enabled but no destination address was saved.",
        dedupeKey
      });
    }

    if (settings.sms && settings.phone) {
      if (await sendSms(settings.phone, `${payload.title}: ${payload.reason} ${payload.actionUrl || ""}`.slice(0, 1500))) {
        result.smsSent += 1;
        await recordAlertDelivery(payload, {
          alertId: inAppAlertId,
          userId: user.id,
          channel: "sms",
          status: "sent",
          reason: "sent",
          detail: `SMS sent to ${settings.phone}.`,
          dedupeKey
        });
      } else {
        result.smsSkipped += 1;
        await recordAlertDelivery(payload, {
          alertId: inAppAlertId,
          userId: user.id,
          channel: "sms",
          status: "skipped",
          reason: "provider_not_configured",
          detail: "SMS was enabled but Twilio was not configured.",
          dedupeKey
        });
      }
    } else if (settings.sms) {
      result.smsSkipped += 1;
      await recordAlertDelivery(payload, {
        alertId: inAppAlertId,
        userId: user.id,
        channel: "sms",
        status: "skipped",
        reason: "missing_destination",
        detail: "SMS was enabled but no phone number was saved.",
        dedupeKey
      });
    }

    if (settings.browserPush && pushAllowed) {
      const push = await sendPushAlertToUser(user.id, payload);
      result.pushSent += push.sent;
      result.pushSkipped += push.skipped;
      result.pushFailed += push.failed;
      await recordAlertDelivery(payload, {
        alertId: inAppAlertId,
        userId: user.id,
        channel: "browser_push",
        status: push.sent > 0 ? "sent" : push.failed > 0 ? "failed" : "skipped",
        reason: push.sent > 0 ? "sent" : push.failed > 0 ? "push_failed" : "no_active_subscription",
        detail: `Browser push sent ${push.sent}, skipped ${push.skipped}, failed ${push.failed}.`,
        dedupeKey
      });
    } else if (settings.browserPush) {
      result.pushSkipped += 1;
      await recordAlertDelivery(payload, {
        alertId: inAppAlertId,
        userId: user.id,
        channel: "browser_push",
        status: "skipped",
        reason: "permission_not_allowed",
        detail: "User role or permissions do not allow browser push alerts.",
        dedupeKey
      });
    }
  }

  if (payload.productId && result.inAppCreated + result.emailSent + result.smsSent + result.pushSent > 0) {
    await prisma.product.updateMany({ where: { id: payload.productId }, data: { lastAlertSentAt: new Date() } });
  }

  return result;
}

export async function sendTestAlert(user: SessionUser, channel: "inApp" | "email" | "sms" | "browserPush") {
  const settings = await prisma.notificationSettings.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      inApp: true,
      email: false,
      sms: false,
      browserPush: false,
      emailTo: user.email,
      minimumPriority: "LOW"
    }
  });

  const title = "Poke Restock Radar test alert";
  const reason = "This confirms the selected alert channel is configured for this private app.";

  if (channel === "inApp") {
    await prisma.alert.create({
      data: {
        title,
        reason,
        priority: "LOW",
        entityType: "SYSTEM",
        userId: user.id
      }
    });
    return { ok: true, channel, result: "In-app test alert created" };
  }

  if (channel === "email") {
    if (!settings.emailTo) throw new Error("Add an email destination before sending a test email.");
    const sent = await sendEmail(settings.emailTo, title, reason);
    if (!sent) throw new Error("SMTP env vars are not configured.");
    return { ok: true, channel, result: "Email test alert sent" };
  }

  if (channel === "browserPush") {
    return sendTestBrowserPush(user);
  }

  if (!settings.phone) throw new Error("Add a phone number before sending a test SMS.");
  const sent = await sendSms(settings.phone, `${title}: ${reason}`);
  if (!sent) throw new Error("Twilio env vars are not configured.");
  return { ok: true, channel, result: "SMS test alert sent" };
}

export async function sendTestAllAlerts(user: SessionUser) {
  const settings = await prisma.notificationSettings.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      inApp: true,
      email: false,
      sms: false,
      browserPush: false,
      emailTo: user.email,
      minimumPriority: "LOW"
    }
  });

  const [product, store, release, card] = await Promise.all([
    prisma.product.findFirst({ orderBy: { updatedAt: "desc" } }),
    prisma.store.findFirst({ orderBy: { updatedAt: "desc" } }),
    prisma.release.findFirst({ orderBy: { officialReleaseDate: "asc" } }),
    prisma.card.findFirst({ orderBy: { top10Score: "desc" } })
  ]);

  const routePayloads: AlertPayload[] = [];
  if (product) {
    routePayloads.push({
      title: "Route test: product restock",
      reason: "Product restock alerts should open Products and Go should open only the official retailer page.",
      priority: "LOW",
      entityType: "PRODUCT",
      entityId: product.id,
      productId: product.id,
      actionUrl: exactProductActionUrl(product) ?? undefined
    });
  }
  if (store) {
    routePayloads.push({
      title: "Route test: store window",
      reason: "Store prediction alerts should open Field Mode.",
      priority: "LOW",
      entityType: "STORE",
      entityId: store.id
    });
  }
  if (release) {
    routePayloads.push({
      title: "Route test: release calendar",
      reason: "Release alerts should open the Release Calendar.",
      priority: "LOW",
      entityType: "RELEASE",
      entityId: release.id
    });
  }
  if (card) {
    routePayloads.push({
      title: "Route test: card opportunity",
      reason: "Card opportunity alerts should open the Card Tracker.",
      priority: "LOW",
      entityType: "CARD",
      entityId: card.id
    });
  }

  for (const payload of routePayloads) {
    await prisma.alert.create({
      data: {
        title: payload.title,
        reason: payload.reason,
        priority: payload.priority,
        entityType: payload.entityType,
        entityId: payload.entityId,
        productId: payload.productId,
        actionUrl: payload.actionUrl,
        userId: user.id
      }
    });
  }

  const result = {
    ok: true,
    inApp: { created: routePayloads.length },
    email: { status: "skipped", detail: "Email alerts are disabled for this user or SMTP is not configured." },
    sms: { status: "skipped", detail: "SMS alerts are disabled for this user or Twilio is not configured." },
    browserPush: { status: "skipped", detail: "Browser push is disabled or no active subscription exists." },
    routes: routePayloads.map((payload) => ({
      entityType: payload.entityType,
      appRoute: notificationRouteForAlert(payload),
      actionUrl: payload.actionUrl ?? null,
      notification: browserNotificationPayload(payload)
    }))
  };

  if (settings.email && settings.emailTo && smtpReady()) {
    await sendEmail(
      settings.emailTo,
      "Poke Restock Radar all-alert test",
      "All-alert test created in-app route checks and confirms email delivery is active."
    );
    result.email = { status: "sent", detail: `Sent to ${settings.emailTo}` };
  } else if (settings.email) {
    result.email = { status: "skipped", detail: "Email is enabled but SMTP or destination is missing." };
  }

  if (settings.sms && settings.phone && twilioReady()) {
    await sendSms(settings.phone, "Poke Restock Radar all-alert test: SMS delivery is active.");
    result.sms = { status: "sent", detail: `Sent to ${settings.phone}` };
  } else if (settings.sms) {
    result.sms = { status: "skipped", detail: "SMS is enabled but Twilio or phone is missing." };
  }

  if (settings.browserPush) {
    const push = await sendPushAlertToUser(user.id, {
      title: "Poke Restock Radar all-alert test",
      reason: "Browser push delivery is active for this private radar.",
      priority: "LOW",
      entityType: "SYSTEM"
    });
    result.browserPush =
      push.sent > 0
        ? { status: "sent", detail: `Sent ${push.sent} browser push notification${push.sent === 1 ? "" : "s"}.` }
        : { status: "skipped", detail: `Push sent ${push.sent}, skipped ${push.skipped}, failed ${push.failed}.` };
  }

  return result;
}
