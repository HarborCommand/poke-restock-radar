import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();

function allProjectFiles(dir = root) {
  const output = [];
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) output.push(...allProjectFiles(path));
    else output.push(path);
  }
  return output;
}

test("Phase 1 package scripts are present", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const script of [
    "dev",
    "build",
    "check",
    "lint",
    "test",
    "qa:viewport",
    "monitor",
    "backup:json",
    "restore:json",
    "backup:postgres",
    "restore:postgres",
    "secrets:generate",
    "vapid:generate",
    "prisma:postgres",
    "db:push",
    "db:push:prod",
    "db:seed",
    "db:migrate:prod",
    "db:seed:prod",
    "vercel-build"
  ]) {
    assert.ok(pkg.scripts[script], `missing ${script}`);
  }
});

test("required data models exist", () => {
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  const models = [
    "User",
    "PasswordResetToken",
    "FriendInvite",
    "AuditLog",
    "Product",
    "Retailer",
    "Store",
    "StoreSighting",
    "Release",
    "Alert",
    "RestockHistory",
    "MonitorLog",
    "Card",
    "CardPriceSnapshot",
    "CardCompSale",
    "InvestmentReport",
    "ProductPriorityScore",
    "NotificationSettings",
    "InvestmentSettings",
    "BrowserPushSubscription"
  ];
  for (const model of models) {
    assert.match(schema, new RegExp(`model\\s+${model}\\s+\\{`), `missing model ${model}`);
  }
});

test("Phase 14 invite-only friend access controls exist", () => {
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const field of [
    "canAddSightings",
    "canAddComps",
    "canRunChecks",
    "canReceivePushAlerts",
    "disabledAt",
    "FriendInvite",
    "AuditLog"
  ]) {
    assert.match(schema, new RegExp(field), `missing Phase 14 schema field ${field}`);
  }

  const files = [
    join(root, "src", "app", "api", "auth", "invite", "accept", "route.ts"),
    join(root, "src", "app", "api", "radar", "invites", "route.ts"),
    join(root, "src", "app", "api", "radar", "users", "[userId]", "route.ts"),
    join(root, "src", "lib", "access.ts"),
    join(root, "src", "lib", "audit.ts")
  ];
  for (const file of files) {
    assert.ok(statSync(file).isFile(), `missing ${file}`);
  }

  const auth = readFileSync(join(root, "src", "lib", "auth.ts"), "utf8");
  assert.match(auth, /requirePermission/);
  assert.match(auth, /disabledAt/);

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of ["User Management", "No public signup", "Single-use invite link", "Accept Friend Invite", "Audit Log"]) {
    assert.match(app, new RegExp(phrase), `missing Phase 14 UI phrase ${phrase}`);
  }

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /Phase 14 Friend Access/);
  assert.match(readme, /invite-only/);
});

test("Phase 15 daily workflow inventory and recap features exist", () => {
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const model of ["InventoryItem", "DailyRecap", "SavedFilterPreset"]) {
    assert.match(schema, new RegExp(`model\\s+${model}\\s+\\{`), `missing Phase 15 model ${model}`);
  }

  const files = [
    join(root, "src", "app", "api", "radar", "inventory", "route.ts"),
    join(root, "src", "app", "api", "radar", "daily-recaps", "route.ts"),
    join(root, "src", "app", "api", "radar", "filter-presets", "route.ts"),
    join(root, "src", "app", "api", "radar", "products", "[productId]", "checked", "route.ts"),
    join(root, "src", "app", "api", "radar", "products", "[productId]", "bought", "route.ts")
  ];
  for (const file of files) {
    assert.ok(statSync(file).isFile(), `missing ${file}`);
  }

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of [
    "Today.*s Plan",
    "Quick Add Product",
    "Mark Checked Today",
    "I Bought This",
    "Inventory Log",
    "Saved Filter Presets",
    "Daily Recap Archive"
  ]) {
    assert.match(app, new RegExp(phrase), `missing Phase 15 UI phrase ${phrase}`);
  }

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /Phase 15 Daily Workflow/);
});

test("Phase 16 alert intelligence and noise controls exist", () => {
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const field of [
    "score",
    "dedupeKey",
    "explanation",
    "falsePositiveAt",
    "suppressedAt",
    "alertDigestMode",
    "urgentOnlyMode",
    "highPriorityOverride",
    "watchedRetailers",
    "watchedProducts",
    "alertCooldownMinutes"
  ]) {
    assert.match(schema, new RegExp(field), `missing Phase 16 schema field ${field}`);
  }

  const notifications = readFileSync(join(root, "src", "lib", "notifications.ts"), "utf8");
  for (const phrase of ["alertScore", "alertDedupeKey", "Duplicate/cooldown suppression", "Urgent-only mode", "Watch-only filters"]) {
    assert.match(notifications, new RegExp(phrase), `missing Phase 16 notification phrase ${phrase}`);
  }

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of ["Alert History Analytics", "Why:", "False Positive", "Alert digest mode", "Urgent-only mode", "Watch only retailers"]) {
    assert.match(app, new RegExp(phrase), `missing Phase 16 UI phrase ${phrase}`);
  }

  assert.ok(statSync(join(root, "scripts", "alert-smoke.ts")).isFile(), "missing alert smoke script");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(pkg.scripts["alert:smoke"], "missing alert:smoke script");
});

