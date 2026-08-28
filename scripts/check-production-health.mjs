const healthUrl = process.env.PRODUCTION_HEALTH_URL || "https://www.gamedaygrabs.com/api/health";
const expectedCommit = (process.env.EXPECTED_BUILD_COMMIT || "").trim().toLowerCase();
const retrySeconds = Number.parseInt(process.env.HEALTH_RETRY_SECONDS || "120", 10);
const intervalMs = Number.parseInt(process.env.HEALTH_RETRY_INTERVAL_MS || "30000", 10);

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
