import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { deliverAlert, notificationSummary } from "@/lib/notifications";
import { exactProductActionUrl, matchProductIdentity, type ProductIdentityMatch } from "@/lib/product-identity";
import { detectRetailerPrice, detectTargetAvailability, fetchTargetRedskyLiveSignal } from "@/lib/retailer-page-signals";
import { templateForRetailerName, type RetailerTemplate } from "@/lib/retailer-templates";
import type { Priority, ProductStatus } from "@/types/radar";

type RunType = "MANUAL_PRODUCT" | "MANUAL_ALL" | "DUE_JOB";
type MonitorLogStatus = "SUCCESS" | "CHANGED" | "SKIPPED" | "ERROR" | "BLOCKED" | "PENDING_CONFIRMATION";
type BlockedType = "PAGE_BLOCKED" | "CAPTCHA_ROBOT_PAGE";
const MONITOR_USER_AGENT = "PokeRestockRadar/0.3 private-safe-monitor (+manual-checkout-only)";

type Detection = {
  status: ProductStatus | null;
  price: number | null;
  title: string | null;
  imageUrl: string | null;
  pageHash: string;
  httpStatus: number;
  finalUrl: string;
  responseTimeMs: number;
  confidenceScore: number;
  reason: string;
  detectedWords: string[];
  parsedStockText: string | null;
  addToCartEnabled: boolean | null;
  blockedType: BlockedType | null;
  identityMatch: ProductIdentityMatch;
};

const actionableStatuses: ProductStatus[] = [
  "IN_STOCK",
  "ADD_TO_CART_AVAILABLE",
  "PREORDER_LIVE",
  "PRICE_CHANGE",
  "PAGE_UPDATED"
];

const genericSignals = {
  soldOut: [
    "sold out",
    "out of stock",
    "currently unavailable",
    "temporarily unavailable",
    "not available",
    "unavailable online"
  ],
  unavailable: ["unavailable", "not found", "page not found", "no longer available"],
  addToCart: ["add to cart", "add for shipping", "add to bag", "buy now"],
  inStock: ["in stock", "available to ship", "available now"],
  preorder: ["preorder", "pre-order", "pre order"],
  pageBlocked: ["access denied", "request blocked", "temporarily blocked", "waiting room"],
  captcha: ["captcha", "verify you are human", "robot check", "automated access"],
  pageChanged: ["product details", "shipping", "pickup"]
};

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

function uniqueWords(words: string[]) {
  return [...new Set(words.map((word) => word.trim()).filter(Boolean))];
}

function splitWords(value: string | null | undefined) {
  if (!value) return [];
  return uniqueWords(
    value
      .split(/[\n,]/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length >= 2)
  );
}

function mergeSignals(template: RetailerTemplate | null) {
  return {
    soldOut: uniqueWords([...(template?.statusWords.soldOut ?? []), ...genericSignals.soldOut]),
    unavailable: uniqueWords([...(template?.statusWords.unavailable ?? []), ...genericSignals.unavailable]),
    addToCart: uniqueWords([...(template?.statusWords.addToCart ?? []), ...genericSignals.addToCart]),
    inStock: uniqueWords([...(template?.statusWords.inStock ?? []), ...genericSignals.inStock]),
    preorder: uniqueWords([...(template?.statusWords.preorder ?? []), ...genericSignals.preorder]),
    pageBlocked: uniqueWords([...(template?.statusWords.pageBlocked ?? []), ...genericSignals.pageBlocked]),
    captcha: uniqueWords([...(template?.statusWords.captcha ?? []), ...genericSignals.captcha]),
    pageChanged: uniqueWords([...(template?.statusWords.pageChanged ?? []), ...genericSignals.pageChanged])
  };
}

function wordHits(text: string, words: string[]) {
  return words.filter((word) => text.includes(word.toLowerCase()));
}

