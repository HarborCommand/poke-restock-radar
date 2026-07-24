import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(path.join(root, "src/components/RadarApp.tsx"), "utf8");
const homePage = readFileSync(path.join(root, "src/app/page.tsx"), "utf8");
const loginPage = readFileSync(path.join(root, "src/app/login/page.tsx"), "utf8");
const dashboardPage = readFileSync(path.join(root, "src/app/dashboard/page.tsx"), "utf8");
const privateAppPage = readFileSync(path.join(root, "src/app/app/page.tsx"), "utf8");
const adminPage = readFileSync(path.join(root, "src/app/admin/page.tsx"), "utf8");
const rewardsAdmin = readFileSync(path.join(root, "src/lib/rewards-admin.ts"), "utf8");
const customerRewards = readFileSync(path.join(root, "src/lib/customer-rewards.ts"), "utf8");
const taxAdmin = readFileSync(path.join(root, "src/lib/tax-admin.ts"), "utf8");

function sourceSlice(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker ${end}`);
  return source.slice(startIndex, endIndex);
}

const navConfig = sourceSlice(app, "const navSectionLabels", "type NavTab");
const dashboardPanel = sourceSlice(app, "function DashboardPanel", "function DashboardMetricCard");
const alertPanelVisible = sourceSlice(app, "  if (view) return (", "  function runTargetBatch");
const adminPanel = sourceSlice(app, "function AdminControlPanel", "function AdminActionCard");
const adminHealthPanel = sourceSlice(app, "function AdminHealthPanel", "function NotificationSettingsPanel");
const notificationSettingsPanel = sourceSlice(app, "function NotificationSettingsPanel", "function AccessManagementPanel");

test("private admin navigation uses the final focused GameDayGrabs IA", () => {
  assert.match(navConfig, /operations: "Operations"[\s\S]*catalog: "Catalog & Stock"[\s\S]*customers: "Customers"[\s\S]*insights: "Insights"[\s\S]*admin: "Admin"/);

  assert.match(navConfig, /\{ id: "dashboard", label: "Dashboard", icon: Home, section: "operations" \}/);
  assert.match(navConfig, /\{ id: "orders", label: "Orders", icon: ShoppingBag, section: "operations" \}/);
  assert.match(navConfig, /\{ id: "shipping", label: "Shipping", icon: Navigation, section: "operations" \}/);
  assert.match(navConfig, /\{ id: "pos", label: "POS", icon: ShoppingCart, section: "operations" \}/);
  assert.match(navConfig, /\{ id: "sales", label: "Sales History", icon: Receipt, section: "operations" \}/);

  assert.match(navConfig, /\{ id: "inventory", label: "Products & Inventory", icon: Boxes, section: "catalog" \}/);
  assert.match(navConfig, /\{ id: "customers", label: "Customers & Rewards", icon: Users, section: "customers" \}/);
  assert.match(navConfig, /\{ id: "analytics", label: "Reports", icon: BarChart3, section: "insights" \}/);
  assert.match(navConfig, /\{ id: "market", label: "Market", icon: Sparkles, section: "insights" \}/);
  assert.match(navConfig, /\{ id: "releases", label: "Releases", icon: CalendarDays, section: "insights" \}/);
  assert.match(navConfig, /\{ id: "alerts", label: "Alerts", icon: Bell, section: "admin" \}/);
  assert.match(navConfig, /\{ id: "settings", label: "Settings", icon: Settings, section: "admin" \}/);
  assert.match(navConfig, /\{ id: "tax", label: "Tax", icon: Calculator, section: "admin" \}/);
  assert.match(navConfig, /\{ id: "admin", label: "System", icon: ShieldCheck, section: "admin" \}/);

  assert.doesNotMatch(navConfig, /label:\s*"Quick Stock"|section:\s*"tracker"|label:\s*"Live Drops"|label:\s*"Check Stock"|label:\s*"My Watchlist"|label:\s*"Scanner Status"/);
});

test("GameDayGrabs Admin branding and ecommerce icon appear on private application surfaces", () => {
  assert.match(app, /<h1>GameDayGrabs Admin<\/h1>/);
  assert.match(app, /className="brand-lockup sidebar-brand"[\s\S]*<Store size=\{19\}/);
  assert.match(app, /className="brand-mark large"[\s\S]*<Store size=\{30\}/);
  assert.match(loginPage + dashboardPage + privateAppPage + adminPage, /GameDayGrabs Admin/);
  assert.match(homePage, /title: "GameDayGrabs Admin"/);
  assert.match(homePage, /robots:\s*\{\s*index: false,\s*follow: false/s, "raw private host remains noindexed");

  assert.match(homePage, /GameDayGrabs LLC \| Sealed Pokemon TCG & Collectible Card Products/);
  assert.match(homePage, /if \(isGameDayGrabsHost\(host\)\)/, "public storefront host branch remains intact");
  assert.doesNotMatch(homePage.slice(homePage.indexOf("if (isGameDayGrabsHost(host))"), homePage.indexOf("return {", homePage.indexOf("if (isGameDayGrabsHost(host))"))), /GameDayGrabs Admin/);
});

test("dashboard emphasizes ecommerce operations and keeps Quick Stock accessible", () => {
  for (const phrase of [
    "New Paid Orders",
    "Orders To Ship",
    "Today's Net Sales",
    "Store Revenue",
    "Store Profit",
    "Products In Stock",
    "Quick Stock",
    "Scan UPC, add inventory, or adjust stock",
    "Sales History",
    "Release Planning"
  ]) {
    assert.match(dashboardPanel, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing dashboard phrase ${phrase}`);
  }

  assert.doesNotMatch(dashboardPanel, /Latest restock, order, and inventory alerts|Release Radar|Live Drops|watched retailer/i);
  assert.doesNotMatch(navConfig, /Quick Stock/, "Quick Stock should not be a separate sidebar destination");
});