test("Phase 17 production hardening and owner QA pieces exist", () => {
  const files = [
    join(root, "src", "app", "error.tsx"),
    join(root, "src", "app", "not-found.tsx"),
    join(root, "scripts", "final-production-smoke.ts")
  ];
  for (const file of files) {
    assert.ok(statSync(file).isFile(), `missing ${file}`);
  }

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(pkg.scripts["smoke:prod"], "missing smoke:prod script");

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of ["System Status Checklist", "Backup and restore path", "Manual checkout safety", "Owner QA"]) {
    assert.match(app, new RegExp(phrase), `missing Phase 17 UI phrase ${phrase}`);
  }

  const errorBoundary = readFileSync(join(root, "src", "app", "error.tsx"), "utf8");
  assert.match(errorBoundary, /Something went wrong/);
  assert.match(errorBoundary, /Retry/);

  const smoke = readFileSync(join(root, "scripts", "final-production-smoke.ts"), "utf8");
  for (const phrase of [
    "cronProtection",
    "backupExport",
    "restoreDryRun",
    "inviteFlow",
    "serviceWorker",
    "mobileShell"
  ]) {
    assert.match(smoke, new RegExp(phrase), `missing final smoke check ${phrase}`);
  }

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /Phase 17 Owner Guide/);
  assert.match(readme, /Known Limitations/);
  assert.match(readme, /npm run smoke:prod/);
});

test("Phase 18 owner launch and alert calibration pieces exist", () => {
  const types = readFileSync(join(root, "src", "types", "radar.ts"), "utf8");
  for (const phrase of [
    "OwnerLaunchChecklistItemDTO",
    "AlertCalibrationItemDTO",
    "ownerLaunchChecklist",
    "alertCalibrationItems"
  ]) {
    assert.match(types, new RegExp(phrase), `missing Phase 18 type phrase ${phrase}`);
  }

  const service = readFileSync(join(root, "src", "lib", "radar-service.ts"), "utf8");
  for (const phrase of [
    "ownerLaunchChecklist",
    "alertCalibrationItems",
    "Pending confirmation",
    "Repeated false positives",
    "Backup routine ready"
  ]) {
    assert.match(service, new RegExp(phrase), `missing Phase 18 service phrase ${phrase}`);
  }

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of [
    "Owner Launch Checklist",
    "Alert Calibration Queue",
    "launch items ready",
    "No calibration issues"
  ]) {
    assert.match(app, new RegExp(phrase), `missing Phase 18 UI phrase ${phrase}`);
  }

  const smoke = readFileSync(join(root, "scripts", "final-production-smoke.ts"), "utf8");
  assert.match(smoke, /ownerLaunchChecklist/);
  assert.match(smoke, /alertCalibrationItems/);

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /Phase 18 Owner Launch And Alert Calibration/);
  assert.match(readme, /Alert Calibration Queue/);
});

