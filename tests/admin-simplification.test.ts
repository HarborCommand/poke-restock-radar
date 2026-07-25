import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dashboardRealDataLayoutFixture } from "./fixtures/dashboard-real-data-layout";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(path.join(root, "src/components/RadarApp.tsx"), "utf8");
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const rootLayout = readFileSync(path.join(root, "src/app/layout.tsx"), "utf8");
const homePage = readFileSync(path.join(root, "src/app/page.tsx"), "utf8");
const loginPage = readFileSync(path.join(root, "src/app/login/page.tsx"), "utf8");
const dashboardPage = readFileSync(path.join(root, "src/app/dashboard/page.tsx"), "utf8");
const privateAppPage = readFileSync(path.join(root, "src/app/app/page.tsx"), "utf8");
const adminPage = readFileSync(path.join(root, "src/app/admin/page.tsx"), "utf8");
const adminRecoverRoute = readFileSync(path.join(root, "src/app/api/auth/admin/recover/route.ts"), "utf8");
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
const dashboardPanel = sourceSlice(app, "function DashboardPanel", "type CommerceTone");
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
    "Today's Net Receipts",
    "Month to Date Net Receipts",
    "Verified Month to Date Profit",
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
  assert.match(dashboardPanel, /openInventoryIntent\("quick-stock"\)/, "Quick Stock opens the inventory quick-stock workflow");
  assert.match(dashboardPanel, /openInventoryIntent\("add-product"\)/, "Add Product opens the add-product workflow");
  assert.match(dashboardPanel, /setActiveTab\("orders"\)/, "Manage Orders opens Orders");
  assert.match(dashboardPanel, /href=\{GAMEDAYGRABS_CANONICAL_PUBLIC_URL\}[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"/, "View Storefront uses the public storefront URL safely");
  assert.match(dashboardPanel, /summarizeDashboardAccounting\(dashboard, dateRange\)/, "Dashboard accounting uses the centralized complete eligible transaction set");
  assert.match(dashboardPanel, /const recentRows = accounting\.recentTransactions/, "Recent Sales & Orders uses the display-only recent slice");
  assert.match(dashboardPanel, /dashboardActionItems\(\{[\s\S]*ordersToShip[\s\S]*pickupOrders[\s\S]*pendingPayments[\s\S]*refundReturns[\s\S]*productsOutOfStock[\s\S]*lowStockProducts[\s\S]*missingPrice[\s\S]*missingImage/s);
  assert.match(dashboardPanel, /dashboardInventoryStatusRows\(dashboard\.inventory\)/);
  assert.match(dashboardPanel, /dashboardTopSellingProducts\(accounting\.topSellingProductRecords, dashboard\.inventory\)/);
  assert.match(dashboardPanel, /aria-label="Open alerts"/);
  assert.doesNotMatch(dashboardPanel, /usefulAlertCount|unread alert|Math\.min\(usefulAlertCount/);
  assert.match(dashboardPanel, /product\.margin === null \? "Unknown" : percent\(product\.margin\)/);
  assert.match(dashboardPanel, /transaction\$\{accounting\.periodUnknownProfitCount === 1 \? "" : "s"\} without verified profit/);
  assert.doesNotMatch(dashboardPanel, /items? without verified cost basis/);
  assert.doesNotMatch(dashboardPanel, /Active Alerts|Recent Alerts|Latest restock|release-source|missing market|Market warnings|Release Planning|Release alerts|Release Radar|Live Drops|watched retailer|scanner status|monitor logs|restock history|radar accuracy/i);
  assert.doesNotMatch(navConfig, /Quick Stock/, "Quick Stock should not be a separate sidebar destination");
});

test("dashboard reference layout is responsive and scoped away from public storefront", () => {
  assert.match(css, /\.app-main\.app-main-dashboard/);
  assert.match(css, /\.commerce-kpi-grid[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.commerce-operations-strip[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.commerce-middle-grid\{grid-template-columns:minmax\(0,0\.78fr\) minmax\(0,1\.22fr\)/, "middle grid promotes Recent Sales to a full-width row above Action Center and Inventory Status");
  assert.match(css, /\.commerce-middle-grid>\.commerce-card-large\{grid-column:1 \/ -1\}/, "Recent Sales spans the middle layout");
  assert.match(css, /\.app-main-dashboard\{box-sizing:border-box;width:100%;overflow-x:hidden\}/, "dashboard shell prevents page-level horizontal overflow");
  assert.match(css, /\.commerce-lower-grid[\s\S]*grid-template-columns:\s*minmax\(0,\s*2\.08fr\)\s*minmax\(260px,\s*0\.72fr\)/);
  assert.match(css, /@media \(max-width:\s*1180px\)[\s\S]*\.commerce-kpi-grid,[\s\S]*\.commerce-operations-strip[\s\S]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*\.commerce-kpi-grid,[\s\S]*\.commerce-operations-strip,[\s\S]*\.commerce-quick-actions\s*>\s*div,[\s\S]*\.commerce-middle-grid,[\s\S]*\.commerce-lower-grid[\s\S]*grid-template-columns:\s*1fr/);
  assert.doesNotMatch(css, /background-image:\s*url\([^)]*codex-clipboard|reference image|screenshot overlay/i);
});

test("admin recovery fallback no longer creates legacy Radar Admin display names", () => {
  assert.match(adminRecoverRoute, /name:\s*"GameDayGrabs Admin"/);
  assert.doesNotMatch(adminRecoverRoute, /name:\s*"Radar Admin"/);
});

test("dashboard real-data layout keeps long sales, inventory, action, and ranking text separated", () => {
  assert.ok(dashboardRealDataLayoutFixture.recentTransactions[0].reference.length >= 24);
  assert.ok(dashboardRealDataLayoutFixture.recentTransactions[0].orderReference.length >= 20);
  assert.ok(dashboardRealDataLayoutFixture.recentTransactions[0].productName.length >= 90);
  assert.ok(dashboardRealDataLayoutFixture.recentTransactions[0].customerName.length >= 30);
  assert.ok(dashboardRealDataLayoutFixture.recentTransactions[0].customerEmail.length >= 40);
  assert.match(dashboardRealDataLayoutFixture.recentTransactions[0].amount, /\$1,\d{3}\.\d{2}/);
  assert.match(dashboardRealDataLayoutFixture.recentTransactions[1].profit, /^-/);
  assert.ok(dashboardRealDataLayoutFixture.inventoryRows.length >= 5);
  assert.ok(dashboardRealDataLayoutFixture.topProducts.length >= 3);

  assert.match(app, /function dashboardCustomerParts\(customer: string\)/, "customer display is presentation-only");
  assert.match(dashboardPanel, /className="commerce-sales-item-copy"[\s\S]*<strong title=\{row\.reference\}>\{row\.reference\}<\/strong>[\s\S]*<small title=\{row\.productName\}>\{row\.productName\}<\/small>/, "reference and product summary render as separate elements");
  assert.match(dashboardPanel, /className="commerce-sales-customer"[\s\S]*<strong title=\{row\.customer\}>\{customerParts\.primary\}<\/strong>[\s\S]*customerParts\.secondary[\s\S]*<small title=\{customerParts\.secondary\}>/, "customer name and email render as separate elements when available");
  assert.match(dashboardPanel, /className="commerce-money-cell" data-label="Amount"/, "amount uses a protected money cell");
  assert.match(dashboardPanel, /commerce-profit-cell[\s\S]*data-label="Profit"/, "profit uses a protected money cell");
  assert.match(dashboardPanel, /className="commerce-sales-status-cell" data-label="Status"/, "status badge has its own stable cell");
  assert.match(dashboardPanel, /className="commerce-inventory-copy"[\s\S]*<strong title=\{row\.item\.itemName\}>[\s\S]*<small title=\{dashboardInventoryIdentifier\(row\.item\)\}>/, "inventory title and identifier render separately");
  assert.match(dashboardPanel, /className="commerce-inventory-quantity"/);
  assert.match(dashboardPanel, /commerce-inventory-status/);
  assert.match(dashboardPanel, /className="commerce-top-number" data-label="Units Sold"/);
  assert.match(dashboardPanel, /className="commerce-top-number" data-label="Revenue"/);
  assert.match(dashboardPanel, /className=\{`commerce-top-number \$\{product\.verifiedProfit/, "top product profit column keeps numeric class");
  assert.match(dashboardPanel, /dashboardActionItems\(\{[\s\S]*ordersToShip[\s\S]*productsOutOfStock[\s\S]*missingShipping/s, "Action Center counts still come from approved conditions");

  assert.match(css, /\.commerce-sales-item-copy small[\s\S]*-webkit-line-clamp:2/, "long product summaries clamp instead of overlapping");
  assert.match(css, /\.commerce-sales-customer small[\s\S]*text-overflow:ellipsis/, "long emails truncate safely");
  assert.match(css, /\.commerce-money-cell[\s\S]*font-variant-numeric:tabular-nums[\s\S]*white-space:nowrap/, "currency cells do not wrap");
  assert.match(css, /\.commerce-sales-status-cell \.commerce-badge[\s\S]*max-width:100%/, "status stays inside its cell");
  assert.match(css, /\.commerce-inventory-row\{grid-template-columns:34px minmax\(0,1fr\) minmax\(36px,auto\) minmax\(98px,auto\)/, "inventory rows reserve product, quantity, and badge columns");
  assert.match(css, /\.commerce-inventory-copy strong[\s\S]*-webkit-line-clamp:2/, "long inventory titles use two-line clamping");
  assert.match(css, /@media \(max-width:768px\)[\s\S]*\.commerce-table-head,\s*\.commerce-top-head\{display:none\}/, "mobile hides desktop table headers at 768px and below");
  assert.match(css, /@media \(max-width:768px\)[\s\S]*\.commerce-sales-row\{display:grid;grid-template-columns:1fr/, "mobile sales rows become cards at 768px and below");
  assert.match(css, /@media \(max-width:768px\)[\s\S]*\.commerce-top-row\{display:grid;grid-template-columns:1fr/, "mobile top products become cards at 768px and below");
  assert.match(css, /\.commerce-action-row\{grid-template-columns:24px minmax\(0,1fr\) minmax\(28px,auto\)/, "Action Center keeps counts right-aligned");
  assert.doesNotMatch([dashboardPanel, css].join("\n"), /Recent Alerts|release-source failures|missing-market warnings|retailer-monitoring status|scanner status|discovery status/i);
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
