const healthUrl = process.env.PRODUCTION_HEALTH_URL || "https://www.gamedaygrabs.com/api/health";
const storefrontSearchUrl =
  process.env.PRODUCTION_STOREFRONT_SEARCH_URL ||
  new URL("/api/storefront/shop/search?availability=all&pageSize=50", healthUrl).toString();
const expectedCommit = (process.env.EXPECTED_BUILD_COMMIT || "").trim().toLowerCase();
const retrySeconds = Number.parseInt(process.env.HEALTH_RETRY_SECONDS || "120", 10);
const intervalMs = Number.parseInt(process.env.HEALTH_RETRY_INTERVAL_MS || "30000", 10);
const minStorefrontProducts = Number.parseInt(process.env.PRODUCTION_STOREFRONT_MIN_PRODUCTS || "1", 10);
const allowEmptyStorefront = process.env.ALLOW_EMPTY_PRODUCTION_STOREFRONT === "true";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function isMatchingCommit(reportedCommit) {
  if (!expectedCommit) return true;
  const reported = String(reportedCommit || "").trim().toLowerCase();
  if (!reported) return false;
  return expectedCommit.startsWith(reported) || reported.startsWith(expectedCommit);
}

function describeHealth(health) {
  return {
    status: health?.status,
    databaseOk: health?.databaseOk,
    warningCount: health?.warningCount,
    warningCategories: health?.warningCategories,
    buildCommit: health?.buildCommit
  };
}

async function fetchHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(healthUrl, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;

    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Health endpoint returned non-JSON response with HTTP ${response.status}.`);
    }

    return { httpStatus: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

function isPreviewQaProduct(product) {
  const tags = Array.isArray(product?.tags) ? product.tags.map((tag) => String(tag).toLowerCase()) : [];
  const text = [
    product?.title,
    product?.description,
    product?.category,
    product?.setName,
    product?.brand,
    product?.manufacturer,
    product?.sku,
    product?.upc
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    tags.includes("preview") ||
    tags.includes("qa") ||
    tags.includes("stripe-test") ||
    /preview\s+(stripe|webhook|qa)/i.test(text) ||
    /stripe\s+webhook\s+test/i.test(text) ||
    /preview\s+qa\s+set/i.test(text) ||
    /gamedaygrabs\s+preview/i.test(text) ||
    /\bPREVIEW[-_]/i.test(String(product?.sku || "")) ||
    product?.upc === "000000000001"
  );
}

async function fetchStorefrontSearch() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(storefrontSearchUrl, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;

    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`Storefront search returned non-JSON response with HTTP ${response.status}.`);
    }

    return { httpStatus: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

async function assertPublicStorefrontDataSafe() {
  const { httpStatus, json } = await fetchStorefrontSearch();
  if (httpStatus >= 500) {
    throw new Error(`Storefront search returned HTTP ${httpStatus}.`);
  }

  const products = Array.isArray(json?.products) ? json.products : [];
  const previewProducts = products.filter(isPreviewQaProduct);

  console.log(
    `Production storefront data check: ${products.length} visible product(s), ${previewProducts.length} preview/QA product(s).`
  );

  if (previewProducts.length > 0) {
    const names = previewProducts.map((product) => product.title || product.slug || product.id || "unnamed").slice(0, 5).join(", ");
    throw new Error(`Preview/QA storefront products are visible in production: ${names}`);
  }

  if (!allowEmptyStorefront && products.length < minStorefrontProducts) {
    throw new Error(
      `Production storefront has ${products.length} visible real product(s); expected at least ${minStorefrontProducts}. Check Vercel Production database variables before considering this healthy.`
    );
  }
}

async function main() {
  const deadline = Date.now() + Math.max(0, retrySeconds) * 1000;
  let lastError = null;
  let attempts = 0;

  do {
    attempts += 1;

    try {
      const { httpStatus, json } = await fetchHealth();
      const health = describeHealth(json);
      const appStatus = normalizeStatus(json?.status);
      const databaseOk = json?.databaseOk === true;
      const commitMatches = isMatchingCommit(json?.buildCommit);

      console.log(
        `Production health attempt ${attempts}: HTTP ${httpStatus}, status ${health.status}, database ${databaseOk ? "OK" : "ERROR"}, commit ${health.buildCommit || "missing"}.`
      );

      if (httpStatus >= 500) {
        throw new Error(`Production health returned HTTP ${httpStatus}.`);
      }
      if (appStatus === "ERROR") {
        throw new Error(`Production health status is ERROR: ${JSON.stringify(health)}`);
      }
      if (!databaseOk) {
        throw new Error(`Production database health is not OK: ${JSON.stringify(health)}`);
      }
      if (!commitMatches) {
        throw new Error(
          `Production build commit ${health.buildCommit || "missing"} does not match expected ${expectedCommit.slice(0, 12)}.`
        );
      }

      console.log(`Production health is passing: ${JSON.stringify(health)}`);
      await assertPublicStorefrontDataSafe();
      return;
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) break;
      console.log(`${error instanceof Error ? error.message : String(error)} Retrying...`);
      await sleep(intervalMs);
    }
  } while (Date.now() < deadline);

  throw lastError || new Error("Production health check failed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