test("dashboard compact cards stay readable instead of narrow columns", () => {
  const css = readFileSync(join(root, "src", "app", "globals.css"), "utf8");
  assert.match(css, /box-sizing:\s*border-box/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /body\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(css, /\.product-card\s*\{[^}]*grid-template-columns:\s*minmax\(112px,\s*148px\)\s*minmax\(0,\s*1fr\)\s*minmax\(118px,\s*auto\)/s);
  assert.match(css, /\.product-image-frame\s*\{[^}]*height:\s*148px/s);
  assert.match(css, /\.product-image-frame img\s*\{[^}]*object-fit:\s*contain !important/s);
  assert.match(css, /\.content-grid\s*>\s*\.stack/s);
  assert.match(css, /\.product-card:not\(\.compact-product-card\)\s*\.product-card-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.field-filter-grid\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.today-plan-panel,\s*\n\s*\.form-panel/s);
  assert.match(css, /\.daily-plan-grid\s*\{[^}]*minmax\(320px,\s*1fr\)/s);
  assert.match(css, /font-size:\s*clamp\(1\.45rem,\s*6vw,\s*2\.75rem\)/);

  const viewportQa = readFileSync(join(root, "scripts", "viewport-qa.ts"), "utf8");
  for (const phrase of ["mobile-390", "tablet-768", "desktop-1440", "Cards", "bodyScrollWidth", "overflowingElements", "imageLeaks", "brokenImages"]) {
    assert.match(viewportQa, new RegExp(phrase), `missing viewport QA phrase ${phrase}`);
  }
});

test("card report and product image UI avoids fake dates and broken placeholders", () => {
  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  const css = readFileSync(join(root, "src", "app", "globals.css"), "utf8");
  const service = readFileSync(join(root, "src", "lib", "radar-service.ts"), "utf8");
  const validation = readFileSync(join(root, "src", "lib", "validation.ts"), "utf8");

  assert.match(app, /top10-table/);
  assert.match(app, /Live manual data - report not generated yet/);
  assert.equal(app.includes("generatedAt={new Date().toISOString()}"), false);
  assert.equal(app.includes('defaultValue={toDateInput(new Date().toISOString())}'), false);
  assert.match(app, /Image unavailable/);
  assert.equal(app.includes("Image from verified exact page"), false);
  assert.match(css, /\.top10-row\s*\{[^}]*grid-template-columns:\s*minmax\(220px,\s*1\.6fr\)/s);
  assert.match(css, /\.top10-metric::before/s);
  assert.match(css, /\.card-opportunity-row/s);
  assert.match(service, /validateProductImageUrl/);
  assert.match(service, /lastRefreshed:\s*card\.compSales\[0\]\?\.soldAt/);
  assert.match(validation, /lastRefreshed:\s*boundedDate,/);
});

test("Auth hardening and password reset flow pieces exist", () => {
  const files = [
    join(root, "src", "app", "api", "auth", "forgot-password", "route.ts"),
    join(root, "src", "app", "api", "auth", "reset-password", "route.ts"),
    join(root, "src", "app", "api", "auth", "admin", "account", "route.ts"),
    join(root, "src", "app", "api", "auth", "admin", "password", "route.ts"),
    join(root, "src", "lib", "password-reset.ts"),
    join(root, "scripts", "auth-smoke.ts"),
    join(root, "scripts", "admin-reset.ts")
  ];
  for (const file of files) {
    assert.ok(statSync(file).isFile(), `missing ${file}`);
  }

  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const field of ["sessionVersion", "lastLoginAt", "passwordChangedAt", "tokenHash", "expiresAt", "usedAt"]) {
    assert.match(schema, new RegExp(field), `missing auth schema field ${field}`);
  }

  const auth = readFileSync(join(root, "src", "lib", "auth.ts"), "utf8");
  for (const phrase of ["__Host-poke_radar_session", "authRuntimeConfig", "sessionVersion", "AUTH_SECRET"]) {
    assert.match(auth, new RegExp(phrase), `missing auth phrase ${phrase}`);
  }

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of ["Forgot Password", "Reset Password", "Auth Session", "Auth Secret", "Admin Account Settings", "Change Password"]) {
    assert.match(app, new RegExp(phrase), `missing auth UI phrase ${phrase}`);
  }

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(pkg.scripts["auth:smoke"], "missing auth:smoke script");
  assert.ok(pkg.scripts["admin:reset"], "missing admin:reset script");
});

test("Phase 13 weekly card comp workflow and reports exist", () => {
  const route = join(root, "src", "app", "api", "radar", "cards", "reports", "route.ts");
  assert.ok(statSync(route).isFile(), `missing ${route}`);

  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const field of [
    "compConfidenceScore",
    "sourceQuality",
    "top10RawToGrade",
    "safestPsa9Flips",
    "highestPsa10Upside",
    "beckettCandidates",
    "avoidOverpriced"
  ]) {
    assert.match(schema, new RegExp(field), `missing Phase 13 schema field ${field}`);
  }

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of [
    "Guided Card Comp Entry",
    "Generate Weekly Report Now",
    "Weekly Investment Report Archive",
    "Top 5 safest PSA 9 flips",
    "Top 5 Beckett candidates",
    "eBay sold",
    "PriceCharting",
    "TCGPlayer",
    "Manual estimate"
  ]) {
    assert.match(app, new RegExp(phrase), `missing Phase 13 UI phrase ${phrase}`);
  }

  const service = readFileSync(join(root, "src", "lib", "radar-service.ts"), "utf8");
  assert.match(service, /generateWeeklyInvestmentReport/);
  assert.match(service, /became PSA 9 profitable/);

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /Weekly Comp Workflow/);
});

