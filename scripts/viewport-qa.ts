import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";

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

const baseUrl = (
  process.env.VIEWPORT_QA_URL ||
  process.env.FINAL_SMOKE_URL ||
  process.env.AUTH_SMOKE_URL ||
  process.env.POKE_RESTOCK_RADAR_PRODUCTION_URL ||
  process.env.APP_URL ||
  "https://poke-restock-radar.vercel.app"
).replace(/\/$/, "");

const email =
  process.env.VIEWPORT_QA_EMAIL ||
  process.env.FINAL_SMOKE_EMAIL ||
  process.env.AUTH_SMOKE_EMAIL ||
  process.env.POKE_RESTOCK_RADAR_ADMIN_EMAIL ||
  process.env.ADMIN_EMAIL;
const password =
  process.env.VIEWPORT_QA_PASSWORD ||
  process.env.FINAL_SMOKE_PASSWORD ||
  process.env.AUTH_SMOKE_PASSWORD ||
  process.env.POKE_RESTOCK_RADAR_ADMIN_PASSWORD ||
  process.env.ADMIN_PASSWORD;

const viewports = [
  { label: "mobile-390", width: 390, height: 844 },
  { label: "tablet-768", width: 768, height: 1024 },
  { label: "desktop-1440", width: 1440, height: 960 }
];
const tabs = ["Dashboard", "Products", "Stores", "Field"] as const;

if (!email || !password) {
  throw new Error("Set VIEWPORT_QA_EMAIL/VIEWPORT_QA_PASSWORD or FINAL_SMOKE_EMAIL/FINAL_SMOKE_PASSWORD.");
}

function cookiePairs(headers: Headers) {
  const headerSource = headers as Headers & { getSetCookie?: () => string[] };
  const cookies =
    typeof headerSource.getSetCookie === "function" ? headerSource.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  return cookies.map((cookie) => {
    const [pair] = cookie!.split(";");
    const [name, ...valueParts] = pair.split("=");
    return { name, value: valueParts.join("=") };
  });
}

async function launchBrowser() {
  const channel = process.env.PLAYWRIGHT_CHANNEL || "msedge";
  try {
    return await chromium.launch({ channel, headless: true });
  } catch (channelError) {
    try {
      return await chromium.launch({ headless: true });
    } catch {
      throw channelError;
    }
  }
}

async function loginCookies() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const bodyText = await response.text();
  if (response.status !== 200) {
    throw new Error(`Viewport QA login failed with ${response.status}: ${bodyText.slice(0, 180)}`);
  }
  const cookies = cookiePairs(response.headers);
  if (!cookies.length) throw new Error("Viewport QA login did not return a session cookie.");
  return cookies.map((cookie) => ({ ...cookie, url: baseUrl }));
}

async function openAuthedPage(browser: Browser, viewport: (typeof viewports)[number], cookies: Awaited<ReturnType<typeof loginCookies>>) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1
  });
  await context.addCookies(cookies);
  const page = await context.newPage();
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) consoleMessages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  return { context, page, consoleMessages };
}

async function clickTab(page: Page, tab: (typeof tabs)[number]) {
  if (tab === "Dashboard") return;
  await page.getByRole("button", { name: tab, exact: true }).click();
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const bodyScrollWidth = document.body.scrollWidth;
    const documentScrollWidth = document.documentElement.scrollWidth;
    const visibleElements = Array.from(document.body.querySelectorAll<HTMLElement>("*")).filter((element) => {
      const style = window.getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        box.width > 0 &&
        box.height > 0 &&
        box.bottom >= 0 &&
        box.top <= window.innerHeight
      );
    });
    const overflowingElements = visibleElements
      .map((element) => {
        const box = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className.toString().slice(0, 120),
          text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 100) || "",
          left: Math.round(box.left),
          right: Math.round(box.right),
          width: Math.round(box.width)
        };
      })
      .filter((box) => box.left < -1 || box.right > viewportWidth + 1)
      .slice(0, 8);
    const imageLeaks = Array.from(document.querySelectorAll<HTMLElement>(".product-image-frame"))
      .map((frame) => {
        const image = frame.querySelector("img");
        if (!image) return null;
        const frameBox = frame.getBoundingClientRect();
        const imageBox = image.getBoundingClientRect();
        const leaks =
          imageBox.left < frameBox.left - 1 ||
          imageBox.right > frameBox.right + 1 ||
          imageBox.top < frameBox.top - 1 ||
          imageBox.bottom > frameBox.bottom + 1;
        return leaks
          ? {
              frame: {
                left: Math.round(frameBox.left),
                right: Math.round(frameBox.right),
                top: Math.round(frameBox.top),
                bottom: Math.round(frameBox.bottom)
              },
              image: {
                left: Math.round(imageBox.left),
                right: Math.round(imageBox.right),
                top: Math.round(imageBox.top),
                bottom: Math.round(imageBox.bottom)
              }
            }
          : null;
      })
      .filter(Boolean);
    return {
      viewportWidth,
      bodyScrollWidth,
      documentScrollWidth,
      overflowingElements,
      imageLeaks,
      productImageFrames: document.querySelectorAll(".product-image-frame").length
    };
  });
}

async function runViewport(browser: Browser, viewport: (typeof viewports)[number], cookies: Awaited<ReturnType<typeof loginCookies>>) {
  const { context, page, consoleMessages } = await openAuthedPage(browser, viewport, cookies);
  const checks = [];
  try {
    for (const tab of tabs) {
      await clickTab(page, tab);
      const result = await measure(page);
      const screenshot = join(tmpdir(), `poke-restock-radar-${viewport.label}-${tab.toLowerCase()}.png`);
      await page.screenshot({ path: screenshot, fullPage: false });
      const horizontalOverflow =
        result.bodyScrollWidth > result.viewportWidth || result.documentScrollWidth > result.viewportWidth;
      const passed = !horizontalOverflow && result.overflowingElements.length === 0 && result.imageLeaks.length === 0;
      checks.push({ tab, passed, screenshot, ...result });
      if (!passed) {
        throw new Error(`${viewport.label} ${tab} layout overflow: ${JSON.stringify(result)}`);
      }
    }
    if (consoleMessages.length) {
      throw new Error(`${viewport.label} console warnings/errors: ${consoleMessages.slice(0, 5).join(" | ")}`);
    }
    return { viewport: viewport.label, checks, consoleMessages };
  } finally {
    await context.close();
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
    console.log(JSON.stringify({ baseUrl, results }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
