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

const baseUrl =
  process.env.ALERT_SMOKE_URL ||
  process.env.AUTH_SMOKE_URL ||
  process.env.POKE_RESTOCK_RADAR_PRODUCTION_URL ||
  process.env.APP_URL ||
  "http://localhost:3020";
const email =
  process.env.ALERT_SMOKE_EMAIL || process.env.AUTH_SMOKE_EMAIL || process.env.POKE_RESTOCK_RADAR_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
const password =
  process.env.ALERT_SMOKE_PASSWORD ||
  process.env.AUTH_SMOKE_PASSWORD ||
  process.env.POKE_RESTOCK_RADAR_ADMIN_PASSWORD ||
  process.env.ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("Set ALERT_SMOKE_EMAIL/ALERT_SMOKE_PASSWORD or AUTH_SMOKE_EMAIL/AUTH_SMOKE_PASSWORD.");
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

async function main() {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const loginBody = await json(login);
  if (login.status !== 200) throw new Error(`Login failed with ${login.status}: ${loginBody.error || "unknown error"}`);
  const cookie = cookiesFrom(login.headers);

  const inApp = await fetch(`${baseUrl}/api/radar/notifications/test`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ channel: "inApp" })
  });
  const inAppBody = await json(inApp);
  if (inApp.status !== 200) throw new Error(`In-app alert test failed with ${inApp.status}: ${inAppBody.error || "unknown"}`);

  const all = await fetch(`${baseUrl}/api/radar/notifications/test-all`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie }
  });
  const allBody = await json(all);
  if (all.status !== 200) throw new Error(`All-alert smoke failed with ${all.status}: ${allBody.error || "unknown"}`);

  const alerts = await fetch(`${baseUrl}/api/radar/alerts`, { headers: { cookie } });
  const alertsBody = await json(alerts);
  if (alerts.status !== 200 || !Array.isArray(alertsBody.alerts)) throw new Error("Alerts endpoint did not return alerts.");

  console.log(
    JSON.stringify(
      {
        baseUrl,
        loginStatus: login.status,
        inAppStatus: inApp.status,
        testAllStatus: all.status,
        alertCount: alertsBody.alerts.length,
        routesChecked: allBody.routes?.length ?? 0
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