test("eBay API activation and comp QA workflow exists", () => {
  const routes = [
    join(root, "src", "app", "api", "radar", "ebay", "status", "route.ts"),
    join(root, "src", "app", "api", "radar", "ebay", "test", "route.ts"),
    join(root, "src", "app", "api", "radar", "cards", "comps", "[compId]", "review", "route.ts")
  ];
  for (const route of routes) {
    assert.ok(statSync(route).isFile(), `missing ${route}`);
  }

  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const field of [
    "ebayIncludeWords",
    "ebayExcludeWords",
    "ebayExactSetName",
    "ebayCardNumberRequired",
    "ebayRawKeywords",
    "ebayPsa9Keywords",
    "ebayPsa10Keywords",
    "reviewStatus",
    "rejectedAt"
  ]) {
    assert.match(schema, new RegExp(field), `missing eBay QA schema field ${field}`);
  }

  const ebay = readFileSync(join(root, "src", "lib", "ebay.ts"), "utf8");
  for (const phrase of ["EBAY_CLIENT_ID", "testEbayConnection", "hardRejectWords", "Wrong or missing card number", "item_sales/search"]) {
    assert.match(ebay, new RegExp(phrase), `missing eBay API safeguard phrase ${phrase}`);
  }

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of [
    "eBay API Status",
    "Test eBay Connection",
    "Refresh All Cards",
    "Search tuning and wrong-comp protection",
    "Accept this comp",
    "Reject this comp",
    "Exact 3 sold comps used"
  ]) {
    assert.match(app, new RegExp(phrase), `missing eBay comp QA UI phrase ${phrase}`);
  }

  const smoke = readFileSync(join(root, "scripts", "final-production-smoke.ts"), "utf8");
  assert.match(smoke, /\/api\/radar\/ebay\/status/);
  assert.match(smoke, /EBAY_CLIENT_SECRET/);

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /eBay API Setup/);
  assert.match(readme, /EBAY_CLIENT_ID/);
});

test("project is standalone and does not reference Harbor Command files", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /not connected to Harbor Command/);

  const combined = allProjectFiles()
    .filter((path) => !path.includes(`${join("tests")}`))
    .filter((path) => !path.endsWith(".md"))
    .filter((path) => !path.endsWith(".db"))
    .filter((path) => !path.endsWith(".png"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert.equal(combined.includes("yacht-management-app"), false);
  assert.equal(combined.includes("Harbor Command"), false);
});

test("forbidden automation patterns are not implemented", () => {
  const combined = allProjectFiles()
    .filter((path) => !path.includes(`${join("tests")}`))
    .filter((path) => !path.endsWith(".md"))
    .filter((path) => !path.endsWith(".db"))
    .filter((path) => !path.endsWith(".png"))
    .map((path) => readFileSync(path, "utf8").toLowerCase())
    .join("\n");
  for (const phrase of ["auto-checkout", "rotate proxies", "bypass captcha", "fake accounts"]) {
    assert.equal(combined.includes(phrase), false, `forbidden phrase present: ${phrase}`);
  }
});

test("Phase 1.5 safety and data integrity routes exist", () => {
  const routes = [
    join(root, "src", "app", "api", "radar", "backup", "route.ts"),
    join(root, "src", "app", "api", "radar", "admin", "reset", "route.ts"),
    join(root, "src", "app", "api", "radar", "products", "[productId]", "route.ts"),
    join(root, "src", "app", "api", "radar", "stores", "[storeId]", "route.ts"),
    join(root, "src", "app", "api", "radar", "sightings", "[sightingId]", "route.ts"),
    join(root, "src", "app", "api", "radar", "releases", "[releaseId]", "route.ts"),
    join(root, "src", "app", "api", "radar", "cards", "[cardId]", "route.ts")
  ];

  for (const route of routes) {
    assert.ok(statSync(route).isFile(), `missing ${route}`);
  }
});

test("Phase 2 monitor and notification routes exist", () => {
  const routes = [
    join(root, "src", "app", "api", "radar", "products", "[productId]", "check", "route.ts"),
    join(root, "src", "app", "api", "radar", "monitor", "run", "route.ts"),
    join(root, "src", "app", "api", "radar", "monitor", "cron", "route.ts"),
    join(root, "src", "app", "api", "radar", "notifications", "route.ts"),
    join(root, "src", "app", "api", "radar", "notifications", "test", "route.ts"),
    join(root, "src", "app", "api", "radar", "notifications", "test-all", "route.ts"),
    join(root, "scripts", "run-monitor.ts")
  ];

  for (const route of routes) {
    assert.ok(statSync(route).isFile(), `missing ${route}`);
  }
});

