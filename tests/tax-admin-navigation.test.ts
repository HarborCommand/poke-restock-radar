import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file: string) => fs.readFileSync(file, "utf8");

test("Tax is an admin-only top-level Radar navigation tab on desktop and mobile", () => {
  const app = read("src/components/RadarApp.tsx");
  assert.match(app, /\| "tax"/);
  assert.match(app, /\{ id: "tax", label: "Tax", icon: Calculator, section: "manage" \}/);
  assert.match(app, /adminOnlyTabs = new Set<Tab>\(\[[^\]]*"tax"/);
  assert.match(app, /tabs\.filter\(\(tab\) => tab\.section === section && \(!adminOnlyTabs\.has\(tab\.id\) \|\| isAdmin\)\)/);
  assert.match(app, /adminOnlyTabs\.has\(activeTab\)[\s\S]*dashboard\.currentUser\.role !== "ADMIN"/);
  assert.match(app, /<SidebarNavGroup[\s\S]*tabs=\{group\.tabs\}/);
  assert.match(app, /sidebarOpen \? "app-sidebar open" : "app-sidebar"/);
});

test("direct Tax URLs and every internal section are preserved in browser history", () => {
  const app = read("src/components/RadarApp.tsx");
  const workspace = read("src/components/TaxAdminWorkspace.tsx");
  assert.match(app, /new URLSearchParams\(window\.location\.search\)\.get\("tab"\)/);
  assert.match(app, /activeTab === "tax" && isAdmin \? <TaxAdminWorkspace/);
  for (const section of ["overview", "stripe-readiness", "locations", "settings", "reports", "readiness"]) {
    assert.match(workspace, new RegExp(`id: "${section}"`));
    assert.match(workspace, new RegExp(`section === "${section}"`));
  }
  assert.match(workspace, /url\.searchParams\.set\("tab", "tax"\)/);
  assert.match(workspace, /url\.searchParams\.set\("section", next\)/);
  assert.match(workspace, /window\.history\.pushState/);
  assert.match(workspace, /window\.addEventListener\("popstate"/);
});

test("disabled runtime flags keep the Tax workspace visible without loading report data", () => {
  const workspace = read("src/components/TaxAdminWorkspace.tsx");
  for (const copy of [
    "Tax collection is currently disabled",
    "The tax foundation is installed, but online tax, POS tax, exemptions, and reporting are not active in Production.",
    "Online Stripe Tax",
    "POS Sales Tax",
    "Tax Exempt Sales",
    "Tax Reporting",
    "Tax Reports are visible but disabled",
    "No transaction data was requested, loaded, or exported."
  ]) assert.match(workspace, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(workspace, /settings\.reporting\.enabled \? <TaxReportsWorkspace embedded \/> :/);
  assert.match(workspace, /fetch\("\/api\/radar\/tax-settings"/);
  assert.doesNotMatch(workspace, /fetch\([^)]*tax-report/);
});

test("overview and readiness expose only safe configuration status", () => {
  const workspace = read("src/components/TaxAdminWorkspace.tsx");
  for (const copy of [
    "Code foundation deployed",
    "Tax Settings deployed",
    "POS tax flow deployed",
    "Online Checkout tax flow deployed",
    "Tax reporting code deployed",
    "Refund and concurrency hardening deployed",
    "Tax security review deployed",
    "No online tax collection",
    "No POS tax collection",
    "No tax exemption processing",
    "No official filing activity",
    "Store state",
    "Store county",
    "Tax provider",
    "Product tax code",
    "Stripe Tax readiness",
    "Local Pickup",
    "Filing frequency",
    "Florida registration active in Stripe",
    "Legal store address confirmed",
    "Accountant reviewed",
    "Same-county test passed",
    "Different-county test passed",
    "Webhook test passed",
    "Full refund test passed",
    "Partial refund test passed",
    "Owner approval"
  ]) assert.match(workspace, new RegExp(copy));
  assert.doesNotMatch(workspace, /registrationNumber|certificateNumber|STRIPE_SECRET_KEY|DATABASE_URL|customerEmail|customerPhone/);
});

test("legacy tax pages use server-side admin guards and redirect into private app routes", () => {
  for (const [file, section] of [
    ["src/app/admin/tax-settings/page.tsx", "settings"],
    ["src/app/admin/tax-reports/page.tsx", "reports"]
  ] as const) {
    const page = read(file);
    assert.match(page, /currentUser/);
    assert.match(page, /if \(!user\) redirect\("\/admin"\)/);
    assert.match(page, /if \(user\.role !== "ADMIN"\) notFound\(\)/);
    assert.match(page, new RegExp(`redirect\\(\\"/app\\?tab=tax&section=${section}\\"\\)`));
    assert.match(page, /robots: \{ index: false, follow: false \}/);
  }
});

test("existing APIs remain the only secured data paths and GET stays write-free", () => {
  const settingsRoute = read("src/app/api/radar/tax-settings/route.ts");
  const reportRoute = read("src/app/api/radar/tax-report/route.ts");
  const settingsGet = settingsRoute.slice(settingsRoute.indexOf("export async function GET"), settingsRoute.indexOf("export async function PATCH"));
  for (const route of [settingsRoute, reportRoute]) {
    assert.match(route, /requireUser/);
    assert.match(route, /requireAdmin/);
    assert.match(route, /withPrivateNoStore|privateNoStoreHeaders|privateOk/);
  }
  assert.match(settingsRoute, /authorizeAdminMutation/);
  assert.doesNotMatch(settingsGet + reportRoute, /prisma\.[a-zA-Z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/);
  assert.match(reportRoute, /taxReportingEnabled/);
});

test("saved configuration cannot bypass disabled environment gates", () => {
  const admin = read("src/lib/tax-admin.ts");
  const env = read(".env.example");
  assert.match(admin, /features\.posSalesTaxEnabled && Boolean\(settings\?\.posTaxEnabled\)/);
  assert.match(admin, /features\.taxExemptSalesEnabled && Boolean\(settings\?\.taxExemptSalesEnabled\)/);
  assert.match(admin, /reportingActive = features\.taxReportingEnabled/);
  for (const flag of ["ONLINE_STRIPE_TAX_ENABLED", "POS_SALES_TAX_ENABLED", "TAX_EXEMPT_SALES_ENABLED", "TAX_REPORTING_ENABLED"]) {
    assert.match(env, new RegExp(`${flag}="false"`));
  }
});

test("customer account storefront checkout and POS surfaces do not import Tax administration", () => {
  for (const file of [
    "src/components/CustomerAccountPages.tsx",
    "src/components/StorefrontClient.tsx",
    "src/app/api/storefront/checkout/route.ts"
  ]) {
    assert.doesNotMatch(read(file), /TaxAdminWorkspace|tab=tax|section=readiness/);
  }
  const app = read("src/components/RadarApp.tsx");
  assert.match(app, /activeTab === "pos" && isAdmin/);
});

test("Tax administration layout is full-screen responsive and keyboard visible", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.app-main\.app-main-tax[\s\S]*max-width: 1540px/);
  assert.match(css, /\.content-grid > \.tax-admin-workspace[\s\S]*grid-column: 1 \/ -1/);
  assert.match(css, /\.tax-admin-tabs button:focus-visible/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.tax-admin-tabs[\s\S]*overflow-x: auto/);
  const workspace = read("src/components/TaxAdminWorkspace.tsx");
  const settings = read("src/components/TaxSettingsWorkspace.tsx");
  const reports = read("src/components/TaxReportsWorkspace.tsx");
  assert.match(workspace, /aria-controls="tax-admin-panel"/);
  assert.match(workspace, /role="tabpanel"/);
  assert.match(settings, /embedded \? <h3>Tax Settings<\/h3> : <h1>Tax Settings<\/h1>/);
  assert.match(reports, /embedded \? <h3>Sales Tax Reports<\/h3> : <h1>Sales Tax Reports<\/h1>/);
});