function extractHtmlTitle(html: string) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const title = ogTitle || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "";
  return title.replace(/\s+/g, " ").trim().slice(0, 180);
}

function cleanHtmlAttribute(value: string | undefined) {
  return (value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .trim();
}

function absoluteImageUrl(value: string | null, finalUrl: string) {
  if (!value) return null;
  try {
    return new URL(value, finalUrl).toString();
  } catch {
    return null;
  }
}

function extractProductImageUrl(html: string, finalUrl: string) {
  const candidates = [
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/"image"\s*:\s*"([^"]+)"/i)?.[1],
    html.match(/"imageUrl"\s*:\s*"([^"]+)"/i)?.[1],
    html.match(/"primaryImage"\s*:\s*"([^"]+)"/i)?.[1]
  ];
  for (const candidate of candidates) {
    const imageUrl = absoluteImageUrl(cleanHtmlAttribute(candidate), finalUrl);
    if (imageUrl && /^https?:\/\//i.test(imageUrl)) return imageUrl;
  }
  return null;
}

function withRequirementPenalty<T extends {
  status: ProductStatus | null;
  confidenceScore: number;
  reason: string;
  requiredMissing: string[];
}>(input: T) {
  if (!input.requiredMissing.length || !input.status) return input;
  return {
    ...input,
    confidenceScore: Math.min(input.confidenceScore, 45),
    reason: `${input.reason} Required words missing: ${input.requiredMissing.join(", ")}.`
  };
}

