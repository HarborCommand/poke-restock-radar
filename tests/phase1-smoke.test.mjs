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
    "ProductPriorityScore",
    "NotificationSettings",
    "InvestmentSettings",
    "BrowserPushSubscription"
  ];
  for (const model of models) {
    assert.match(schema, new RegExp(`model\\s+${model}\\s+\\{`), `missing model ${model}`);
  }
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
  assert.match(app, /Today's Chase List/);
  assert.match(app, /Release Countdown/);
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
  for (const phrase of ["Enable Browser Push", "Disable Browser Push", "Test Browser Push"]) {
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
