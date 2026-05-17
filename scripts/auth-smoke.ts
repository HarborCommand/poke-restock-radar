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
  process.env.AUTH_SMOKE_URL ||
  process.env.POKE_RESTOCK_RADAR_PRODUCTION_URL ||
  process.env.APP_URL ||
  "http://localhost:3020";
const email =
  process.env.AUTH_SMOKE_EMAIL || process.env.POKE_RESTOCK_RADAR_ADMIN_EMAIL || process.env.ADMIN_EMAIL;
const password =
  process.env.AUTH_SMOKE_PASSWORD || process.env.POKE_RESTOCK_RADAR_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("Set AUTH_SMOKE_EMAIL/AUTH_SMOKE_PASSWORD or POKE_RESTOCK_RADAR_ADMIN_EMAIL/POKE_RESTOCK_RADAR_ADMIN_PASSWORD.");
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

async function login(userAgent = "PokeRestockRadarAuthSmoke/1.0") {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": userAgent },
    body: JSON.stringify({ email, password })
  });
  const body = await json(response);
  if (response.status !== 200) {
    throw new Error(`Login failed with ${response.status}: ${body.error || "unknown error"}`);
  }
  const cookie = cookiesFrom(response.headers);
  if (!cookie) throw new Error("Login did not set a session cookie.");
  return { response, body, cookie };
}

async function main() {
  const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "definitely-wrong-password-123" })
  });
  if (badLogin.status !== 401) throw new Error(`Invalid login should return 401, got ${badLogin.status}.`);

  const browserLogin = await login();
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: browserLogin.cookie } });
  const sessionBody = await json(session);
  if (session.status !== 200 || !sessionBody.user?.email) throw new Error("Session was not persisted after login.");

  const dashboard = await fetch(`${baseUrl}/api/radar/dashboard`, { headers: { cookie: browserLogin.cookie } });
  if (dashboard.status !== 200) throw new Error(`Dashboard auth check failed with ${dashboard.status}.`);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { cookie: browserLogin.cookie }
  });
  if (logout.status !== 200) throw new Error(`Logout failed with ${logout.status}.`);
  const loggedOutCookie = cookiesFrom(logout.headers) || browserLogin.cookie;
  const loggedOutSession = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: loggedOutCookie } });
  const loggedOutBody = await json(loggedOutSession);
  if (loggedOutBody.user) throw new Error("Session still returned a user after logout.");

  const mobileLogin = await login(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 PokeRestockRadarPWA"
  );
  const mobileSession = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: mobileLogin.cookie } });
  const mobileSessionBody = await json(mobileSession);
  if (!mobileSessionBody.user?.email) throw new Error("Mobile/PWA-style login did not persist a session.");

  console.log(
    JSON.stringify(
      {
        baseUrl,
        invalidLoginStatus: badLogin.status,
        loginStatus: browserLogin.response.status,
        sessionStatus: session.status,
        dashboardStatus: dashboard.status,
        logoutStatus: logout.status,
        loggedOutSessionUser: Boolean(loggedOutBody.user),
        mobileSessionStatus: mobileSession.status,
        mobileSessionUser: Boolean(mobileSessionBody.user),
        sessionCookieName: sessionBody.session?.cookieName || null,
        secureCookie: sessionBody.session?.secureCookie ?? null
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