test("core ecommerce panels remain wired and role protections are preserved", () => {
  for (const render of [
    /activeTab === "inventory"[\s\S]*<InventoryPanel/,
    /activeTab === "pos" && isAdmin[\s\S]*<PosPanel/,
    /activeTab === "customers" && isAdmin[\s\S]*<CustomersRewardsPanel/,
    /activeTab === "orders"[\s\S]*<StorefrontOrdersPanel/,
    /activeTab === "shipping"[\s\S]*<ShippingHubPanel/,
    /activeTab === "sales"[\s\S]*<SalesPanel/,
    /activeTab === "market"[\s\S]*<MarketPanel/,
    /activeTab === "releases"[\s\S]*<ReleasesPanel/,
    /activeTab === "analytics"[\s\S]*<InventoryAnalyticsPanel/,
    /activeTab === "tax" && isAdmin[\s\S]*<TaxAdminWorkspace/,
    /activeTab === "settings"[\s\S]*<SettingsPanel/,
    /activeTab === "admin" && isAdmin[\s\S]*<AdminControlPanel/
  ]) {
    assert.match(app, render);
  }

  assert.match(app, /const adminOnlyTabs = new Set<Tab>\(\["admin", "pos", "customers", "tax"\]\)/);
});

test("visible alerts page excludes retired tracker controls but preserves useful alert review", () => {
  assert.match(alertPanelVisible, /Review release, inventory, order, storefront, system, and historical alert activity from one private workspace\./);
  assert.match(alertPanelVisible, /Open Settings/);
  assert.match(alertPanelVisible, /Mark Read/);
  assert.match(alertPanelVisible, /Not useful/);
  assert.doesNotMatch(alertPanelVisible, /\/api\/radar\/monitor\/run|Live Drops|Check Stock|My Watchlist|Scanner Status|Target discovery|Best Buy discovery|retired retailer monitor|automatic restock|discovery|watchlist/);
});

test("visible admin surfaces contain no retired tracker explanation", () => {
  const visiblePrivateCopy = [navConfig, dashboardPanel, alertPanelVisible, adminPanel, adminHealthPanel, notificationSettingsPanel, loginPage, dashboardPage, privateAppPage, adminPage].join("\n");
  assert.doesNotMatch(visiblePrivateCopy, /Retired Tracker UI|AdminDeprecatedModulesNotice|Legacy tracker screens|retired tracker|retired retailer|Release Radar|Poke Radar|Poke Restock Radar|Restock Radar|watched retailer|discovery queue|restock accuracy/i);
  assert.doesNotMatch(app, /function AdminDeprecatedModulesNotice|id="admin-deprecated-local"/);
  assert.match(adminHealthPanel, /Background Jobs/);
  assert.doesNotMatch(adminHealthPanel + notificationSettingsPanel, /Monitor Cron|Monitor run history|Simulate Tracker Alert|simulated tracker|tracker_online_drop|Last monitor error/i);
});

test("rewards redemption and tax remain disabled by existing gates", () => {
  assert.match(rewardsAdmin, /redemptionEnabled: false/);
  assert.match(customerRewards, /redemptionEnabled: false/);
  assert.match(app, /Rewards redemption is not enabled/);
  assert.match(taxAdmin, /Online tax collection is disabled by the environment gate/);
});

test("admin simplification introduces no official or authorized retailer claim", () => {
  const combinedVisibleCopy = [app, homePage, loginPage, dashboardPage, privateAppPage].join("\n");
  assert.doesNotMatch(combinedVisibleCopy, /official Pokemon partner|official Pok[eé]mon retailer|authorized by The Pokemon Company|authorized Pok[eé]mon retailer/i);
});