test("Phase 3 card investment engine routes and fields exist", () => {
  const routes = [
    join(root, "src", "app", "api", "radar", "cards", "comps", "route.ts"),
    join(root, "src", "app", "api", "radar", "investment-settings", "route.ts")
  ];
  for (const route of routes) {
    assert.ok(statSync(route).isFile(), `missing ${route}`);
  }

  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const field of [
    "bgs95AverageSalePrice",
    "bgs10AverageSalePrice",
    "bgsBlackLabelAverageSalePrice",
    "top10Score",
    "gradeType",
    "sourceUrl",
    "minimumProfitTarget"
  ]) {
    assert.match(schema, new RegExp(field), `missing Phase 3 field ${field}`);
  }
});

test("Phase 4 release priority engine fields exist", () => {
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const field of [
    "releaseId",
    "productType",
    "estimatedDemand",
    "sealedProductPriority",
    "sealedResaleNotes",
    "scarcityNotes",
    "manualPriorityOverride",
    "profitablePsa9Count",
    "psa10Upside",
    "reason"
  ]) {
    assert.match(schema, new RegExp(field), `missing Phase 4 field ${field}`);
  }

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  assert.match(app, /Online Drops/);
  assert.match(app, /Yearly Release Calendar/);
  assert.match(app, /release-month-grid/);
  assert.match(app, /High priority only/);
});

test("Phase 5 store prediction and field mode fields exist", () => {
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /resultType/);
  assert.match(schema, /@@index\(\[resultType\]\)/);

  const types = readFileSync(join(root, "src", "types", "radar.ts"), "utf8");
  for (const field of [
    "averageRestockIntervalDays",
    "mostCommonRestockDays",
    "mostCommonRestockTimeWindows",
    "overdueScore",
    "isLikelyToday",
    "checkTodayStores"
  ]) {
    assert.match(types, new RegExp(field), `missing Phase 5 type ${field}`);
  }

  const calculations = readFileSync(join(root, "src", "lib", "calculations.ts"), "utf8");
  assert.match(calculations, /calculateOverdueScore/);
  assert.match(calculations, /timeWindowFor/);

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of ["Field Mode", "Seen Stock", "Empty Shelf", "Vendor Spotted", "Bought Product", "No Visit"]) {
    assert.match(app, new RegExp(phrase), `missing Phase 5 UI phrase ${phrase}`);
  }
});

test("Phase 6 PWA and push notification pieces exist", () => {
  const files = [
    join(root, "public", "manifest.webmanifest"),
    join(root, "public", "sw.js"),
    join(root, "public", "offline.html"),
    join(root, "public", "icons", "icon-192.png"),
    join(root, "public", "icons", "icon-512.png"),
    join(root, "src", "app", "api", "radar", "push", "subscription", "route.ts"),
    join(root, "src", "app", "api", "radar", "push", "test", "route.ts")
  ];
  for (const file of files) {
    assert.ok(statSync(file).isFile(), `missing ${file}`);
  }

  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const field of ["BrowserPushSubscription", "endpoint", "p256dh", "auth", "disabledAt"]) {
    assert.match(schema, new RegExp(field), `missing Phase 6 schema field ${field}`);
  }

  const env = readFileSync(join(root, ".env.example"), "utf8");
  for (const key of ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
    assert.match(env, new RegExp(key), `missing env var ${key}`);
  }

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of ["Browser Push Setup", "Enable Browser Push", "Disable Browser Push", "Test Browser Push", "Test All Alerts"]) {
    assert.match(app, new RegExp(phrase), `missing Phase 6 UI phrase ${phrase}`);
  }

  const layout = readFileSync(join(root, "src", "app", "layout.tsx"), "utf8");
  assert.match(layout, /manifest\.webmanifest/);
});

test("Phase 7 deployment readiness and health checks exist", () => {
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
  assert.equal(vercel.crons[0].path, "/api/radar/monitor/cron");
  assert.equal(vercel.crons[0].schedule, "*/5 * * * *");

  const files = [
    join(root, "src", "app", "api", "health", "route.ts"),
    join(root, "src", "lib", "env.ts"),
    join(root, "src", "lib", "health.ts")
  ];
  for (const file of files) {
    assert.ok(statSync(file).isFile(), `missing ${file}`);
  }

  const cronRoute = readFileSync(join(root, "src", "app", "api", "radar", "monitor", "cron", "route.ts"), "utf8");
  assert.match(cronRoute, /export async function GET/);
  assert.match(cronRoute, /MONITOR_JOB_SECRET/);
  assert.match(cronRoute, /authorization/);

  const env = readFileSync(join(root, ".env.example"), "utf8");
  assert.match(env, /CRON_SECRET/);

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  assert.match(app, /App Health/);
  assert.match(app, /Admin deployment warning/);

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /Production Deployment/);
  assert.match(readme, /managed Postgres/);
  assert.match(readme, /\/api\/health/);
});

