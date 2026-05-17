import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { deliverAlert, notificationSummary } from "@/lib/notifications";
import type { Priority, ProductStatus } from "@/types/radar";

type RunType = "MANUAL_PRODUCT" | "MANUAL_ALL" | "DUE_JOB";

type Detection = {
  status: ProductStatus | null;
  price: number | null;
  pageHash: string;
  httpStatus: number;
  reason: string;
};

const actionableStatuses: ProductStatus[] = [
  "IN_STOCK",
  "ADD_TO_CART_AVAILABLE",
  "PREORDER_LIVE",
  "PRICE_CHANGE",
  "PAGE_UPDATED"
];

const soldOutSignals = [
  "sold out",
  "out of stock",
  "currently unavailable",
  "temporarily unavailable",
  "not available",
  "unavailable online"
];

const cartSignals = ["add to cart", "add for shipping", "add to bag", "buy now"];
const inStockSignals = ["in stock", "available to ship", "available now"];
const preorderSignals = ["preorder", "pre-order", "pre order"];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestDelayMs() {
  const configured = Number(process.env.MONITOR_REQUEST_DELAY_MS || 1500);
  if (!Number.isFinite(configured)) return 1500;
  return Math.max(500, configured);
}

function nextCheckAt(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function hashPage(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

function normalizedText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function includesAny(text: string, signals: string[]) {
  return signals.some((signal) => text.includes(signal));
}

function detectPrice(html: string) {
  const candidates = [
    /"price"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /"salePrice"\s*:\s*"?([0-9]{1,5}(?:\.[0-9]{1,2})?)"?/i,
    /\$\s*([0-9]{1,5}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/
  ];

  for (const regex of candidates) {
    const match = html.match(regex);
    if (!match?.[1]) continue;
    const value = Number(match[1].replaceAll(",", ""));
    if (Number.isFinite(value) && value >= 0 && value <= 100000) return value;
  }

  return null;
}

function detectPublicStatus(html: string): Pick<Detection, "status" | "reason"> {
  const text = normalizedText(html);
  const hasSoldOut = includesAny(text, soldOutSignals);
  const hasCart = includesAny(text, cartSignals);
  const hasInStock = includesAny(text, inStockSignals);
  const hasPreorder = includesAny(text, preorderSignals);

  if (hasPreorder && (hasCart || !hasSoldOut)) {
    return { status: "PREORDER_LIVE", reason: "Public page contains preorder availability language." };
  }
  if (hasCart && !hasSoldOut) {
    return { status: "ADD_TO_CART_AVAILABLE", reason: "Public page contains add-to-cart language." };
  }
  if (hasInStock && !hasSoldOut) {
    return { status: "IN_STOCK", reason: "Public page contains in-stock language." };
  }
  if (hasSoldOut) {
    return { status: "SOLD_OUT", reason: "Public page contains sold-out or unavailable language." };
  }

  return { status: null, reason: "No clear stock signal found on the public page." };
}

async function fetchPublicProductPage(url: string): Promise<Detection> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "PokeRestockRadar/0.2 private-safe-monitor (+manual-checkout-only)"
    }
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Public page returned HTTP ${response.status}`);
  }

  const status = detectPublicStatus(body);
  return {
    ...status,
    price: detectPrice(body),
    pageHash: hashPage(body),
    httpStatus: response.status
  };
}

function changedStatus(
  currentStatus: ProductStatus,
  currentPrice: number | null,
  currentHash: string | null,
  detection: Detection
): { nextStatus: ProductStatus; changed: boolean; summary: string } {
  const detectedPriceChanged =
    detection.price !== null && currentPrice !== null && Math.abs(detection.price - currentPrice) >= 0.01;

  if (detectedPriceChanged) {
    return {
      nextStatus: "PRICE_CHANGE",
      changed: true,
      summary: `Price changed from ${currentPrice} to ${detection.price}.`
    };
  }

  if (detection.status && detection.status !== currentStatus) {
    return {
      nextStatus: detection.status,
      changed: true,
      summary: `Status changed from ${currentStatus} to ${detection.status}.`
    };
  }

  if (currentHash && detection.pageHash !== currentHash) {
    return {
      nextStatus: "PAGE_UPDATED",
      changed: currentStatus !== "PAGE_UPDATED",
      summary: "Public product page content changed."
    };
  }

  return {
    nextStatus: detection.status || currentStatus,
    changed: false,
    summary: detection.reason
  };
}

async function createMonitorLog(input: {
  productId?: string;
  runType: RunType;
  status: "SUCCESS" | "CHANGED" | "SKIPPED" | "ERROR";
  previousStatus?: string;
  detectedStatus?: string;
  previousPrice?: number | null;
  detectedPrice?: number | null;
  changeSummary?: string;
  httpStatus?: number;
  pageHash?: string;
  startedAt: Date;
  error?: string;
  alertSent?: boolean;
  notificationSummary?: string;
}) {
  const finishedAt = new Date();
  return prisma.monitorLog.create({
    data: {
      productId: input.productId,
      runType: input.runType,
      status: input.status,
      previousStatus: input.previousStatus,
      detectedStatus: input.detectedStatus,
      previousPrice: input.previousPrice,
      detectedPrice: input.detectedPrice,
      changeSummary: input.changeSummary,
      httpStatus: input.httpStatus,
      pageHash: input.pageHash,
      startedAt: input.startedAt,
      finishedAt,
      durationMs: finishedAt.getTime() - input.startedAt.getTime(),
      error: input.error,
      alertSent: input.alertSent || false,
      notificationSummary: input.notificationSummary
    }
  });
}

export async function runProductMonitorCheck(productId: string, runType: RunType = "MANUAL_PRODUCT", force = true) {
  const startedAt = new Date();
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { retailer: { select: { name: true } } }
  });

  if (!product) throw new Error("Product not found");

  const now = new Date();
  if (!force && product.nextCheckAt && product.nextCheckAt > now) {
    const log = await createMonitorLog({
      productId,
      runType,
      status: "SKIPPED",
      previousStatus: product.stockStatus,
      changeSummary: `Next check is scheduled for ${product.nextCheckAt.toISOString()}.`,
      startedAt
    });
    return { productId, status: "SKIPPED", logId: log.id };
  }

  try {
    const detection = await fetchPublicProductPage(product.url);
    const change = changedStatus(
      product.stockStatus as ProductStatus,
      product.retailPrice,
      product.lastPageHash,
      detection
    );
    const monitorResult = change.changed ? change.summary : `Checked public page. ${detection.reason}`;

    let alertSent = false;
    let deliverySummary: string | undefined;

    if (change.changed) {
      await prisma.restockHistory.create({
        data: {
          productId,
          status: change.nextStatus,
          price: detection.price ?? product.retailPrice,
          snapshotReason: `Monitor: ${change.summary}`
        }
      });

      const delivery = await deliverAlert({
        title: `${product.name}: ${change.nextStatus.replaceAll("_", " ").toLowerCase()}`,
        reason: `${change.summary} Source: public ${product.retailer.name} product page. Manual checkout only.`,
        priority: product.priority as Priority,
        entityType: "PRODUCT",
        entityId: product.id,
        productId: product.id,
        actionUrl: product.url
      });
      deliverySummary = notificationSummary(delivery);
      alertSent = delivery.inAppCreated + delivery.emailSent + delivery.smsSent + delivery.pushSent > 0;
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        stockStatus: change.nextStatus,
        retailPrice: detection.price ?? product.retailPrice,
        lastCheckedAt: now,
        nextCheckAt: nextCheckAt(product.checkFrequencyMinutes),
        lastMonitorResult: monitorResult,
        lastMonitorError: null,
        lastPageHash: detection.pageHash,
        lastAlertSentAt: alertSent ? now : product.lastAlertSentAt,
        alertStatus: actionableStatuses.includes(change.nextStatus)
      }
    });

    const log = await createMonitorLog({
      productId,
      runType,
      status: change.changed ? "CHANGED" : "SUCCESS",
      previousStatus: product.stockStatus,
      detectedStatus: change.nextStatus,
      previousPrice: product.retailPrice,
      detectedPrice: detection.price,
      changeSummary: monitorResult,
      httpStatus: detection.httpStatus,
      pageHash: detection.pageHash,
      startedAt,
      alertSent,
      notificationSummary: deliverySummary
    });

    return {
      productId,
      productName: updated.name,
      status: log.status,
      detectedStatus: change.nextStatus,
      alertSent,
      logId: log.id
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Monitor check failed";
    await prisma.product.update({
      where: { id: productId },
      data: {
        lastCheckedAt: now,
        nextCheckAt: nextCheckAt(product.checkFrequencyMinutes),
        lastMonitorError: message,
        lastMonitorResult: "Check failed"
      }
    });
    const log = await createMonitorLog({
      productId,
      runType,
      status: "ERROR",
      previousStatus: product.stockStatus,
      previousPrice: product.retailPrice,
      startedAt,
      error: message,
      changeSummary: "Public product page check failed."
    });
    return { productId, productName: product.name, status: "ERROR", error: message, logId: log.id };
  }
}

export async function runProductMonitorBatch(mode: "due" | "all", runType: RunType = mode === "all" ? "MANUAL_ALL" : "DUE_JOB") {
  const now = new Date();
  const products = await prisma.product.findMany({
    where: {
      monitorEnabled: true,
      ...(mode === "due" ? { OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }] } : {})
    },
    orderBy: [{ nextCheckAt: "asc" }, { updatedAt: "asc" }]
  });

  const results = [];
  for (const product of products) {
    results.push(await runProductMonitorCheck(product.id, runType, mode === "all"));
    await delay(requestDelayMs());
  }

  if (results.length === 0) {
    const log = await createMonitorLog({
      runType,
      status: "SKIPPED",
      startedAt: now,
      changeSummary: "No products were due for monitoring."
    });
    return { checked: 0, changed: 0, errors: 0, results, logId: log.id };
  }

  return {
    checked: results.length,
    changed: results.filter((result) => result.status === "CHANGED").length,
    errors: results.filter((result) => result.status === "ERROR").length,
    results
  };
}