function detectPublicStatus(input: {
  html: string;
  retailerName: string;
  httpStatus: number;
  requiredWords?: string | null;
  ignoreWords?: string | null;
}): Pick<Detection, "status" | "confidenceScore" | "reason" | "detectedWords" | "parsedStockText" | "addToCartEnabled" | "blockedType"> {
  const text = normalizedText(input.html);
  const template = templateForRetailerName(input.retailerName);
  const signals = mergeSignals(template);
  const requiredWords = splitWords(input.requiredWords);
  const ignoreWords = splitWords(input.ignoreWords);

  const matches = {
    captcha: wordHits(text, signals.captcha),
    pageBlocked: wordHits(text, signals.pageBlocked),
    preorder: wordHits(text, signals.preorder),
    addToCart: wordHits(text, signals.addToCart),
    inStock: wordHits(text, signals.inStock),
    soldOut: wordHits(text, signals.soldOut),
    unavailable: wordHits(text, signals.unavailable),
    pageChanged: wordHits(text, signals.pageChanged),
    required: wordHits(text, requiredWords),
    ignored: wordHits(text, ignoreWords)
  };
  const requiredMissing = requiredWords.filter((word) => !matches.required.includes(word));
  const detectedWords = uniqueWords([
    ...matches.captcha,
    ...matches.pageBlocked,
    ...matches.preorder,
    ...matches.addToCart,
    ...matches.inStock,
    ...matches.soldOut,
    ...matches.unavailable,
    ...matches.pageChanged,
    ...matches.required,
    ...matches.ignored
  ]);

  if ([401, 403, 429, 503].includes(input.httpStatus) || matches.captcha.length || matches.pageBlocked.length) {
    const captcha = matches.captcha.length > 0;
    return {
      status: null,
      confidenceScore: 0,
      reason: captcha
        ? "Public page appears to be a captcha or robot verification page. No alert will be sent."
        : `Public page appears blocked or rate limited with HTTP ${input.httpStatus}. No alert will be sent.`,
      detectedWords,
      parsedStockText: null,
      addToCartEnabled: null,
      blockedType: captcha ? "CAPTCHA_ROBOT_PAGE" : "PAGE_BLOCKED"
    };
  }

  if ([404, 410].includes(input.httpStatus)) {
    return {
      status: "UNAVAILABLE",
      confidenceScore: 85,
      reason: `Public page returned HTTP ${input.httpStatus}; treating product as unavailable.`,
      detectedWords: uniqueWords([...detectedWords, `http ${input.httpStatus}`]),
      parsedStockText: `HTTP ${input.httpStatus}`,
      addToCartEnabled: false,
      blockedType: null
    };
  }

  if (matches.ignored.length) {
    return {
      status: null,
      confidenceScore: 15,
      reason: `Ignored product words matched: ${matches.ignored.join(", ")}. No restock status will be inferred.`,
      detectedWords,
      parsedStockText: null,
      addToCartEnabled: null,
      blockedType: null
    };
  }

  const hasSoldOut = matches.soldOut.length > 0;
  const hasUnavailable = matches.unavailable.length > 0;
  const hasCart = matches.addToCart.length > 0;
  const hasInStock = matches.inStock.length > 0;
  const hasPreorder = matches.preorder.length > 0;
  const parsedStockText =
    matches.soldOut[0] ||
    matches.unavailable[0] ||
    matches.preorder[0] ||
    matches.inStock[0] ||
    matches.addToCart[0] ||
    null;

  if (input.retailerName.toLowerCase().includes("target")) {
    const target = detectTargetAvailability(input.html);
    return withRequirementPenalty({
      status: target.status,
      confidenceScore: target.confidenceScore,
      reason: target.reason,
      detectedWords: uniqueWords([...detectedWords, ...target.detectedWords]),
      parsedStockText: target.stockText,
      addToCartEnabled: target.addToCartEnabled,
      blockedType: null,
      requiredMissing
    });
  }

  if (hasPreorder && (hasCart || !hasSoldOut)) {
    return withRequirementPenalty({
      status: "PREORDER_LIVE",
      confidenceScore: hasCart ? 92 : 78,
      reason: hasCart
        ? "Retailer-specific preorder and add-to-cart words matched."
        : "Retailer-specific preorder words matched.",
      detectedWords,
      parsedStockText: parsedStockText || "preorder",
      addToCartEnabled: hasCart ? true : null,
      blockedType: null,
      requiredMissing
    });
  }
  if (hasCart && !hasSoldOut) {
    return withRequirementPenalty({
      status: "ADD_TO_CART_AVAILABLE",
      confidenceScore: 88,
      reason: "Retailer-specific add-to-cart words matched without sold-out words.",
      detectedWords,
      parsedStockText: parsedStockText || "add to cart",
      addToCartEnabled: true,
      blockedType: null,
      requiredMissing
    });
  }
  if (hasInStock && !hasSoldOut) {
    return withRequirementPenalty({
      status: "IN_STOCK",
      confidenceScore: 82,
      reason: "Retailer-specific in-stock words matched without sold-out words.",
      detectedWords,
      parsedStockText: parsedStockText || "in stock",
      addToCartEnabled: null,
      blockedType: null,
      requiredMissing
    });
  }
  if ((hasCart || hasInStock) && hasSoldOut) {
    return withRequirementPenalty({
      status: "SOLD_OUT",
      confidenceScore: 55,
      reason: "Conflicting available and sold-out words matched; treating as sold out with low confidence.",
      detectedWords,
      parsedStockText: parsedStockText || "sold out",
      addToCartEnabled: false,
      blockedType: null,
      requiredMissing
    });
  }
  if (hasSoldOut) {
    return withRequirementPenalty({
      status: "SOLD_OUT",
      confidenceScore: 80,
      reason: "Retailer-specific sold-out words matched.",
      detectedWords,
      parsedStockText: parsedStockText || "sold out",
      addToCartEnabled: false,
      blockedType: null,
      requiredMissing
    });
  }
  if (hasUnavailable) {
    return withRequirementPenalty({
      status: "UNAVAILABLE",
      confidenceScore: 76,
      reason: "Retailer-specific unavailable words matched.",
      detectedWords,
      parsedStockText: parsedStockText || "unavailable",
      addToCartEnabled: false,
      blockedType: null,
      requiredMissing
    });
  }

  return {
    status: null,
    confidenceScore: matches.pageChanged.length ? 50 : 35,
    reason: matches.pageChanged.length
      ? "Page changed cues were present, but no clear stock signal was found."
      : "No clear stock signal found on the public page.",
    detectedWords,
    parsedStockText: null,
    addToCartEnabled: null,
    blockedType: null
  };
}