test("Phase 8 templates imports and setup guidance exist", () => {
  const files = [
    join(root, "src", "lib", "retailer-templates.ts"),
    join(root, "src", "app", "api", "radar", "products", "import", "route.ts"),
    join(root, "src", "app", "api", "radar", "stores", "import", "route.ts"),
    join(root, "src", "app", "api", "radar", "releases", "import", "route.ts")
  ];
  for (const file of files) {
    assert.ok(statSync(file).isFile(), `missing ${file}`);
  }

  const templates = readFileSync(join(root, "src", "lib", "retailer-templates.ts"), "utf8");
  for (const retailer of ["Pokemon Center", "Target", "Walmart", "Best Buy", "GameStop", "Amazon"]) {
    assert.match(templates, new RegExp(retailer), `missing retailer template ${retailer}`);
  }
  for (const field of ["urlPattern", "statusWords", "safeSelectors", "identifierFields", "alertPriorityDefault", "monitorNotes"]) {
    assert.match(templates, new RegExp(field), `missing template field ${field}`);
  }

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of ["Add Product Wizard", "Bulk Product Import", "Bulk Store Import", "Bulk Release Import", "First Setup Checklist", "Data Quality"]) {
    assert.match(app, new RegExp(phrase), `missing Phase 8 UI phrase ${phrase}`);
  }

  const service = readFileSync(join(root, "src", "lib", "radar-service.ts"), "utf8");
  for (const phrase of ["importProducts", "importStores", "importReleases", "Mega Evolution-Chaos Rising"]) {
    assert.match(service, new RegExp(phrase), `missing Phase 8 service phrase ${phrase}`);
  }

  const readme = readFileSync(join(root, "README.md"), "utf8");
  for (const phrase of ["Bulk Product Import", "Bulk Store Import", "Bulk Release Import", "Target:", "Pokemon Center:"]) {
    assert.match(readme, new RegExp(phrase), `missing README phrase ${phrase}`);
  }
});

