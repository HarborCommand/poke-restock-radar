import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    if (process.env[key]) continue;
    process.env[key] = match[2].trim().replace(/^"|"$/g, "");
  }
}

loadEnvFile(".env");
loadEnvFile(".env.production.local");

const baseUrl = (process.env.POS_VIEWPORT_QA_URL || process.env.VIEWPORT_QA_URL || "http://127.0.0.1:3031").replace(
  /\/$/,
  ""
);
const origin = new URL(baseUrl).origin;
const email =
  process.env.POS_VIEWPORT_QA_EMAIL ||
  process.env.VIEWPORT_QA_EMAIL ||
  process.env.FINAL_SMOKE_EMAIL ||
  process.env.AUTH_SMOKE_EMAIL ||
  process.env.POKE_RESTOCK_RADAR_ADMIN_EMAIL ||
  process.env.ADMIN_EMAIL;
const password =
  process.env.POS_VIEWPORT_QA_PASSWORD ||
  process.env.VIEWPORT_QA_PASSWORD ||
  process.env.FINAL_SMOKE_PASSWORD ||
  process.env.AUTH_SMOKE_PASSWORD ||
  process.env.POKE_RESTOCK_RADAR_ADMIN_PASSWORD ||
  process.env.ADMIN_PASSWORD;

const viewports = [
  { label: "phone-390", width: 390, height: 844 },
  { label: "ipad-768", width: 768, height: 1024 },
  { label: "ipad-landscape-1024", width: 1024, height: 768 },
  { label: "desktop-1440", width: 1440, height: 960 }
];

if (!email || !password) {
  throw new Error("Set POS_VIEWPORT_QA_EMAIL/POS_VIEWPORT_QA_PASSWORD or the shared viewport QA credentials.");
}

function cookiePairs(headers: Headers) {
  const headerSource = headers as Headers & { getSetCookie?: () => string[] };
  const cookies =
    typeof headerSource.getSetCookie === "function" ? headerSource.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  return cookies.map((cookie) => {
    const [pair] = cookie!.split(";");
    const [name, ...valueParts] = pair.split("=");
    return { name, value: valueParts.join("="), url: origin };
  });
}

async function loginCookies() {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "sec-fetch-site": "same-origin"
    },
    body: JSON.stringify({ email, password })
  });
  const bodyText = await response.text();
  if (response.status !== 200) {
    throw new Error(`POS viewport QA login failed with ${response.status}: ${bodyText.slice(0, 180)}`);
  }
  const cookies = cookiePairs(response.headers);
  if (!cookies.length) throw new Error("POS viewport QA login did not return a session cookie.");
  return cookies;
}

async function launchBrowser() {
  const channel = process.env.PLAYWRIGHT_CHANNEL || "msedge";
  try {
    return await chromium.launch({ channel, headless: true });
  } catch (channelError) {
    try {
      return await chromium.launch({ channel: "chrome", headless: true });
    } catch {
      throw channelError;
    }
  }
}

async function openPos(browser: Browser, viewport: (typeof viewports)[number], cookies: Awaited<ReturnType<typeof loginCookies>>) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    hasTouch: true
  });
  await context.addCookies(cookies);
  const page = await context.newPage();
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
  await page.goto(`${origin}/pos?source=pos-pwa`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-pos-register-view="checkout"][data-pos-authenticated="true"]', { timeout: 15_000 });
  await page.waitForSelector(".pos-product-card", { timeout: 15_000 });
  return { context, page, consoleMessages };
}

async function addVisibleProducts(page: Page) {
  await page.evaluate(async () => {
    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    for (let pass = 0; pass < 4; pass += 1) {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".pos-product-card .pos-add-button")).filter(
        (button) => !button.disabled
      );
      for (const button of buttons.slice(0, 8)) {
        button.click();
        await wait(70);
      }
      if (document.querySelectorAll(".pos-cart-line").length >= 4) break;
      document.querySelector(".pos-result-grid")?.scrollBy({ top: 420, behavior: "instant" });
      await wait(120);
    }
  });
  await page.waitForTimeout(500);
}