async function fetchPublicProductPage(input: {
  product: {
    name: string;
    url: string;
    expectedTitleKeywords: string | null;
    upc: string | null;
    sku: string | null;
    dpci: string | null;
    retailerProductId: string | null;
    retailPrice: number | null;
  };
  retailerName: string;
  requiredWords?: string | null;
  ignoreWords?: string | null;
}): Promise<Detection> {
  const started = Date.now();
  const response = await fetch(input.product.url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": MONITOR_USER_AGENT
    }
  });

  const body = await response.text();
  const responseTimeMs = Date.now() - started;
  const finalUrl = response.url || input.product.url;
  const pageStatus = detectPublicStatus({
    html: body,
    retailerName: input.retailerName,
    httpStatus: response.status,
    requiredWords: input.requiredWords,
    ignoreWords: input.ignoreWords
  });

  if (!response.ok && !pageStatus.blockedType && pageStatus.status !== "UNAVAILABLE") {
    throw new Error(`Public page returned HTTP ${response.status}`);
  }
  const titleText = extractHtmlTitle(body);
  const targetApiSignal = input.retailerName.toLowerCase().includes("target")
    ? await fetchTargetRedskyLiveSignal({
        html: body,
        finalUrl,
        retailerProductId: input.product.retailerProductId,
        userAgent: MONITOR_USER_AGENT,
        fallbackAvailability: {
          status: pageStatus.status,
          stockText: pageStatus.parsedStockText,
          addToCartEnabled: pageStatus.addToCartEnabled,
          confidenceScore: pageStatus.confidenceScore,
          reason: pageStatus.reason,
          detectedWords: pageStatus.detectedWords
        }
      }).catch(() => null)
    : null;
  const status = targetApiSignal
    ? {
        ...pageStatus,
        status: targetApiSignal.availability.status,
        confidenceScore: targetApiSignal.availability.confidenceScore,
        reason: targetApiSignal.availability.reason,
        detectedWords: uniqueWords([...pageStatus.detectedWords, ...targetApiSignal.availability.detectedWords]),
        parsedStockText: targetApiSignal.availability.stockText,
        addToCartEnabled: targetApiSignal.availability.addToCartEnabled
      }
    : pageStatus;
  const identityMatch = matchProductIdentity({
    product: {
      retailerName: input.retailerName,
      name: input.product.name,
      url: input.product.url,
      expectedTitleKeywords: input.product.expectedTitleKeywords,
      upc: input.product.upc,
      sku: input.product.sku,
      dpci: input.product.dpci,
      retailerProductId: input.product.retailerProductId,
      retailPrice: input.product.retailPrice
    },
    finalUrl,
    html: body,
    titleText,
    httpStatus: response.status
  });

  return {
    ...status,
    price: targetApiSignal?.price ?? detectRetailerPrice(body, input.retailerName),
    title: targetApiSignal?.title || titleText || null,
    imageUrl: targetApiSignal?.imageUrl || extractProductImageUrl(body, finalUrl),
    pageHash: hashPage(body),
    httpStatus: response.status,
    finalUrl,
    responseTimeMs,
    identityMatch
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

  if (detection.status && detection.status !== currentStatus) {
    return {
      nextStatus: detection.status,
      changed: true,
      summary: `Status changed from ${currentStatus} to ${detection.status}.`
    };
  }

  if (detection.status) {
    return {
      nextStatus: detection.status,
      changed: false,
      summary: detectedPriceChanged
        ? `Status remains ${detection.status}; live price updated from ${currentPrice} to ${detection.price}.`
        : detection.reason
    };
  }

  if (detectedPriceChanged) {
    return {
      nextStatus: "PRICE_CHANGE",
      changed: true,
      summary: `Price changed from ${currentPrice} to ${detection.price}.`
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
  status: MonitorLogStatus | "FALSE_POSITIVE" | "FORCED_ALERT";
  previousStatus?: string;
  detectedStatus?: string;
  previousPrice?: number | null;
  detectedPrice?: number | null;
  changeSummary?: string;
  httpStatus?: number;
  finalUrl?: string;
  responseTimeMs?: number;
  detectedWords?: string[];
  confidenceScore?: number;
  reason?: string;
  blockedType?: string | null;
  parsedStockText?: string | null;
  addToCartEnabled?: boolean | null;
  pageHash?: string;
  startedAt: Date;
  error?: string;
  alertSent?: boolean;
  notificationSummary?: string;
}) {
  const finishedAt = new Date();
  const hasParsedDetails =
    input.detectedPrice !== undefined || input.parsedStockText !== undefined || input.addToCartEnabled !== undefined;
  const detectedWords = hasParsedDetails
    ? detectionDetailWords({
        detectedWords: input.detectedWords,
        detectedPrice: input.detectedPrice,
        parsedStockText: input.parsedStockText,
        addToCartEnabled: input.addToCartEnabled
      })
    : input.detectedWords ?? [];
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
      finalUrl: input.finalUrl,
      responseTimeMs: input.responseTimeMs,
      detectedWords: detectedWords.length ? detectedWords.join(", ") : undefined,
      confidenceScore: input.confidenceScore,
      reason: hasParsedDetails
        ? reasonWithDetectionDetails({
            reason: input.reason,
            detectedPrice: input.detectedPrice,
            parsedStockText: input.parsedStockText,
            addToCartEnabled: input.addToCartEnabled
          })
        : input.reason,
      blockedType: input.blockedType ?? undefined,
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

function shouldHoldForConfirmation(input: {
  priority: string;
  nextStatus: ProductStatus;
  confidenceScore: number;
}) {
  return input.priority === "HIGH" && actionableStatuses.includes(input.nextStatus) && input.confidenceScore < 70;
}

function pendingMatches(
  product: {
    pendingAlertStatus: string | null;
    pendingAlertPrice: number | null;
    pendingAlertPageHash: string | null;
  },
  nextStatus: ProductStatus,
  detection: Detection
) {
  if (product.pendingAlertStatus !== nextStatus) return false;
  if (nextStatus === "PRICE_CHANGE") {
    if (product.pendingAlertPrice === null || detection.price === null) return false;
    return Math.abs(product.pendingAlertPrice - detection.price) < 0.01;
  }
  if (nextStatus === "PAGE_UPDATED") {
    return product.pendingAlertPageHash === detection.pageHash;
  }
  return true;
}

function pendingClear() {
  return {
    pendingAlertStatus: null,
    pendingAlertPrice: null,
    pendingAlertPageHash: null,
    pendingAlertCount: 0,
    pendingAlertReason: null,
    pendingAlertConfidence: null,
    pendingAlertDetectedWords: null,
    pendingAlertAt: null
  };
}

function detectionDetailWords(input: {
  detectedWords?: string[];
  detectedPrice?: number | null;
  parsedStockText?: string | null;
  addToCartEnabled?: boolean | null;
}) {
  return uniqueWords([
    ...(input.detectedWords ?? []),
    input.detectedPrice === null || input.detectedPrice === undefined ? "parsed live price: not verified" : `parsed live price: ${input.detectedPrice}`,
    `parsed stock text: ${input.parsedStockText || "not found"}`,
    `add-to-cart enabled: ${input.addToCartEnabled === null || input.addToCartEnabled === undefined ? "unknown" : input.addToCartEnabled}`
  ]);
}

function reasonWithDetectionDetails(input: {
  reason?: string;
  detectedPrice?: number | null;
  parsedStockText?: string | null;
  addToCartEnabled?: boolean | null;
}) {
  const details = `Parsed live price: ${
    input.detectedPrice === null || input.detectedPrice === undefined ? "not verified" : input.detectedPrice
  }. Parsed stock text: ${input.parsedStockText || "not found"}. Add-to-cart enabled: ${
    input.addToCartEnabled === null || input.addToCartEnabled === undefined ? "unknown" : input.addToCartEnabled
  }.`;
  return input.reason ? `${input.reason} ${details}` : details;
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
    const detection = await fetchPublicProductPage({
      product: {
        name: product.name,
        url: product.url,
        expectedTitleKeywords: product.expectedTitleKeywords,
        upc: product.upc,
        sku: product.sku,
        dpci: product.dpci,
        retailerProductId: product.retailerProductId,
        retailPrice: product.retailPrice
      },
      retailerName: product.retailer.name,
      requiredWords: product.requiredWords,
      ignoreWords: product.ignoreWords
    });

    if (detection.blockedType) {
      await prisma.product.update({
        where: { id: productId },
        data: {
          lastCheckedAt: now,
          nextCheckAt: nextCheckAt(product.checkFrequencyMinutes),
          lastMonitorError: detection.reason,
          lastMonitorResult: `Blocked: ${detection.blockedType}`,
          liveTitle: detection.title,
          livePrice: detection.price,
          livePriceSource: detection.price === null ? null : "Retailer page",
          livePriceVerifiedAt: detection.price === null ? undefined : now,
          liveStockStatus: null,
          liveStockVerifiedAt: undefined,
          liveImageUrl: detection.imageUrl,
          liveConfidenceScore: detection.confidenceScore,
          liveBlockedType: detection.blockedType
        }
      });
      const log = await createMonitorLog({
        productId,
        runType,
        status: "BLOCKED",
        previousStatus: product.stockStatus,
        detectedStatus: detection.blockedType,
        previousPrice: product.retailPrice,
        detectedPrice: detection.price,
        changeSummary: detection.reason,
        httpStatus: detection.httpStatus,
        finalUrl: detection.finalUrl,
        responseTimeMs: detection.responseTimeMs,
        detectedWords: detection.detectedWords,
        confidenceScore: detection.confidenceScore,
        reason: detection.reason,
        blockedType: detection.blockedType,
        parsedStockText: detection.parsedStockText,
        addToCartEnabled: detection.addToCartEnabled,
        pageHash: detection.pageHash,
        startedAt
      });
      return {
        productId,
        productName: product.name,
        status: "BLOCKED",
        blockedType: detection.blockedType,
        logId: log.id
      };
    }

    if (!detection.identityMatch.readyForAlert) {
      const identityReason = detection.identityMatch.notes.join(". ");
      await prisma.product.update({
        where: { id: productId },
        data: {
          verificationStatus: detection.identityMatch.verificationStatus,
          verifiedAt: now,
          verifiedFinalUrl: detection.finalUrl,
          verificationNotes: identityReason,
          liveTitle: detection.title,
          livePrice: detection.price,
          livePriceSource: detection.price === null ? null : "Retailer page",
          livePriceVerifiedAt: detection.price === null ? undefined : now,
          liveStockStatus: detection.status,
          liveStockVerifiedAt: detection.status === null ? undefined : now,
          liveImageUrl: detection.imageUrl,
          liveConfidenceScore: detection.confidenceScore,
          liveBlockedType: null,
          lastCheckedAt: now,
          nextCheckAt: nextCheckAt(product.checkFrequencyMinutes),
          lastMonitorError: null,
          lastMonitorResult: `Exact product verification failed: ${detection.identityMatch.verificationStatus}. ${identityReason}`,
          alertStatus: false,
          ...pendingClear()
        }
      });
      const log = await createMonitorLog({
        productId,
        runType,
        status: "SKIPPED",
        previousStatus: product.stockStatus,
        detectedStatus: detection.identityMatch.verificationStatus,
        previousPrice: product.retailPrice,
        detectedPrice: detection.price,
        changeSummary: "Monitor skipped because the tracked page is not verified as the exact product.",
        httpStatus: detection.httpStatus,
        finalUrl: detection.finalUrl,
        responseTimeMs: detection.responseTimeMs,
        detectedWords: detection.detectedWords,
        confidenceScore: Math.min(detection.confidenceScore, 20),
        reason: identityReason,
        parsedStockText: detection.parsedStockText,
        addToCartEnabled: detection.addToCartEnabled,
        pageHash: detection.pageHash,
        startedAt,
        alertSent: false
      });
      return {
        productId,
        productName: product.name,
        status: "SKIPPED",
        detectedStatus: detection.identityMatch.verificationStatus,
        alertSent: false,
        logId: log.id
      };
    }

    const change = changedStatus(
      product.stockStatus as ProductStatus,
      product.livePrice ?? product.retailPrice,
      product.lastPageHash,
      detection
    );
    const monitorResult = change.changed
      ? `${change.summary} Confidence ${detection.confidenceScore}%.`
      : `Checked public page. ${detection.reason} Confidence ${detection.confidenceScore}%.`;
    const holdForConfirmation = change.changed
      ? shouldHoldForConfirmation({
          priority: product.priority,
          nextStatus: change.nextStatus,
          confidenceScore: detection.confidenceScore
        })
      : false;
    const matchingPending = holdForConfirmation && pendingMatches(product, change.nextStatus, detection);
    const nextPendingCount = holdForConfirmation ? (matchingPending ? product.pendingAlertCount + 1 : 1) : 0;

    if (holdForConfirmation && nextPendingCount < 2) {
      const pendingReason = `${change.summary} Low confidence (${detection.confidenceScore}%). Waiting for one more matching check before alerting.`;
      await prisma.product.update({
        where: { id: productId },
        data: {
          lastCheckedAt: now,
          lastSuccessfulCheckedAt: now,
          nextCheckAt: nextCheckAt(product.checkFrequencyMinutes),
          lastMonitorResult: pendingReason,
          lastMonitorError: null,
          liveTitle: detection.title,
          livePrice: detection.price,
          livePriceSource: detection.price === null ? null : "Retailer page",
          livePriceVerifiedAt: detection.price === null ? undefined : now,
          liveStockStatus: change.nextStatus,
          liveStockVerifiedAt: now,
          liveImageUrl: detection.imageUrl,
          liveConfidenceScore: detection.confidenceScore,
          liveBlockedType: null,
          pendingAlertStatus: change.nextStatus,
          pendingAlertPrice: detection.price,
          pendingAlertPageHash: detection.pageHash,
          pendingAlertCount: nextPendingCount,
          pendingAlertReason: pendingReason,
          pendingAlertConfidence: detection.confidenceScore,
          pendingAlertDetectedWords: detection.detectedWords.join(", "),
          pendingAlertAt: now
        }
      });
      const log = await createMonitorLog({
        productId,
        runType,
        status: "PENDING_CONFIRMATION",
        previousStatus: product.stockStatus,
        detectedStatus: change.nextStatus,
        previousPrice: product.retailPrice,
        detectedPrice: detection.price,
        changeSummary: pendingReason,
        httpStatus: detection.httpStatus,
        finalUrl: detection.finalUrl,
        responseTimeMs: detection.responseTimeMs,
        detectedWords: detection.detectedWords,
        confidenceScore: detection.confidenceScore,
        reason: detection.reason,
        parsedStockText: detection.parsedStockText,
        addToCartEnabled: detection.addToCartEnabled,
        pageHash: detection.pageHash,
        startedAt
      });
      return {
        productId,
        productName: product.name,
        status: "PENDING_CONFIRMATION",
        detectedStatus: change.nextStatus,
        alertSent: false,
        logId: log.id
      };
    }

    let alertSent = false;
    let deliverySummary: string | undefined;

    if (change.changed) {
      await prisma.restockHistory.create({
        data: {
          productId,
          status: change.nextStatus,
          price: detection.price ?? product.livePrice ?? product.retailPrice,
          snapshotReason: `Monitor: ${change.summary} Confidence ${detection.confidenceScore}%.`
        }
      });

      if (actionableStatuses.includes(change.nextStatus)) {
        const actionUrl = detection.identityMatch.actionUrl || exactProductActionUrl(product);
        const delivery = await deliverAlert({
          title: `${product.name}: ${change.nextStatus.replaceAll("_", " ").toLowerCase()}`,
          reason: `${change.summary} Confidence ${detection.confidenceScore}%. Source: public ${product.retailer.name} product page. Manual checkout only.`,
          priority: product.priority as Priority,
          entityType: "PRODUCT",
          entityId: product.id,
          productId: product.id,
          actionUrl: actionUrl ?? undefined
        });
        deliverySummary = notificationSummary(delivery);
        alertSent = delivery.inAppCreated + delivery.emailSent + delivery.smsSent + delivery.pushSent > 0;
      }
    }

    const updated = await prisma.product.update({
      where: { id: productId },
      data: {
        stockStatus: change.nextStatus,
        retailPrice: detection.price !== null && detection.confidenceScore >= 70 ? detection.price : product.retailPrice,
        verificationStatus: detection.identityMatch.verificationStatus,
        verifiedAt: now,
        verifiedFinalUrl: detection.finalUrl,
        verificationNotes: detection.identityMatch.notes.join(". "),
        imageUrl: detection.imageUrl ?? product.imageUrl,
        liveTitle: detection.title,
        livePrice: detection.price,
        livePriceSource: detection.price === null ? null : "Retailer page",
        livePriceVerifiedAt: detection.price === null ? undefined : now,
        liveStockStatus: change.nextStatus,
        liveStockVerifiedAt: now,
        liveImageUrl: detection.imageUrl,
        liveConfidenceScore: detection.confidenceScore,
        liveBlockedType: null,
        isDemoData: detection.price !== null || detection.status !== null ? false : product.isDemoData,
        lastCheckedAt: now,
        lastSuccessfulCheckedAt: now,
        nextCheckAt: nextCheckAt(product.checkFrequencyMinutes),
        lastMonitorResult: monitorResult,
        lastMonitorError: null,
        lastPageHash: detection.pageHash,
        lastAlertSentAt: alertSent ? now : product.lastAlertSentAt,
        alertStatus: actionableStatuses.includes(change.nextStatus),
        ...pendingClear()
      }
    });

    const log = await createMonitorLog({
      productId,
      runType,
      status: change.changed ? "CHANGED" : "SUCCESS",
      previousStatus: product.stockStatus,
      detectedStatus: change.nextStatus,
      previousPrice: product.livePrice ?? product.retailPrice,
      detectedPrice: detection.price,
      changeSummary: monitorResult,
      httpStatus: detection.httpStatus,
      finalUrl: detection.finalUrl,
      responseTimeMs: detection.responseTimeMs,
      detectedWords: detection.detectedWords,
      confidenceScore: detection.confidenceScore,
      reason: detection.reason,
      parsedStockText: detection.parsedStockText,
      addToCartEnabled: detection.addToCartEnabled,
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
      confidenceScore: detection.confidenceScore,
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
    return { checked: 0, changed: 0, errors: 0, blocked: 0, pending: 0, results, logId: log.id };
  }

  return {
    checked: results.length,
    changed: results.filter((result) => result.status === "CHANGED").length,
    errors: results.filter((result) => result.status === "ERROR").length,
    blocked: results.filter((result) => result.status === "BLOCKED").length,
    pending: results.filter((result) => result.status === "PENDING_CONFIRMATION").length,
    results
  };
}
