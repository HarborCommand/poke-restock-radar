import webPush from "web-push";
import { prisma } from "@/lib/db";
import type { Priority, SessionUser } from "@/types/radar";

type StoredPushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type PushAlertPayload = {
  title: string;
  reason: string;
  priority: Priority;
  entityType: string;
  entityId?: string;
  productId?: string;
  actionUrl?: string;
};

export type BrowserNotificationPayload = {
  title: string;
  body: string;
  icon: string;
  badge: string;
  tag: string;
  data: {
    url: string;
    entityType: string;
    entityId: string | null;
    actionUrl: string | null;
  };
};

function configuredAppUrl() {
  return process.env.APP_URL || "http://localhost:3020";
}

function appUrl(path: string) {
  return new URL(path, configuredAppUrl()).toString();
}

export function vapidConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.VAPID_SUBJECT
  );
}

function configureWebPush() {
  if (!vapidConfigured()) return false;
  webPush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  return true;
}

export function notificationRouteForAlert(payload: PushAlertPayload) {
  const entityId = payload.entityId || payload.productId || "";
  if (payload.entityType === "PRODUCT") return appUrl(`/?tab=products&focus=product-${entityId}`);
  if (payload.entityType === "STORE") return appUrl(`/?tab=field&focus=store-${entityId}`);
  if (payload.entityType === "RELEASE") return appUrl(`/?tab=releases&focus=release-${entityId}`);
  if (payload.entityType === "CARD") return appUrl(`/?tab=cards&focus=card-${entityId}`);
  return appUrl("/?tab=alerts");
}

export function browserNotificationPayload(payload: PushAlertPayload): BrowserNotificationPayload {
  const entityId = payload.entityId || payload.productId || null;
  return {
    title: payload.title,
    body: payload.reason,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: `${payload.entityType}-${entityId || "alert"}`,
    data: {
      url: notificationRouteForAlert(payload),
      entityType: payload.entityType,
      entityId,
      actionUrl: payload.actionUrl || null
    }
  };
}

export async function saveBrowserPushSubscription(
  user: SessionUser,
  subscription: StoredPushSubscription,
  userAgent?: string | null
) {
  await prisma.browserPushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: {
      userId: user.id,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: userAgent || null,
      disabledAt: null
    },
    create: {
      userId: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: userAgent || null
    }
  });

  await prisma.notificationSettings.upsert({
    where: { userId: user.id },
    update: { browserPush: true },
    create: {
      userId: user.id,
      inApp: true,
      email: false,
      sms: false,
      browserPush: true,
      emailTo: user.email,
      minimumPriority: "LOW"
    }
  });

  return { ok: true };
}

export async function disableBrowserPushSubscription(user: SessionUser, endpoint?: string) {
  await prisma.browserPushSubscription.updateMany({
    where: {
      userId: user.id,
      ...(endpoint ? { endpoint } : {})
    },
    data: { disabledAt: new Date() }
  });
  await prisma.notificationSettings.upsert({
    where: { userId: user.id },
    update: { browserPush: false },
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
  return { ok: true };
}

export async function sendPushAlertToUser(userId: string, payload: PushAlertPayload) {
  const subscriptions = await prisma.browserPushSubscription.findMany({
    where: { userId, disabledAt: null }
  });

  if (!subscriptions.length) return { sent: 0, skipped: 1, failed: 0 };
  if (!configureWebPush()) return { sent: 0, skipped: subscriptions.length, failed: 0 };

  let sent = 0;
  let failed = 0;
  const body = JSON.stringify(browserNotificationPayload(payload));
  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth
          }
        },
        body
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode =
        typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : null;
      if (statusCode === 404 || statusCode === 410) {
        await prisma.browserPushSubscription.update({
          where: { endpoint: subscription.endpoint },
          data: { disabledAt: new Date() }
        });
      }
    }
  }

  return { sent, skipped: 0, failed };
}

export async function sendTestBrowserPush(user: SessionUser) {
  const payload: PushAlertPayload = {
    title: "Poke Restock Radar browser push test",
    reason: "Browser push is connected for fast private restock alerts.",
    priority: "LOW",
    entityType: "SYSTEM"
  };
  const notification = browserNotificationPayload(payload);

  if (!vapidConfigured()) {
    await prisma.alert.create({
      data: {
        title: payload.title,
        reason: "VAPID env vars are not configured yet. Showing a browser fallback when permission is granted.",
        priority: payload.priority,
        entityType: "SYSTEM",
        userId: user.id
      }
    });
    return {
      ok: true,
      channel: "browserPush",
      fallback: true,
      result: "VAPID env vars are not configured. Browser fallback returned.",
      notification
    };
  }

  const result = await sendPushAlertToUser(user.id, payload);
  if (result.sent > 0) {
    return { ok: true, channel: "browserPush", fallback: false, result: "Browser push test sent", notification };
  }

  await prisma.alert.create({
    data: {
      title: payload.title,
      reason: "No active browser subscription received the test. Showing a browser fallback when permission is granted.",
      priority: payload.priority,
      entityType: "SYSTEM",
      userId: user.id
    }
  });
  return {
    ok: true,
    channel: "browserPush",
    fallback: true,
    result: "No active browser subscription received the test. Browser fallback returned.",
    notification
  };
}