test("Phase 9 deployment operations scripts and checklist exist", () => {
  const files = [
    join(root, "scripts", "backup-data.ts"),
    join(root, "scripts", "restore-data.ts"),
    join(root, "scripts", "backup-postgres.ts"),
    join(root, "scripts", "restore-postgres.ts"),
    join(root, "scripts", "generate-secrets.ts"),
    join(root, "scripts", "generate-vapid.ts"),
    join(root, "scripts", "prepare-postgres-schema.ts"),
    join(root, "docs", "production-deployment-checklist.md")
  ];
  for (const file of files) {
    assert.ok(statSync(file).isFile(), `missing ${file}`);
  }

  const checklist = readFileSync(join(root, "docs", "production-deployment-checklist.md"), "utf8");
  for (const phrase of [
    "Vercel project name: `poke-restock-radar`",
    "Neon production database name: `poke_restock_radar_prod`",
    "DATABASE_URL_UNPOOLED",
    "npm run db:push:prod",
    "npm run backup:json",
    "npm run backup:postgres",
    "npm run secrets:generate",
    "npm run vapid:generate"
  ]) {
    assert.match(checklist, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing checklist phrase ${phrase}`);
  }
});

test("Phase 12 retailer detection accuracy controls exist", () => {
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const field of [
    "requiredWords",
    "ignoreWords",
    "lastSuccessfulCheckedAt",
    "pendingAlertStatus",
    "pendingAlertCount",
    "confidenceScore",
    "detectedWords",
    "finalUrl",
    "responseTimeMs",
    "blockedType"
  ]) {
    assert.match(schema, new RegExp(field), `missing Phase 12 field ${field}`);
  }

  const templates = readFileSync(join(root, "src", "lib", "retailer-templates.ts"), "utf8");
  for (const phrase of ["pageBlocked", "captcha", "unavailable", "pageChanged"]) {
    assert.match(templates, new RegExp(phrase), `missing Phase 12 template phrase ${phrase}`);
  }

  const monitor = readFileSync(join(root, "src", "lib", "monitor.ts"), "utf8");
  for (const phrase of ["PENDING_CONFIRMATION", "CAPTCHA_ROBOT_PAGE", "PAGE_BLOCKED", "shouldHoldForConfirmation"]) {
    assert.match(monitor, new RegExp(phrase), `missing Phase 12 monitor phrase ${phrase}`);
  }

  const actionRoute = join(root, "src", "app", "api", "radar", "products", "[productId]", "monitor", "route.ts");
  assert.ok(statSync(actionRoute).isFile(), `missing ${actionRoute}`);

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of [
    "Monitor Accuracy Stats",
    "Required words",
    "Ignore words",
    "Pause Monitor",
    "Force Alert",
    "Mark False Positive",
    "Details"
  ]) {
    assert.match(app, new RegExp(phrase), `missing Phase 12 UI phrase ${phrase}`);
  }

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /Tuning Retailer Detection/);
  assert.match(readme, /Low-confidence high-priority changes/);
});

test("UI real retail flow improvements exist", () => {
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const field of [
    "preferredZone",
    "customZoneName",
    "hideDistantStores",
    "retailerProductId",
    "verificationStatus",
    "UserStorePreference",
    "latitude",
    "longitude",
    "currentLatitude",
    "currentLongitude",
    "locationUpdatedAt",
    "expectedTitleKeywords"
  ]) {
    assert.match(schema, new RegExp(field), `missing location/product field ${field}`);
  }

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of [
    "Admin Controls",
    "Use My Location",
    "Browser location",
    "My Area setup",
    "More Actions",
    "Exact product links give better alerts",
    "Verified Exact Product",
    "Search/Category Link",
    "Needs UPC/SKU",
    "Ready for Alert",
    "Verify Exact Product",
    "Found Product",
    "I'm Here",
    "Near Me",
    "Favorites",
    "store-row"
  ]) {
    assert.match(app, new RegExp(phrase), `missing UI phrase ${phrase}`);
  }

  const service = readFileSync(join(root, "src", "lib", "radar-service.ts"), "utf8");
  assert.match(service, /Target Hialeah/);
  assert.match(service, /Target Midtown Miami/);
  assert.match(service, /Walmart Doral/);
  assert.match(service, /Best Buy Dadeland/);
  assert.match(service, /GameStop Westland Mall Hialeah/);
  assert.match(service, /verifyProductLink/);
  assert.match(service, /Product title text/);
  assert.match(service, /Product image validated from exact page/);
  assert.match(service, /matchProductIdentity/);
  assert.match(service, /distanceMilesBetween/);

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /Product Link Verification/);
  assert.match(readme, /imageUrl/);
  assert.match(readme, /Search link only/);
  assert.match(readme, /Zone And Field Mode Setup/);
  assert.match(readme, /Admin.*button/);
});

test("store discovery and coverage expansion exists", () => {
  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of [
    "Store Coverage",
    "Find Nearby Stores",
    "Expand Store Coverage",
    "Add To My Stores",
    "Use Browser Location",
    "Search saved stores by name",
    "Manual mode",
    "Google Places"
  ]) {
    assert.match(app, new RegExp(phrase), `missing store discovery UI phrase ${phrase}`);
  }

  const discoveryRoute = readFileSync(join(root, "src", "app", "api", "radar", "stores", "discovery", "route.ts"), "utf8");
  const addRoute = readFileSync(join(root, "src", "app", "api", "radar", "stores", "discovery", "add", "route.ts"), "utf8");
  const discoveryService = readFileSync(join(root, "src", "lib", "store-discovery.ts"), "utf8");
  const validation = readFileSync(join(root, "src", "lib", "validation.ts"), "utf8");

  assert.match(discoveryRoute, /storeDiscoverySearchSchema/);
  assert.match(addRoute, /storeDiscoveryAddSchema/);
  assert.match(discoveryService, /GOOGLE_PLACES_API_KEY/);
  assert.match(discoveryService, /nearbysearch\/json/);
  assert.match(discoveryService, /place\/details\/json/);
  assert.match(discoveryService, /duplicateReason/);
  assert.match(validation, /storeDiscoverySearchSchema/);
  assert.match(validation, /storeDiscoveryAddSchema/);

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /Store Discovery/);
  assert.match(readme, /GOOGLE_PLACES_API_KEY/);
  assert.match(readme, /retailer,storeName,address,city,state,zip,latitude,longitude,phone,notes/);
});

test("core restock scanner discovery mode exists", () => {
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  const monitor = readFileSync(join(root, "src", "lib", "monitor.ts"), "utf8");
  const discovery = readFileSync(join(root, "src", "lib", "product-discovery.ts"), "utf8");
  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");

  assert.match(schema, /model ProductDiscoverySource/);
  assert.match(schema, /model ProductDiscoveryCandidate/);
  assert.match(schema, /archivedAt\s+DateTime\?/);
  assert.match(monitor, /buyAvailableStatuses/);
  assert.match(monitor, /runProductDiscoveryBatch/);
  assert.match(monitor, /archivedAt: null/);
  assert.match(discovery, /review-before-watch/);
  assert.match(discovery, /Search\/category pages never trigger buy alerts/);
  for (const phrase of ["Restock scanner", "Review New Finds", "Approve", "Add Discovery Source", "Product QA", "Real Product Data Cleanup"]) {
    assert.match(app, new RegExp(phrase), `missing scanner UI phrase ${phrase}`);
  }
  assert.ok(
    statSync(join(root, "src", "app", "api", "radar", "product-discovery", "sources", "route.ts")).isFile(),
    "missing product discovery source route"
  );
  assert.ok(
    statSync(
      join(root, "src", "app", "api", "radar", "product-discovery", "candidates", "[candidateId]", "review", "route.ts")
    ).isFile(),
    "missing product discovery review route"
  );
  assert.ok(
    statSync(join(root, "src", "app", "api", "radar", "products", "[productId]", "archive", "route.ts")).isFile(),
    "missing product archive route"
  );
});

test("inventory tracker and market recommendation engine exists", () => {
  const schema = readFileSync(join(root, "prisma", "schema.prisma"), "utf8");
  for (const field of [
    "InventoryMarketComp",
    "BarcodeScan",
    "barcodeScans",
    "InventorySale",
    "InventoryStockLot",
    "stockLots",
    "remainingQuantity",
    "purchaseExtraCost",
    "receiptNumber",
    "receiptImageUrl",
    "orderNumber",
    "transactionId",
    "sourceStore",
    "paymentMethod",
    "quantitySold",
    "profitLoss",
    "category",
    "setName",
    "targetSellPrice",
    "currentMarketEstimate",
    "estimatedNetProfit",
    "roiPercent",
    "recommendedAction",
    "listingStatus"
  ]) {
    assert.match(schema, new RegExp(field), `missing inventory schema field ${field}`);
  }

  const service = readFileSync(join(root, "src", "lib", "radar-service.ts"), "utf8");
  for (const phrase of [
    "summarizeInventory",
    "addInventoryStockLot",
    "inventoryMarketRecommendation",
    "refreshInventoryEbayComps",
    "refreshAllInventoryMarketComps",
    "autoLinkInventoryProducts",
    "findWatchedProductMatch",
    "inventoryOwnedCostBasis",
    "lookupInventoryUpc",
    "lookupExternalUpc",
    "Market not collected yet",
    "Add sold comps before recommendations use profit data",
    "const hasRealComps = compCount > 0",
    "marketCompCount: 0",
    "GRADE_FIRST",
    "SELL_NOW"
  ]) {
    assert.match(service, new RegExp(phrase), `missing inventory service phrase ${phrase}`);
  }

  const app = readFileSync(join(root, "src", "components", "RadarApp.tsx"), "utf8");
  for (const phrase of [
    "Inventory",
    "Product Catalog",
    "Quick Actions",
    "Add Existing Product Purchase",
    "Stock Lots",
    "Add Purchase",
    "Record Sale",
    "Inventory Details",
    "Market Data",
    "Attachments / Receipts",
    "Refresh Market Data",
    "Current Market Value",
    "Estimated Net After Fees",
    "Estimated Profit",
    "ROI %",
    "Average from last 3",
    "Lowest recent comp",
    "Highest recent comp",
    "Configure eBay production keys for live sold comps",
    "Add Manual Sold Comp",
    "eBay API not configured",
    "Live eBay Data",
    "Manual Comp Data",
    "Market Not Collected",
    "Low Confidence",
    "Spending Log",
    "Sales Log",
    "What should I sell today?",
    "Best hold",
    "Avoid buying more",
    "Missing Market Data",
    "Attach watched product",
    "Scan UPC / Barcode",
    "Lookup UPC",
    "Scanned UPC history",
    "Manual Inventory Sold Comp",
    "Catalog CSV",
    "Lots CSV",
    "Sales CSV",
    "P/L CSV",
    "Receipt image",
    "Refresh Market",
    "Market not collected yet"
  ]) {
    assert.match(app, new RegExp(phrase), `missing inventory UI phrase ${phrase}`);
  }

  for (const route of [
    join(root, "src", "app", "api", "radar", "inventory", "route.ts"),
    join(root, "src", "app", "api", "radar", "inventory", "import", "route.ts"),
    join(root, "src", "app", "api", "radar", "inventory", "comps", "route.ts"),
    join(root, "src", "app", "api", "radar", "inventory", "[itemId]", "sales", "route.ts"),
    join(root, "src", "app", "api", "radar", "inventory", "[itemId]", "route.ts"),
    join(root, "src", "app", "api", "radar", "inventory", "[itemId]", "refresh-comps", "route.ts"),
    join(root, "src", "app", "api", "radar", "inventory", "refresh-comps", "route.ts"),
    join(root, "src", "app", "api", "radar", "inventory", "upc", "lookup", "route.ts")
  ]) {
    assert.ok(statSync(route).isFile(), `missing inventory route ${route}`);
  }

  const readme = readFileSync(join(root, "README.md"), "utf8");
  assert.match(readme, /Inventory Tracker/);
  assert.match(readme, /Market Recommendation/);
  assert.match(readme, /Market not collected yet/);
});
