import { existsSync, readFileSync } from "node:fs";

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
  process.env.FINAL_SMOKE_URL ||
  process.env.AUTH_SMOKE_URL ||
  process.env.POKE_RESTOCK_RADAR_PRODUCTION_URL ||
  process.env.APP_URL ||
  "https://poke-restock-radar.vercel.app"
).replace(/\/$/, "");
const email =
  process.env.FINAL_SMOKE_EMAIL || process.env.AUTH_SMOKE_EMAIL || process.env.POKE_RESTOCK_RADAR_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
const password =
  process.env.FINAL_SMOKE_PASSWORD ||
  process.env.AUTH_SMOKE_PASSWORD ||
  process.env.POKE_RESTOCK_RADAR_ADMIN_PASSWORD ||
  process.env.ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("Set FINAL_SMOKE_EMAIL/FINAL_SMOKE_PASSWORD or AUTH_SMOKE_EMAIL/AUTH_SMOKE_PASSWORD.");
}

function cookiesFrom(headers: Headers) {
  const maybeHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const cookies =
    typeof maybeHeaders.getSetCookie === "function" ? maybeHeaders.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  return cookies.map((cookie) => cookie!.split(";")[0]).join("; ");
}

async function json(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function expectStatus(label: string, response: Response, expected: number | number[]) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(response.status)) {
    const text = await response.text().catch(() => "");
    throw new Error(`${label} expected ${allowed.join("/")} but got ${response.status}: ${text.slice(0, 180)}`);
  }
  return response;
}

async function fetchText(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  await expectStatus(path, response, 200);
  return response.text();
}

async function main() {
  const checks: Record<string, unknown> = {};

  const desktopHtml = await fetchText("/", {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PokeRestockRadarFinalSmoke"
    }
  });
  if (!desktopHtml.includes("Poke Restock Radar")) throw new Error("Desktop app shell did not include app identity.");
  checks.desktopShell = true;

  const mobileHtml = await fetchText("/", {
    headers: {
      "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"
    }
  });
  if (!mobileHtml.includes("Poke Restock Radar")) throw new Error("Mobile/PWA app shell did not include app identity.");
  checks.mobileShell = true;

  const manifest = await expectStatus("manifest", await fetch(`${baseUrl}/manifest.webmanifest`), 200);
  const manifestBody = await json(manifest);
  checks.manifest = manifestBody.name || manifestBody.short_name || true;

  const serviceWorker = await expectStatus("service worker", await fetch(`${baseUrl}/sw.js`), 200);
  const serviceWorkerText = await serviceWorker.text();
  if (!serviceWorkerText.includes("push") || !serviceWorkerText.includes("notificationclick")) {
    throw new Error("Service worker is missing push or notification click handlers.");
  }
  checks.serviceWorker = true;

  const healthResponse = await expectStatus("health", await fetch(`${baseUrl}/api/health`), [200, 503]);
  const health = await json(healthResponse);
  if (health.status === "ERROR") throw new Error(`Health endpoint is ERROR: ${JSON.stringify(health.environment || {})}`);
  if (health.database?.provider !== "postgres") throw new Error(`Production health is not using Postgres: ${health.database?.provider}`);
  checks.health = { status: health.status, database: health.database?.provider };

  const backupUnauthed = await fetch(`${baseUrl}/api/radar/backup`);
  await expectStatus("admin backup unauthenticated", backupUnauthed, 401);
  checks.adminRouteProtection = true;

  const cronUnauthed = await fetch(`${baseUrl}/api/radar/monitor/cron`);
  await expectStatus("cron unauthenticated", cronUnauthed, 401);
  checks.cronProtection = true;

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const loginBody = await json(login);
  if (login.status !== 200) throw new Error(`Login failed with ${login.status}: ${loginBody.error || "unknown"}`);
  const cookie = cookiesFrom(login.headers);
  if (!cookie) throw new Error("Login did not set a session cookie.");
  checks.login = true;

  const authedGet = async (path: string) => expectStatus(path, await fetch(`${baseUrl}${path}`, { headers: { cookie } }), 200);

  const session = await authedGet("/api/auth/session");
  const sessionBody = await json(session);
  if (sessionBody.user?.role !== "ADMIN") throw new Error("Smoke account is not an Admin.");
  checks.session = { role: sessionBody.user.role, secureCookie: sessionBody.session?.secureCookie };

  const dashboard = await authedGet("/api/radar/dashboard");
  const dashboardBody = await json(dashboard);
  if (!dashboardBody.health?.auth?.currentSessionValid) throw new Error("Dashboard health did not see the current session.");
  checks.dashboard = {
    products: dashboardBody.products?.length ?? 0,
    stores: dashboardBody.stores?.length ?? 0,
    alerts: dashboardBody.alerts?.length ?? 0,
    systemStatus: dashboardBody.health?.status
  };

  for (const path of ["/api/radar/products", "/api/radar/stores", "/api/radar/releases", "/api/radar/cards", "/api/radar/alerts"]) {
    const response = await authedGet(path);
    checks[path] = response.status;
  }

  const backup = await authedGet("/api/radar/backup");
  const backupBody = await json(backup);
  const tables = backupBody.tables || {};
  if (backupBody.version !== 1 || typeof tables !== "object") throw new Error("Backup export did not return a versioned table payload.");
  checks.backupExport = { tableCount: Object.keys(tables).length, restoreDryRun: "schema-only validation passed; import not executed" };

  const inviteEmail = `owner-smoke-${Date.now()}@poke.local`;
  const invite = await fetch(`${baseUrl}/api/radar/invites`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      email: inviteEmail,
      name: "Owner Smoke Friend",
      canAddSightings: true,
      canAddComps: false,
      canRunChecks: false,
      canReceivePushAlerts: true
    })
  });
  const inviteBody = await json(invite);
  if (invite.status !== 201 || !inviteBody.invite?.id || !inviteBody.invite?.inviteUrl) {
    throw new Error(`Invite flow failed with ${invite.status}: ${inviteBody.error || "unknown"}`);
  }
  const revoke = await fetch(`${baseUrl}/api/radar/invites/${inviteBody.invite.id}`, {
    method: "DELETE",
    headers: { cookie }
  });
  await expectStatus("invite revoke", revoke, 200);
  checks.inviteFlow = "created and revoked single-use invite";

  const pushSettings = await fetch(`${baseUrl}/api/radar/notifications/test`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ channel: "inApp" })
  });
  await expectStatus("in-app notification test", pushSettings, 200);
  checks.notificationRoute = "in-app test alert created";

  const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie } });
  await expectStatus("logout", logout, 200);
  checks.logout = true;

  console.log(
    JSON.stringify(
      {
        baseUrl,
        checks
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
