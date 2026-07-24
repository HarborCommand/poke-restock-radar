import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(path.join(root, "src/components/RadarApp.tsx"), "utf8");
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const rootLayout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
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
  assert.match(rootLayout, /applicationName: "GameDayGrabs"/);
  assert.match(rootLayout, /title: "GameDayGrabs Admin"/);
  assert.match(rootLayout, /appleWebApp:[\s\S]*title: "GameDayGrabs"/);
  assert.doesNotMatch(rootLayout, /Poke Radar|Poke Restock Radar|Restock Radar|release, store, and grading opportunity radar/i);
  assert.match(loginPage + dashboardPage + privateAppPage + adminPage, /GameDayGrabs Admin/);
  assert.match(homePage, /title: "GameDayGrabs Admin"/);
  assert.match(homePage, /robots:\s*\{\s*index: false,\s*follow: false/s, "raw private host remains noindexed");

  assert.match(homePage, /GameDayGrabs LLC \| Sealed Pokemon TCG & Collectible Card Products/);
  assert.match(homePage, /if \(isGameDayGrabsHost\(host\)\)/, "public storefront host branch remains intact");
  assert.doesNotMatch(homePage.slice(homePage.indexOf("if (isGameDayGrabsHost(host))"), homePage.indexOf("return {", homePage.indexOf("if (isGameDayGrabsHost(host))"))), /GameDayGrabs Admin/);
});

test("dashboard emphasizes ecommerce operations and keeps Quick Stock accessible", () => {
  for (const phrase of [
    "Sales, orders, inventory, and storefront operations",
    "Today's Sales",
    "Month to Date Revenue",
    "Month to Date Profit",
    "Inventory Value",
    "Orders to Ship",
    "Pickup Orders",
    "Pending Payments",
    "Refunds / Returns",
    "New POS Sale",
    "Quick Stock",
    "Add Product",
    "Manage Orders",
    "View Storefront",
    "Recent Sales &amp; Orders",
    "Action Center",
    "Inventory Status",
    "Top Selling Products",
    "Storefront Health"
  ]) {
    assert.match(dashboardPanel, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing dashboard phrase ${phrase}`);
  }

  assert.match(dashboardPanel, /setActiveTab\("pos"\)/, "New POS Sale opens POS");
  assert.match(dashboardPanel, /setActiveTab\("inventory"\)/, "Quick Stock and Add Product open inventory workflow");
  assert.match(dashboardPanel, /setActiveTab\("orders"\)/, "Manage Orders opens Orders");
  assert.match(dashboardPanel, /href="https:\/\/www\.gamedaygrabs\.com"[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/, "View Storefront uses the public storefront URL safely");
  assert.match(dashboardPanel, /dashboardRecentSalesAndOrders\(selectedOnlineOrders, selectedSales\)/, "Recent Sales & Orders combines eligible POS and online records");
  assert.match(dashboardPanel, /dashboardActionItems\(\{[\s\S]*ordersToShip[\s\S]*pickupOrders[\s\S]*pendingPayments[\s\S]*refundReturns[\s\S]*productsOutOfStock[\s\S]*lowStockProducts[\s\S]*missingPrice[\s\S]*missingImage/s);
  assert.match(dashboardPanel, /dashboardInventoryStatusRows\(dashboard\.inventory\)/);
  assert.match(dashboardPanel, /dashboardTopSellingProducts\(activeOnlineOrders, activeSales, dashboard\.inventory, dashboardDateRange\("last_30_days"\)\)/);
  assert.doesNotMatch(dashboardPanel, /Active Alerts|Recent Alerts|Latest restock|release-source|missing market|Market warnings|Release Planning|Release alerts|Release Radar|Live Drops|watched retailer|scanner status|monitor logs|restock history|radar accuracy/i);
  assert.doesNotMatch(navConfig, /Quick Stock/, "Quick Stock should not be a separate sidebar destination");
});

test("dashboard reference layout is responsive and scoped away from public storefront", () => {
  assert.match(css, /\.app-main\.app-main-dashboard/);
  assert.match(css, /\.commerce-kpi-grid[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.commerce-operations-strip[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.commerce-middle-grid[\s\S]*grid-template-columns:\s*minmax\(0,\s*1\.55fr\)\s*minmax\(250px,\s*0\.85fr\)\s*minmax\(250px,\s*0\.85fr\)/);
  assert.match(css, /\.commerce-lower-grid[\s\S]*grid-template-columns:\s*minmax\(0,\s*2\.08fr\)\s*minmax\(260px,\s*0\.72fr\)/);
  assert.match(css, /@media \(max-width:\s*1180px\)[\s\S]*\.commerce-kpi-grid,[\s\S]*\.commerce-operations-strip[\s\S]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.commerce-kpi-grid,[\s\S]*\.commerce-operations-strip,[\s\S]*\.commerce-quick-actions\s*>\s*div,[\s\S]*\.commerce-middle-grid,[\s\S]*\.commerce-lower-grid[\s\S]*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /background-image:\s*url\([^)]*codex-clipboard|reference image|screenshot overlay/i);
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