async function measurePos(page: Page) {
  return page.evaluate(async () => {
    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
    const root = document.querySelector<HTMLElement>('[data-pos-register-view="checkout"]');
    const appMain = document.querySelector<HTMLElement>(".app-main");
    const workspace = document.querySelector<HTMLElement>(".pos-workspace");
    const productGrid = document.querySelector<HTMLElement>(".pos-result-grid");
    const cartPanel = document.querySelector<HTMLElement>(".pos-cart-panel");
    const cartLines = document.querySelector<HTMLElement>(".pos-cart-lines");
    const charge = document.querySelector<HTMLElement>('[aria-label="Checkout action"]');

    const box = (element: HTMLElement | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        overflowY: style.overflowY,
        position: style.position,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
      };
    };

    window.scrollTo(0, 200);
    await wait(80);

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        visualHeight: Math.round(window.visualViewport?.height || window.innerHeight)
      },
      lock: {
        html: document.documentElement.getAttribute("data-pos-viewport-locked"),
        body: document.body.getAttribute("data-pos-viewport-locked"),
        scrollY: window.scrollY
      },
      body: {
        scrollHeight: document.body.scrollHeight,
        clientHeight: document.body.clientHeight,
        overflowY: window.getComputedStyle(document.body).overflowY,
        position: window.getComputedStyle(document.body).position
      },
      document: {
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        overflowY: window.getComputedStyle(document.documentElement).overflowY
      },
      counts: {
        products: document.querySelectorAll(".pos-product-card").length,
        cartLines: document.querySelectorAll(".pos-cart-line").length
      },
      root: box(root),
      appMain: box(appMain),
      workspace: box(workspace),
      productGrid: box(productGrid),
      cartPanel: box(cartPanel),
      cartLines: box(cartLines),
      charge: box(charge),
      pinnedCheckout: Boolean(document.querySelector('[aria-label="Pinned checkout action"]'))
    };
  });
}

function assertPosLayout(label: string, result: Awaited<ReturnType<typeof measurePos>>) {
  const viewportBottom = result.viewport.visualHeight;
  const failures: string[] = [];
  if (result.lock.html !== "true" || result.lock.body !== "true") failures.push("page viewport lock is not active");
  if (result.lock.scrollY !== 0) failures.push(`window scrolled to ${result.lock.scrollY}`);
  if (result.body.position === "fixed") failures.push("body is fixed; Home Screen POS can snap back like a cropped app image");
  if (result.body.overflowY !== "hidden") failures.push(`body overflow-y is ${result.body.overflowY}, expected hidden`);
  if (!result.productGrid || result.productGrid.overflowY !== "auto") failures.push("product grid is not the product scroll pane");
  if (!result.cartPanel || result.cartPanel.overflowY !== "hidden") failures.push("cart panel is scrolling instead of framing current sale");
  if (!result.cartLines || result.cartLines.overflowY !== "auto") failures.push("cart lines are not the cart scroll pane");
  if (!result.charge) failures.push("charge footer is missing");
  if (result.charge && result.charge.bottom > viewportBottom + 1) {
    failures.push(`charge footer bottom ${result.charge.bottom} exceeds viewport ${viewportBottom}`);
  }
  if (result.pinnedCheckout) failures.push("old pinned checkout overlay is still mounted");
  if (result.counts.cartLines < 1) failures.push("no cart lines were added for measurement");
  if (failures.length) {
    throw new Error(`${label} POS layout failed: ${failures.join("; ")} ${JSON.stringify(result)}`);
  }
}

async function runViewport(
  browser: Browser,
  viewport: (typeof viewports)[number],
  cookies: Awaited<ReturnType<typeof loginCookies>>
) {
  let context: BrowserContext | null = null;
  try {
    const opened = await openPos(browser, viewport, cookies);
    context = opened.context;
    await addVisibleProducts(opened.page);
    const result = await measurePos(opened.page);
    assertPosLayout(viewport.label, result);
    if (opened.consoleMessages.length) {
      throw new Error(`${viewport.label} console warnings/errors: ${opened.consoleMessages.slice(0, 5).join(" | ")}`);
    }
    const screenshot = join(tmpdir(), `poke-restock-radar-pos-${viewport.label}.png`);
    await opened.page.screenshot({ path: screenshot, fullPage: false });
    return { viewport: viewport.label, screenshot, result };
  } finally {
    await context?.close();
  }
}

async function main() {
  const cookies = await loginCookies();
  const browser = await launchBrowser();
  try {
    const results = [];
    for (const viewport of viewports) {
      results.push(await runViewport(browser, viewport, cookies));
    }
    console.log(JSON.stringify({ baseUrl: origin, results }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
