"use client";

import Image from "next/image";
import {
  AlertTriangle,
  Activity,
  Bell,
  BarChart3,
  Boxes,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Download,
  Eye,
  ExternalLink,
  FileText,
  Home,
  LineChart,
  HelpCircle,
  History,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MoreHorizontal,
  Navigation,
  PackageSearch,
  Play,
  Plus,
  PlusCircle,
  Printer,
  Radar,
  RefreshCw,
  Receipt,
  RotateCcw,
  Save,
  ScanBarcode,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  ShoppingBag,
  Star,
  Store,
  Tags,
  Trash2,
  TrendingUp,
  Trophy,
  Upload,
  Wifi,
  WifiOff,
  X
} from "lucide-react";
import {
  type FormEvent,
  type InputHTMLAttributes,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { BrowserCodeReader, BrowserMultiFormatOneDReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType, type Result } from "@zxing/library";
import { normalizeUPC } from "@/lib/upc";
import type {
  AppHealthDTO,
  CardDTO,
  CardCompSaleDTO,
  CompSourceQuality,
  DashboardDTO,
  Era,
  GradeType,
  InvestmentReportDTO,
  InvestmentReportItemDTO,
  Priority,
  InventoryItemDTO,
  InventorySaleDTO,
  InventoryStockLotDTO,
  ProductDTO,
  ProductDiscoveryCandidateDTO,
  ProductDiscoverySourceDTO,
  ProductStatus,
  Rating,
  ReleaseDTO,
  RetailerDTO,
  RetailerTemplateDTO,
  SessionUser,
  SightingDTO,
  StoreDiscoveryResponseDTO,
  StoreDTO,
  StorefrontOrderDTO,
  StoreVisitResult,
  UpcLookupResultDTO,
  Zone
} from "@/types/radar";

type Tab =
  | "dashboard"
  | "onlineDrops"
  | "checkStock"
  | "watchlist"
  | "field"
  | "products"
  | "stores"
  | "releases"
  | "cards"
  | "inventory"
  | "orders"
  | "sales"
  | "alerts"
  | "keywords"
  | "market"
  | "profitLoss"
  | "trends"
  | "myStore"
  | "analytics"
  | "settings"
  | "admin";
type Toast = { type: "error" | "success"; message: string };
type SubmitHandler = <T>(
  event: FormEvent<HTMLFormElement>,
  label: string,
  run: (form: HTMLFormElement) => Promise<T>,
  options?: { reset?: boolean; success?: string; reauth?: boolean }
) => Promise<void>;
type ActionHandler = <T>(
  label: string,
  run: () => Promise<T>,
  options?: { confirm?: string; reload?: boolean; success?: string }
) => Promise<void>;
type InventoryPurchasePrefill = {
  upc?: string;
  itemName?: string;
  brand?: string | null;
  category?: string | null;
  setName?: string | null;
  description?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  msrp?: number | null;
  sku?: string | null;
  productId?: string | null;
  retailer?: string | null;
  exactProductUrl?: string | null;
  imageUrl?: string | null;
  source?: string | null;
};

type NavSection = "main" | "tracker" | "inventory" | "analytics" | "store" | "manage";

const navSectionLabels: Record<NavSection, string> = {
  main: "Main",
  tracker: "Tracker",
  inventory: "Inventory",
  analytics: "Analytics",
  store: "Store",
  manage: "Manage"
};

const tabs: Array<{ id: Tab; label: string; icon: typeof Radar; section: NavSection }> = [
  { id: "dashboard", label: "Dashboard", icon: Home, section: "main" },
  { id: "inventory", label: "Inventory", icon: Trophy, section: "inventory" },
  { id: "orders", label: "Orders", icon: ShoppingBag, section: "inventory" },
  { id: "sales", label: "Sales", icon: Receipt, section: "inventory" },
  { id: "alerts", label: "Alerts", icon: Bell, section: "inventory" },
  { id: "market", label: "Market", icon: Sparkles, section: "analytics" },
  { id: "analytics", label: "Analytics", icon: BarChart3, section: "analytics" },
  { id: "releases", label: "Releases", icon: CalendarDays, section: "manage" },
  { id: "settings", label: "Settings", icon: Settings, section: "manage" },
  { id: "admin", label: "Admin", icon: ShieldCheck, section: "manage" }
];
type NavTab = (typeof tabs)[number];
const deprecatedUiTabs = new Set<Tab>(["field", "products", "stores", "cards", "myStore"]);
const deprecatedTrackerTabs = new Set<Tab>(["onlineDrops", "checkStock", "watchlist", "keywords"]);
const deprecatedAnalyticsTabs = new Set<Tab>(["profitLoss", "trends"]);
const visibleTabIds = new Set<Tab>(tabs.map((tab) => tab.id));

const productStatuses: ProductStatus[] = [
  "UNAVAILABLE",
  "SOLD_OUT",
  "PREORDER_LIVE",
  "ADD_TO_CART_AVAILABLE",
  "IN_STOCK",
  "PRICE_CHANGE",
  "PAGE_UPDATED"
];
const priorities: Priority[] = ["LOW", "MEDIUM", "HIGH"];
const productRatings: Array<Exclude<Rating, "AVOID">> = ["BUY", "WATCH", "SKIP"];
const cardRatings: Rating[] = ["BUY", "WATCH", "SKIP", "AVOID"];
const gradeTypes: GradeType[] = ["RAW", "PSA_9", "PSA_10", "BGS_9_5", "BGS_10", "BGS_BLACK_LABEL"];
const compSourceQualities: CompSourceQuality[] = ["EBAY_SOLD", "PRICECHARTING", "TCGPLAYER", "MANUAL_ESTIMATE"];
const eras: Array<"ALL" | Era> = ["ALL", "MODERN", "VINTAGE"];
const productTypeOptions = ["ETB", "Booster Bundle", "Sleeved Booster", "Collection Box", "Booster Box", "Premium Collection"];
const storeVisitResults: StoreVisitResult[] = ["stock_seen", "empty_shelf", "vendor_spotted", "bought_product", "no_visit"];
const fieldRetailerFilters = ["ALL", "Target", "Walmart", "GameStop", "Best Buy"];
const inventoryCategories = [
  "sealed_packs",
  "sleeved_boosters",
  "etbs",
  "booster_bundles",
  "booster_boxes",
  "collection_boxes",
  "single_cards",
  "graded_cards",
  "raw_cards"
];
const inventoryStatuses = ["sealed", "opened", "graded", "raw"];
const listingStatuses = ["not_listed", "listed", "sold", "held"];
const inventoryRecommendations = ["HOLD", "SELL_NOW", "LIST_HIGH", "GRADE_FIRST", "RIP_OPEN", "AVOID_BUYING_MORE"];
const inventoryPlanOptions = [
  { value: "Hold", label: "Hold" },
  { value: "Sell raw/sealed", label: "Sell raw/sealed" },
  { value: "Grade first", label: "Grade first" },
  { value: "Rip/open", label: "Rip/open" }
];
const salePlatforms = ["ebay", "facebook", "whatnot", "friend", "local", "other"];

function inventoryCategoryFromLookup(value?: string | null) {
  const normalized = (value || "").toLowerCase();
  if (inventoryCategories.includes(normalized)) return normalized;
  if (normalized.includes("elite") || normalized.includes("etb")) return "etbs";
  if (normalized.includes("booster bundle")) return "booster_bundles";
  if (normalized.includes("booster box")) return "booster_boxes";
  if (normalized.includes("sleeved")) return "sleeved_boosters";
  if (normalized.includes("collection")) return "collection_boxes";
  if (normalized.includes("graded")) return "graded_cards";
  if (normalized.includes("raw")) return "raw_cards";
  if (normalized.includes("card")) return "single_cards";
  return "sealed_packs";
}

function formatStatus(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatGradeType(value: string) {
  return value === "BGS_BLACK_LABEL" ? "BGS Black Label" : formatStatus(value);
}

function formatSourceQuality(value: string) {
  if (value === "PRICECHARTING") return "PriceCharting";
  if (value === "TCGPLAYER") return "TCGPlayer";
  if (value === "MANUAL_ESTIMATE") return "Manual estimate";
  return "eBay sold";
}

function dataSourceLabel(value: string | null | undefined) {
  const normalized = (value || "").toLowerCase();
  if (normalized.includes("demo") || normalized.includes("seed")) return "Demo data";
  if (normalized.includes("ebay")) return "eBay";
  if (normalized.includes("pricecharting")) return "PriceCharting";
  if (normalized.includes("tcgplayer")) return "TCGPlayer";
  if (normalized.includes("retail")) return "Retail Monitor";
  if (normalized.includes("manual")) return "Manual";
  return "Unknown";
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "TBD";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "TBD";
  return `${value.toFixed(1)}%`;
}

function inventoryRecommendationTone(value: string) {
  if (["SELL_NOW", "LIST_HIGH"].includes(value)) return "good";
  if (["AVOID_BUYING_MORE", "RIP_OPEN"].includes(value)) return "bad";
  return "watch";
}

function inventoryMarketBadges(item: InventoryItemDTO, ebayStatus: DashboardDTO["ebayStatus"]) {
  const hasEbayComps = item.lastThreeComps.some((comp) => comp.sourceQuality === "EBAY_SOLD");
  const hasManualComps = item.lastThreeComps.some((comp) => comp.sourceQuality !== "EBAY_SOLD");
  const badges: Array<{ label: string; tone: "good" | "watch" | "bad" | "muted" }> = [];
  if (hasEbayComps) badges.push({ label: "Live eBay Data", tone: item.marketCompCount >= 3 ? "good" : "watch" });
  if (hasManualComps) badges.push({ label: "Manual Comp Data", tone: "watch" });
  if (!item.marketCompCount) badges.push({ label: "Market Not Collected", tone: "muted" });
  if (!ebayStatus.ready) badges.push({ label: "eBay Not Configured", tone: "watch" });
  if (item.marketCompCount > 0 && (item.marketCompCount < 3 || item.marketConfidence === "LOW")) badges.push({ label: "Low Confidence", tone: "bad" });
  const seen = new Set<string>();
  return badges.filter((badge) => {
    if (seen.has(badge.label)) return false;
    seen.add(badge.label);
    return true;
  });
}

function inventoryMarketSource(item: InventoryItemDTO) {
  if (item.lastThreeComps.some((comp) => comp.sourceQuality === "EBAY_SOLD")) return "eBay sold comps";
  if (item.lastThreeComps.length) return "Manual sold comps";
  return "No sold comps collected";
}

function inventoryMarketTableValue(item: InventoryItemDTO) {
  if (item.marketCompCount > 0) return money(item.grossMarketValue ?? item.currentMarketEstimate);
  return "Not collected";
}

function inventoryMarketTone(item: InventoryItemDTO): "good" | "watch" | "bad" | "muted" {
  if (!item.marketCompCount) return "muted";
  if ((item.marketProfitLoss ?? 0) < 0) return "bad";
  if ((item.marketRoiPercent ?? 0) >= 20) return "good";
  return "watch";
}

function monitorDetail(words: string | null | undefined, label: string) {
  if (!words) return null;
  const prefix = `${label.toLowerCase()}:`;
  return (
    words
      .split(",")
      .map((word) => word.trim())
      .find((word) => word.toLowerCase().startsWith(prefix))
      ?.slice(prefix.length)
      .trim() || null
  );
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function dateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function calendarDate(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function calendarDateParts(value: string | null | undefined) {
  const date = calendarDate(value);
  if (!date) return null;
  return {
    day: String(date.getDate()),
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date)
  };
}

function groupReleasesByYear(releases: ReleaseDTO[]) {
  const byYear = new Map<number, Map<number, ReleaseDTO[]>>();
  for (const release of releases) {
    const date = calendarDate(release.officialReleaseDate);
    if (!date) continue;
    const year = date.getFullYear();
    const month = date.getMonth();
    const months = byYear.get(year) ?? new Map<number, ReleaseDTO[]>();
    const monthReleases = months.get(month) ?? [];
    monthReleases.push(release);
    months.set(month, monthReleases);
    byYear.set(year, months);
  }

  return Array.from(byYear.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, months]) => ({
      year,
      months: Array.from(months.entries())
        .sort(([a], [b]) => a - b)
        .map(([month, monthReleases]) => ({
          month,
          label: new Intl.DateTimeFormat("en-US", { month: "long" }).format(new Date(year, month, 1)),
          releases: monthReleases.sort((a, b) => {
            const dateA = calendarDate(a.officialReleaseDate)?.getTime() ?? 0;
            const dateB = calendarDate(b.officialReleaseDate)?.getTime() ?? 0;
            return dateA - dateB || a.setName.localeCompare(b.setName);
          })
        }))
    }));
}

function relativeTime(value: string | null | undefined) {
  if (!value) return "Not scheduled";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Unknown";
  const delta = time - Date.now();
  const abs = Math.abs(delta);
  const minutes = Math.round(abs / 60000);
  if (minutes < 1) return delta >= 0 ? "now" : "just now";
  if (minutes < 60) return delta >= 0 ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return delta >= 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return delta >= 0 ? `in ${days}d` : `${days}d ago`;
}

function toDateInput(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function toDateTimeInput(value: string | null | undefined) {
  if (!value) return todayLocalInput();
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function todayLocalInput() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function todayDateInput() {
  return todayLocalInput().slice(0, 10);
}

function statusTone(value: string) {
  if (
    [
      "OK",
      "BUY",
      "IN_STOCK",
      "ADD_TO_CART_AVAILABLE",
      "PREORDER_LIVE",
      "HIGH",
      "SUCCESS",
      "CHANGED",
      "FORCED_ALERT",
      "stock_seen",
      "bought_product"
    ].includes(value)
  ) {
    return "good";
  }
  if (["WARN", "WATCH", "PRICE_CHANGE", "PAGE_UPDATED", "MEDIUM", "PENDING_CONFIRMATION", "vendor_spotted"].includes(value)) {
    return "watch";
  }
  if (["no_visit", "SKIPPED", "FALSE_POSITIVE"].includes(value)) return "muted";
  return "bad";
}

function verificationTone(value: string) {
  if (value === "VERIFIED_EXACT" || value === "UPC_MATCHED") return "good";
  if (value === "UNVERIFIED" || value === "NEEDS_IDENTIFIERS") return "watch";
  if (value === "SEARCH_OR_CATEGORY_LINK") return "watch";
  return "bad";
}

function productVerificationLabel(value: string) {
  if (value === "VERIFIED_EXACT" || value === "UPC_MATCHED") return "Verified Exact Product";
  if (value === "SEARCH_OR_CATEGORY_LINK") return "Search/Category Link";
  if (value === "NEEDS_IDENTIFIERS") return "Needs UPC/SKU";
  if (value === "POSSIBLE_MISMATCH") return "Possible Mismatch";
  if (value === "VERIFIED_URL") return "Reverify Exact Product";
  return formatStatus(value);
}

function productVerificationStages(product: ProductDTO) {
  const exactIdentity = product.verificationStatus === "VERIFIED_EXACT" || product.verificationStatus === "UPC_MATCHED";
  return [
    {
      label: "URL",
      complete: exactIdentity && Boolean(product.verifiedFinalUrl || product.url) && product.verificationStatus !== "SEARCH_OR_CATEGORY_LINK"
    },
    { label: "Title", complete: exactIdentity && Boolean(product.liveTitle) },
    { label: "ID", complete: exactIdentity && Boolean(product.retailerProductId) },
    { label: "Image", complete: exactIdentity && Boolean(product.liveImageUrl) },
    { label: "Stock", complete: exactIdentity && Boolean(product.liveStockStatus) },
    { label: "Price", complete: exactIdentity && product.livePrice !== null }
  ];
}

function productReadyForAlert(product: ProductDTO) {
  return (
    productVerificationStages(product).every((stage) => stage.complete) &&
    !product.liveBlockedType &&
    (product.liveConfidenceScore ?? 0) >= 70
  );
}

function productLiveVerified(product: ProductDTO) {
  return productReadyForAlert(product);
}

function productActionable(product: ProductDTO) {
  return productReadyForAlert(product) && ["IN_STOCK", "ADD_TO_CART_AVAILABLE", "PREORDER_LIVE"].includes(product.liveStockStatus || "");
}

function productLiveBadge(product: ProductDTO) {
  if (product.liveBlockedType) return "Blocked";
  if (product.verificationStatus === "SEARCH_OR_CATEGORY_LINK") return "Search Link";
  if (product.verificationStatus === "POSSIBLE_MISMATCH") return "Possible Mismatch";
  if (product.verificationStatus === "UNVERIFIED" || product.verificationStatus === "NEEDS_IDENTIFIERS") return "Needs Verification";
  if (productLiveVerified(product)) return "Live Verified";
  return "Not Verified";
}

function productPriceLabel(product: ProductDTO) {
  if (product.livePrice !== null && product.livePriceVerifiedAt) return money(product.livePrice);
  return "Price not verified";
}

function exactProductUrl(product: ProductDTO) {
  if (product.liveBlockedType || product.verificationStatus !== "VERIFIED_EXACT") return null;
  return product.verifiedFinalUrl || product.url;
}

function productDisplayStatus(product: ProductDTO) {
  return product.liveStockStatus || "UNAVAILABLE";
}

function productStockLabel(product: ProductDTO) {
  if (product.liveBlockedType) return "Blocked";
  if (product.liveStockStatus && product.liveStockVerifiedAt) return formatStatus(product.liveStockStatus);
  return "Stock not verified";
}

function productStockTone(product: ProductDTO) {
  if (product.liveBlockedType) return "bad";
  if (!product.liveStockStatus || !product.liveStockVerifiedAt) return "watch";
  return statusTone(product.liveStockStatus);
}

function zoneDisplay(value: Zone, dashboard: DashboardDTO) {
  if (value === "CUSTOM" && dashboard.userAreaPreferences.customZoneName) {
    return dashboard.userAreaPreferences.customZoneName;
  }
  return dashboard.zoneOptions.find((option) => option.value === value)?.label ?? "Miami";
}

function firstUrl(value: string | null | undefined) {
  return value
    ?.split(/[\n,]/)
    .map((item) => item.trim())
    .find(Boolean);
}

function storeDistanceLabel(store: StoreDTO) {
  if (store.distanceMiles !== null) return `${store.distanceMiles} mi away`;
  return store.latitude === null || store.longitude === null ? "Needs coordinates" : store.zoneLabel;
}

function storeNeedsCoordinates(store: StoreDTO) {
  return store.latitude === null || store.longitude === null;
}

function storeOptionLabel(store: StoreDTO) {
  const favorite = store.isFavorite ? "Favorite - " : "";
  const distance = store.distanceMiles === null ? store.zoneLabel : `${store.distanceMiles} mi`;
  return `${favorite}${store.storeName} - ${store.city} - ${distance} - ${store.retailerName}`;
}

function storeSearchText(store: StoreDTO) {
  return [
    store.storeName,
    store.retailerName,
    store.address,
    store.city,
    store.state,
    store.zoneLabel,
    store.distanceMiles === null ? "" : `${store.distanceMiles}`
  ]
    .join(" ")
    .toLowerCase();
}

function sortedStoreOptions(stores: StoreDTO[]) {
  return [...stores].sort(
    (a, b) =>
      Number(b.isFavorite) - Number(a.isFavorite) ||
      a.distanceRank - b.distanceRank ||
      b.prediction.confidenceScore - a.prediction.confidenceScore ||
      a.storeName.localeCompare(b.storeName)
  );
}

function cardFreshnessLabel(card: CardDTO) {
  if (!card.compCount) return "Not collected yet";
  if (!card.lastCompAt) return "Comp date unknown";
  return `Last comp ${shortDate(card.lastCompAt)}`;
}

function cardConfidenceTone(card: CardDTO) {
  if (card.compConfidenceScore >= 70) return "good";
  if (card.compConfidenceScore >= 35) return "watch";
  return "muted";
}

function cardCompConfidenceLabel(card: CardDTO) {
  const coreGrades: GradeType[] = ["RAW", "PSA_9", "PSA_10"];
  const counts = coreGrades.map(
    (gradeType) => card.lastThreeComps.filter((comp) => comp.gradeType === gradeType && comp.matchScore >= 70).length
  );
  if (counts.every((count) => count >= 3)) return "High";
  if (counts.some((count) => count >= 2)) return "Medium";
  return "Low";
}

function cardCompConfidenceTone(card: CardDTO) {
  const label = cardCompConfidenceLabel(card);
  if (label === "High") return "good";
  if (label === "Medium") return "watch";
  return "bad";
}

function compsForGrade(card: CardDTO, gradeType: GradeType) {
  return card.lastThreeComps.filter((comp) => comp.gradeType === gradeType).slice(0, 3);
}

function browserPosition(): Promise<GeolocationPosition> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return Promise.reject(new Error("This browser does not support location sharing."));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 5 * 60 * 1000,
      timeout: 10000
    });
  });
}

function saveBrowserLocation(dashboard: DashboardDTO, runAction: ActionHandler) {
  return runAction(
    "Saving browser location",
    async () => {
      const position = await browserPosition();
      await requestJson("/api/radar/area-preferences", {
        method: "PATCH",
        body: JSON.stringify({
          preferredZone: dashboard.userAreaPreferences.preferredZone,
          customZoneName: dashboard.userAreaPreferences.customZoneName ?? "",
          hideDistantStores: dashboard.userAreaPreferences.hideDistantStores,
          currentLatitude: position.coords.latitude,
          currentLongitude: position.coords.longitude
        })
      });
    },
    { success: "Location saved. Nearby and favorite stores are now ranked first." }
  );
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    }
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const issue = Array.isArray(data.issues) && data.issues[0] ? `${data.issues[0].path}: ${data.issues[0].message}` : "";
    throw new Error(issue || data.error || "Request failed");
  }
  return data as T;
}

function formJson(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form).entries());
}

function isTab(value: string | null): value is Tab {
  return Boolean(value) && (
    visibleTabIds.has(value as Tab) ||
    deprecatedUiTabs.has(value as Tab) ||
    deprecatedTrackerTabs.has(value as Tab) ||
    deprecatedAnalyticsTabs.has(value as Tab)
  );
}

function normalizeVisibleTab(value: string | null | undefined): Tab {
  const normalized = value ?? null;
  if (isTab(normalized) && deprecatedAnalyticsTabs.has(normalized)) return "analytics";
  if (isTab(normalized) && deprecatedTrackerTabs.has(normalized)) return "dashboard";
  if (isTab(normalized) && deprecatedUiTabs.has(normalized)) return "inventory";
  if (isTab(normalized) && visibleTabIds.has(normalized)) return normalized;
  return "dashboard";
}

function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

async function ensureServiceWorkerRegistration() {
  if (!pushSupported()) throw new Error("This browser does not support service worker push notifications.");
  const registration = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  void registration.update();
  return navigator.serviceWorker.ready;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function SidebarNavGroup({
  title,
  tabs,
  activeTab,
  onSelect,
  onClose
}: {
  title: string;
  tabs: NavTab[];
  activeTab: Tab;
  onSelect: (tab: Tab) => void;
  onClose: () => void;
}) {
  return (
    <div className="sidebar-nav-group">
      <span className="sidebar-section-title">{title}</span>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            className={activeTab === tab.id ? "sidebar-nav-item active" : "sidebar-nav-item"}
            key={tab.id}
            onClick={() => {
              onSelect(tab.id);
              onClose();
            }}
            type="button"
          >
            <Icon size={16} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function RadarApp() {
  const [activeTab, setActiveTabState] = useState<Tab>(() => {
    if (typeof window === "undefined") return "dashboard";
    const tab = new URLSearchParams(window.location.search).get("tab");
    return normalizeVisibleTab(tab);
  });
  const [user, setUser] = useState<SessionUser | null>(null);
  const [dashboard, setDashboard] = useState<DashboardDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const busy = busyLabel !== null;
  const isAdmin = user?.role === "ADMIN";
  const setActiveTab = useCallback((tab: Tab) => setActiveTabState(normalizeVisibleTab(tab)), []);

  function showToast(nextToast: Toast) {
    setToast(nextToast);
  }

  async function loadDashboard() {
    setError(null);
    const data = await requestJson<DashboardDTO>("/api/radar/dashboard");
    setDashboard(data);
    setUser(data.currentUser);
  }

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let mounted = true;
    async function boot() {
      try {
        const session = await requestJson<{ user: SessionUser | null }>("/api/auth/session");
        if (!mounted) return;
        setUser(session.user);
        if (session.user) {
          const data = await requestJson<DashboardDTO>("/api/radar/dashboard");
          if (!mounted) return;
          setDashboard(data);
        }
      } catch (bootError) {
        if (mounted) {
          const message = bootError instanceof Error ? bootError.message : "Could not load app";
          setError(message);
          showToast({ type: "error", message });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }
    boot();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!user || !pushSupported()) return;
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => undefined);
  }, [user]);

  useEffect(() => {
    if (!user || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") === activeTab) return;
    url.searchParams.set("tab", activeTab);
    url.searchParams.delete("focus");
    window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  }, [activeTab, user]);

  useEffect(() => {
    if (!dashboard) return;
    const focus = new URLSearchParams(window.location.search).get("focus");
    if (!focus) return;
    const timer = window.setTimeout(() => document.getElementById(focus)?.scrollIntoView({ block: "center" }), 120);
    return () => window.clearTimeout(timer);
  }, [activeTab, dashboard]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyLabel("Signing in");
    setError(null);
    try {
      const form = event.currentTarget;
      const data = formJson(form);
      const result = await requestJson<{ user: SessionUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(data)
      });
      setUser(result.user);
      await loadDashboard();
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "Login failed";
      setError(message);
      showToast({ type: "error", message });
    } finally {
      setBusyLabel(null);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setDashboard(null);
    setUser(null);
    setActiveTab("dashboard");
  }

  const submit: SubmitHandler = async (event, label, run, options = {}) => {
    event.preventDefault();
    const form = event.currentTarget;
    setBusyLabel(label);
    setError(null);
    try {
      await run(form);
      if (options.reset !== false) form.reset();
      if (options.reauth) {
        if (options.success) showToast({ type: "success", message: options.success });
        await logout();
        return;
      }
      await loadDashboard();
      if (options.success) showToast({ type: "success", message: options.success });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Action failed";
      setError(message);
      showToast({ type: "error", message });
    } finally {
      setBusyLabel(null);
    }
  };

  const runAction: ActionHandler = async (label, run, options = {}) => {
    if (options.confirm && !window.confirm(options.confirm)) return;
    setBusyLabel(label);
    setError(null);
    try {
      await run();
      if (options.reload !== false) await loadDashboard();
      if (options.success) showToast({ type: "success", message: options.success });
    } catch (actionError) {
      const message = actionError instanceof Error ? actionError.message : "Action failed";
      setError(message);
      showToast({ type: "error", message });
    } finally {
      setBusyLabel(null);
    }
  };

  const navGroups = (Object.keys(navSectionLabels) as NavSection[])
    .map((section) => ({
      section,
      tabs: tabs.filter((tab) => tab.section === section && (tab.id !== "admin" || isAdmin))
    }))
    .filter((group) => group.tabs.length);

  if (loading) {
    return (
      <main className="screen center-screen">
        <div className="loader-panel">
          <Radar className="spin-slow" size={30} />
          <span>Loading private radar</span>
        </div>
      </main>
    );
  }

  if (!user || !dashboard) {
    return (
      <>
        <LoginShell
          busy={busy}
          error={error}
          onSubmit={handleLogin}
          onInviteAccepted={async (acceptedUser) => {
            setUser(acceptedUser);
            await loadDashboard();
          }}
        />
        <ToastViewport toast={toast} onClose={() => setToast(null)} />
      </>
    );
  }

  return (
    <main className="screen app-shell">
      <aside className={sidebarOpen ? "app-sidebar open" : "app-sidebar"} aria-label="Primary navigation">
        <div className="brand-lockup sidebar-brand">
          <div className="brand-mark">
            <Radar size={19} />
          </div>
          <div>
            <h1>Poke Radar</h1>
          </div>
        </div>
        <nav className="sidebar-nav">
          {navGroups.map((group) => (
            <SidebarNavGroup
              key={group.section}
              title={navSectionLabels[group.section]}
              tabs={group.tabs}
              activeTab={activeTab}
              onSelect={setActiveTab}
              onClose={() => setSidebarOpen(false)}
            />
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>
            <strong>Pro Plan</strong>
            <small>Private Plan</small>
          </div>
          <button className="upgrade-button" type="button">Upgrade</button>
        </div>
      </aside>
      {sidebarOpen ? <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}
      <section className={activeTab === "inventory" ? "app-main app-main-inventory" : "app-main"}>
      <header className="topbar">
        <div className="mobile-section-title">
          <button className="icon-button mobile-menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation" type="button">
            <Menu size={18} />
          </button>
          <div className="topbar-search-wrap">
            <Search size={16} />
            <input aria-label="Search anything" placeholder="Search inventory, orders, UPC, alerts..." />
            <kbd>Ctrl K</kbd>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="location-pill" type="button" onClick={() => setActiveTab("inventory")}>
            Inventory <ChevronRight size={14} />
          </button>
          <button className="icon-button" aria-label="Notifications" type="button" onClick={() => setActiveTab("alerts")}>
            <Bell size={17} />
            {dashboard.alertAnalytics.unreadAlerts ? <span className="topbar-badge">{Math.min(dashboard.alertAnalytics.unreadAlerts, 9)}</span> : null}
          </button>
          <button className="icon-button" aria-label="Help" type="button">
            <HelpCircle size={17} />
          </button>
          {activeTab === "dashboard" || activeTab === "admin" ? (
            <button
              className="topbar-quick-action"
              type="button"
              onClick={() => {
                const target = document.querySelector(activeTab === "admin" ? ".admin-action-grid" : ".dashboard-quick-action-strip");
                target?.scrollIntoView({ block: "center" });
              }}
            >
              Quick Actions
              <ChevronRight size={14} />
            </button>
          ) : null}
          <button
            className="icon-button"
            disabled={busy}
            onClick={() =>
              runAction("Refresh dashboard", loadDashboard, { reload: false, success: "Dashboard refreshed" })
            }
            aria-label="Refresh dashboard"
            type="button"
          >
            <RefreshCw size={18} />
          </button>
          <button className="user-avatar" type="button" aria-label={`Signed in as ${user.name || user.email}`}>
            {(user.name || user.email || "A").slice(0, 1).toUpperCase()}
          </button>
          <button className="icon-button" disabled={busy} onClick={logout} aria-label="Log out" type="button">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-bar" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="content-grid">
        {activeTab === "dashboard" ? (
          <DashboardPanel
            dashboard={dashboard}
            setActiveTab={setActiveTab}
          />
        ) : null}
        {activeTab === "releases" ? (
          <ReleasesPanel dashboard={dashboard} isAdmin={isAdmin} busy={busy} busyLabel={busyLabel} runAction={runAction} />
        ) : null}
        {activeTab === "inventory" ? (
          <InventoryPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} runAction={runAction} />
        ) : null}
        {activeTab === "orders" ? (
          <StorefrontOrdersPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} runAction={runAction} />
        ) : null}
        {activeTab === "sales" ? <SalesPanel dashboard={dashboard} /> : null}
        {activeTab === "alerts" ? (
          <AlertsPanel
            dashboard={dashboard}
            busy={busy}
            busyLabel={busyLabel}
            submit={submit}
            runAction={runAction}
            setActiveTab={setActiveTab}
          />
        ) : null}
        {activeTab === "market" ? <MarketPanel dashboard={dashboard} setActiveTab={setActiveTab} /> : null}
        {activeTab === "profitLoss" ? <ProfitLossPanel dashboard={dashboard} /> : null}
        {activeTab === "trends" ? <TrendsPanel dashboard={dashboard} /> : null}
        {activeTab === "analytics" ? <InventoryAnalyticsPanel dashboard={dashboard} /> : null}
        {activeTab === "settings" ? (
          <SettingsPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} runAction={runAction} />
        ) : null}
        {activeTab === "admin" && isAdmin ? (
          <AdminControlPanel
            dashboard={dashboard}
            busy={busy}
            busyLabel={busyLabel}
            submit={submit}
            runAction={runAction}
            setActiveTab={setActiveTab}
          />
        ) : null}
      </section>

      <footer className="app-footer">
        <ShieldCheck size={16} />
        <span>
          Manual checkout only. Alerts and Go buttons open official retailer pages; you complete every cart, payment,
          queue, login, captcha, and purchase-limit step yourself.
        </span>
      </footer>

      <ToastViewport toast={toast} onClose={() => setToast(null)} />
      </section>
    </main>
  );
}

function AdminControlPanel({
  dashboard,
  busy,
  busyLabel,
  submit,
  runAction,
  setActiveTab
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
  setActiveTab: (tab: Tab) => void;
}) {
  const health = dashboard.health;
  return (
    <>
      <section className="dashboard-page-header admin-page-header">
        <div>
          <h2>Admin Controls</h2>
          <p>Manage account, alerts, health checks, data quality, backups, and release tools.</p>
        </div>
        <button className="primary-action" type="button" onClick={() => setActiveTab("settings")}>
          Open Settings <ChevronRight size={16} />
        </button>
      </section>

      <section className="admin-action-grid">
        <AdminActionCard
          icon={Lock}
          title="Account Settings"
          detail="Change login email and password safely."
          action="Manage Account"
          onAction={() => document.getElementById("admin-account")?.scrollIntoView({ block: "center" })}
        />
        <AdminActionCard
          icon={ClipboardList}
          title="Tracker Rebuild"
          detail="Local store and area tracking are hidden for the future Discord-style rebuild."
          action="View Note"
          onAction={() => document.getElementById("admin-deprecated-local")?.scrollIntoView({ block: "center" })}
        />
        <AdminActionCard
          icon={Bell}
          title="Notifications"
          detail={`${dashboard.notificationSettings.inApp ? "In-app on" : "In-app off"}; push/email/SMS configured from settings.`}
          action="Configure Alerts"
          onAction={() => document.getElementById("admin-notifications")?.scrollIntoView({ block: "center" })}
        />
        <AdminActionCard
          icon={Activity}
          title="Production Health"
          detail={health ? `Status ${health.status}; database ${health.database.provider}.` : "Health data is not loaded."}
          action="View Health"
          onAction={() => document.getElementById("admin-health")?.scrollIntoView({ block: "center" })}
        />
      </section>

      <AdminDeprecatedModulesNotice />

      <div className="admin-section-grid">
        <AdminSectionCard id="admin-account" icon={Lock} title="Account" detail="Login email, password, and private access controls.">
          <AdminAccountSettingsPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} />
          <AccessManagementPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} runAction={runAction} />
        </AdminSectionCard>

        <AdminSectionCard id="admin-notifications" icon={Bell} title="Alerts" detail="Notification providers, quiet hours, and test alerts.">
          <NotificationSettingsPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} runAction={runAction} />
          <AlertCalibrationPanel dashboard={dashboard} setActiveTab={setActiveTab} />
        </AdminSectionCard>

        <AdminSectionCard id="admin-health" icon={Activity} title="System" detail="Production health and required production configuration.">
          {health ? <AdminHealthPanel health={health} /> : <EmptyState icon={Activity} title="Health unavailable" detail="Health data will appear after the app loads system status." />}
        </AdminSectionCard>

        <AdminSectionCard icon={AlertTriangle} title="Data Quality" detail="Launch checklist, warnings, and calibration items.">
          <OwnerLaunchChecklistPanel dashboard={dashboard} setActiveTab={setActiveTab} />
          <SetupChecklistPanel dashboard={dashboard} setActiveTab={setActiveTab} />
          <DataQualityPanel dashboard={dashboard} setActiveTab={setActiveTab} />
        </AdminSectionCard>

        <AdminSectionCard icon={CalendarDays} title="Releases" detail="Add, import, and maintain yearly Pokemon TCG drop data.">
          <ReleaseManagementPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} runAction={runAction} />
        </AdminSectionCard>

        <AdminSectionCard icon={Download} title="Backups" detail="JSON import/export, demo reset, and private recovery tools.">
          <AdminTools busy={busy} busyLabel={busyLabel} submit={submit} runAction={runAction} />
        </AdminSectionCard>

        <AdminSectionCard icon={FileText} title="Archive" detail="Daily recaps, inventory workflow, and saved operational history.">
          <TodayPlanPanel dashboard={dashboard} setActiveTab={setActiveTab} busy={busy} busyLabel={busyLabel} runAction={runAction} />
        </AdminSectionCard>
      </div>
    </>
  );
}

function AdminActionCard({
  icon: Icon,
  title,
  detail,
  action,
  onAction
}: {
  icon: typeof Radar;
  title: string;
  detail: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <button className="admin-action-card" type="button" onClick={onAction}>
      <span className="admin-action-icon">
        <Icon size={19} />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <b>{action}</b>
    </button>
  );
}

function AdminDeprecatedModulesNotice() {
  return (
    <section className="admin-deprecated-note" id="admin-deprecated-local">
      <span className="admin-action-icon">
        <ArchiveIcon />
      </span>
      <div>
        <strong>Local store/area tracking is deprecated and hidden</strong>
        <p>Stores, Field Mode, My Area, sightings, nearby store discovery, and local restock prediction UI are preserved in the database but hidden for a future Discord-style tracker rebuild. Inventory, Orders, Storefront, Alerts, Releases, Market, Analytics, Settings, and Admin remain active.</p>
      </div>
    </section>
  );
}

function ArchiveIcon() {
  return <FileText size={18} />;
}

function AdminSectionCard({
  id,
  icon: Icon,
  title,
  detail,
  children
}: {
  id?: string;
  icon: typeof Radar;
  title: string;
  detail: string;
  children: ReactNode;
}) {
  return (
    <section className="admin-section-card" id={id}>
      <div className="admin-section-heading">
        <span className="admin-section-icon">
          <Icon size={18} />
        </span>
        <div>
          <h3>{title}</h3>
          <p>{detail}</p>
        </div>
      </div>
      <div className="admin-section-body">{children}</div>
    </section>
  );
}

function LoginShell({
  busy,
  error,
  onSubmit,
  onInviteAccepted
}: {
  busy: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onInviteAccepted: (user: SessionUser) => Promise<void>;
}) {
  const resetTokenFromUrl =
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("resetToken") || "";
  const inviteTokenFromUrl =
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("inviteToken") || "";
  const [mode, setMode] = useState<"login" | "forgot" | "reset" | "invite">(
    inviteTokenFromUrl ? "invite" : resetTokenFromUrl ? "reset" : "login"
  );
  const [localBusy, setLocalBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const formBusy = busy || localBusy;

  async function handleForgotPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalBusy(true);
    setLocalError(null);
    setLocalMessage(null);
    try {
      const result = await requestJson<{ message: string; expiresInMinutes: number }>("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify(formJson(event.currentTarget))
      });
      event.currentTarget.reset();
      setLocalMessage(`${result.message} Reset links expire in ${result.expiresInMinutes} minutes.`);
    } catch (forgotError) {
      setLocalError(forgotError instanceof Error ? forgotError.message : "Password reset request failed");
    } finally {
      setLocalBusy(false);
    }
  }

  async function handleResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalBusy(true);
    setLocalError(null);
    setLocalMessage(null);
    try {
      const form = event.currentTarget;
      await requestJson("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify(formJson(form))
      });
      form.reset();
      if (typeof window !== "undefined") window.history.replaceState(null, "", window.location.pathname);
      setMode("login");
      setLocalMessage("Password reset. Sign in with the new password.");
    } catch (resetError) {
      setLocalError(resetError instanceof Error ? resetError.message : "Password reset failed");
    } finally {
      setLocalBusy(false);
    }
  }

  async function handleAcceptInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalBusy(true);
    setLocalError(null);
    setLocalMessage(null);
    try {
      const form = event.currentTarget;
      const result = await requestJson<{ user: SessionUser }>("/api/auth/invite/accept", {
        method: "POST",
        body: JSON.stringify(formJson(form))
      });
      if (typeof window !== "undefined") window.history.replaceState(null, "", window.location.pathname);
      await onInviteAccepted(result.user);
    } catch (inviteError) {
      setLocalError(inviteError instanceof Error ? inviteError.message : "Invite acceptance failed");
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <main className="screen login-screen">
      <section className="login-panel">
        <div className="brand-mark large">
          <Radar size={30} />
        </div>
        <div className="login-copy">
          <p className="eyeline">Private access only</p>
          <h1>Poke Restock Radar</h1>
          <p>Manual restock, store, release, alert, and card grading radar for a small trusted group.</p>
        </div>
        {mode === "login" ? (
          <form className="form-stack" onSubmit={onSubmit}>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" autoCapitalize="none" inputMode="email" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            {localMessage ? <p className="form-success">{localMessage}</p> : null}
            <button className="primary-action full" disabled={formBusy} type="submit">
              <Lock size={16} />
              {busy ? "Signing In" : "Sign In"}
            </button>
            <button className="mini-action full" type="button" disabled={formBusy} onClick={() => setMode("forgot")}>
              Forgot Password
            </button>
          </form>
        ) : null}
        {mode === "forgot" ? (
          <form className="form-stack" onSubmit={handleForgotPassword}>
            <label>
              Account email
              <input name="email" type="email" autoComplete="email" autoCapitalize="none" inputMode="email" required />
            </label>
            {localError ? <p className="form-error">{localError}</p> : null}
            {localMessage ? <p className="form-success">{localMessage}</p> : null}
            <button className="primary-action full" disabled={formBusy} type="submit">
              <Mail size={16} />
              {localBusy ? "Sending" : "Send Reset Link"}
            </button>
            <button className="mini-action full" type="button" disabled={formBusy} onClick={() => setMode("login")}>
              Back to Sign In
            </button>
          </form>
        ) : null}
        {mode === "reset" ? (
          <form className="form-stack" onSubmit={handleResetPassword}>
            <label>
              Reset token
              <input name="token" defaultValue={resetTokenFromUrl} autoComplete="one-time-code" required />
            </label>
            <label>
              New password
              <input name="password" type="password" autoComplete="new-password" required />
            </label>
            <label>
              Confirm new password
              <input name="confirmPassword" type="password" autoComplete="new-password" required />
            </label>
            {localError ? <p className="form-error">{localError}</p> : null}
            {localMessage ? <p className="form-success">{localMessage}</p> : null}
            <button className="primary-action full" disabled={formBusy} type="submit">
              <Save size={16} />
              {localBusy ? "Resetting" : "Reset Password"}
            </button>
            <button className="mini-action full" type="button" disabled={formBusy} onClick={() => setMode("login")}>
              Back to Sign In
            </button>
          </form>
        ) : null}
        {mode === "invite" ? (
          <form className="form-stack" onSubmit={handleAcceptInvite}>
            <label>
              Invite token
              <input name="token" defaultValue={inviteTokenFromUrl} autoComplete="one-time-code" required />
            </label>
            <label>
              Invited email
              <input name="email" type="email" autoComplete="email" autoCapitalize="none" inputMode="email" required />
            </label>
            <label>
              Name
              <input name="name" autoComplete="name" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="new-password" required />
            </label>
            <label>
              Confirm password
              <input name="confirmPassword" type="password" autoComplete="new-password" required />
            </label>
            {localError ? <p className="form-error">{localError}</p> : null}
            <button className="primary-action full" disabled={formBusy} type="submit">
              <Lock size={16} />
              {localBusy ? "Creating Account" : "Accept Friend Invite"}
            </button>
            <button className="mini-action full" type="button" disabled={formBusy} onClick={() => setMode("login")}>
              Back to Sign In
            </button>
          </form>
        ) : null}
        <div className="safety-strip">
          <ShieldCheck size={16} />
          <span>Official retailer pages only. Checkout stays manual.</span>
        </div>
      </section>
    </main>
  );
}

function ToastViewport({ toast, onClose }: { toast: Toast | null; onClose: () => void }) {
  if (!toast) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      <div className={`toast ${toast.type}`}>
        {toast.type === "error" ? <AlertTriangle size={16} /> : <Check size={16} />}
        <span>{toast.message}</span>
        <button className="icon-button compact" type="button" aria-label="Dismiss toast" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// Deprecated Products/Stores/Cards UI is intentionally preserved for future rebuild.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getChaseSummary(dashboard: DashboardDTO | null): {
  title: string;
  reason: string;
  priority: Priority;
  url?: string;
  tab: Tab;
  product: ProductDTO | null;
} {
  const actionable = dashboard?.products.find((product) => productActionable(product));
  const chaseProduct = dashboard?.todaysChaseList.find((product) => productReadyForAlert(product));
  if (chaseProduct?.priorityScore) {
    return {
      title: chaseProduct.name,
      reason: chaseProduct.priorityScore.reason,
      priority: chaseProduct.priorityScore.buyWatchSkip === "BUY" ? "HIGH" : "MEDIUM",
      url: exactProductUrl(chaseProduct) ?? undefined,
      tab: "inventory",
      product: chaseProduct
    };
  }
  if (actionable) {
    return {
      title: actionable.name,
      reason: `${actionable.retailerName} is ${formatStatus(productDisplayStatus(actionable)).toLowerCase()} at ${productPriceLabel(
        actionable
      )}. Open the verified product page and check out manually.`,
      priority: actionable.priority,
      url: exactProductUrl(actionable) ?? undefined,
      tab: "inventory",
      product: actionable
    };
  }

  return {
    title: "Build your inventory workflow",
    reason: "Start with inventory, sales, orders, releases, or market comps.",
    priority: "MEDIUM",
    tab: "inventory",
    product: null
  };
}

function DashboardPanel({
  dashboard,
  setActiveTab
}: {
  dashboard: DashboardDTO;
  setActiveTab: (tab: Tab) => void;
}) {
  const liveAlert = dashboard.alerts.find((alert) => !isTestDashboardAlert(alert) && !isDeprecatedLocalStoreAlert(alert) && !alert.read) ?? null;
  const visibleAlerts = dashboard.alerts.filter((alert) => !isTestDashboardAlert(alert) && !isDeprecatedLocalStoreAlert(alert)).slice(0, 5);
  const profitValue = (item: InventoryItemDTO) => item.marketProfitLoss ?? item.businessProfitLoss ?? 0;
  const productsInStock = dashboard.inventory.filter((item) => item.quantityOwned > 0).length;
  const needsAttention =
    dashboard.inventorySummary.missingMarketDataCount +
    dashboard.inventory.filter((item) => item.quantityOwned > 0 && item.quantityOwned <= 2).length +
    dashboard.storefrontSummary.pendingOrderCount;
  const publishedStoreProducts = dashboard.inventory.filter(
    (item) => item.publishToStore && item.storeStatus === "active" && (item.availableForSale ?? item.quantityOwned) > 0
  ).length;
  const watchlistItems = dashboard.inventory
    .filter((item) => item.quantityOwned > 0 || item.publishToStore)
    .sort((a, b) => (b.quantityOwned + (b.availableForSale ?? 0)) - (a.quantityOwned + (a.availableForSale ?? 0)))
    .slice(0, 5);
  const bestPerforming = dashboard.inventory
    .filter((item) => item.businessProfitLoss !== 0 || item.marketProfitLoss !== null)
    .sort((a, b) => profitValue(b) - profitValue(a))
    .slice(0, 3);
  const activityItems = [
    ...dashboard.storefrontOrders.map((order) => ({
      id: order.id,
      icon: ShoppingBag,
      title: `Order ${order.orderNumber}`,
      detail: `${formatStatus(order.status)} - ${money(order.total)}`,
      time: order.createdAt
    })),
    ...dashboard.inventory.map((item) => ({
      id: item.id,
      icon: Boxes,
      title: `${item.itemName} added`,
      detail: `Qty ${item.quantityOwned} - ${item.category}`,
      time: item.createdAt
    })),
    ...dashboard.alerts
      .filter((alert) => !isDeprecatedLocalStoreAlert(alert) && !isTestDashboardAlert(alert))
      .map((alert) => ({
        id: alert.id,
        icon: Bell,
        title: alert.title,
        detail: alert.priority,
        time: alert.timestamp
      }))
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 4);
  const marketValueLabel = dashboard.inventorySummary.marketValue === null ? "Not collected" : money(dashboard.inventorySummary.marketValue);
  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setDate(now.getDate() - 7);

  return (
    <>
      <section className="dashboard-page-header overview-header">
        <div>
          <h1>Overview</h1>
          <p>Your Pokemon business at a glance</p>
        </div>
        <button className="date-range-pill" type="button">
          <CalendarDays size={15} />
          {shortDate(rangeStart.toISOString())} - {shortDate(now.toISOString())}
          <ChevronRight size={14} />
        </button>
      </section>
      <DashboardAlertBanner alert={liveAlert} setActiveTab={setActiveTab} />
      <section className="dashboard-metric-grid" aria-label="Dashboard summary">
        <DashboardMetricCard
          icon={Boxes}
          label="Total Inventory Value"
          value={marketValueLabel}
          detail={dashboard.inventorySummary.marketValue === null ? "Needs market data" : "Verified comps only"}
          tone="green"
        />
        <DashboardMetricCard
          icon={ShoppingBag}
          label="Products In Stock"
          value={productsInStock}
          detail={`${dashboard.inventorySummary.itemsOwned} total items`}
          tone="blue"
        />
        <DashboardMetricCard
          icon={CircleDollarSign}
          label="Total Profit"
          value={money(dashboard.inventorySummary.realizedProfitLoss)}
          detail="Recorded sales only"
          tone={dashboard.inventorySummary.realizedProfitLoss >= 0 ? "green" : "amber"}
        />
        <DashboardMetricCard
          icon={Bell}
          label="Active Alerts"
          value={dashboard.alertAnalytics.unreadAlerts}
          detail={`${visibleAlerts.length} visible alerts`}
          tone={dashboard.alertAnalytics.unreadAlerts ? "amber" : "green"}
        />
        <DashboardMetricCard
          icon={AlertTriangle}
          label="Needs Attention"
          value={needsAttention}
          detail={`${dashboard.inventorySummary.missingMarketDataCount} missing market`}
          tone={needsAttention ? "amber" : "green"}
        />
      </section>
      <section className="dashboard-quick-action-strip" aria-label="More Actions">
        <QuickActionRow icon={ScanBarcode} title="Add Inventory" description="Scan UPC or add product" onClick={() => setActiveTab("inventory")} />
        <QuickActionRow icon={ShoppingBag} title="Orders" description="Review paid and pending orders" onClick={() => setActiveTab("orders")} />
        <QuickActionRow icon={Receipt} title="Sales" description="Record and review sold items" onClick={() => setActiveTab("sales")} />
        <QuickActionRow icon={Bell} title="Alerts" description="Review active notifications" onClick={() => setActiveTab("alerts")} />
        <QuickActionRow icon={CalendarDays} title="Releases" description="Track upcoming product drops" onClick={() => setActiveTab("releases")} />
      </section>
      <section className="dashboard-main-grid">
        <section className="dashboard-card recent-alerts-card">
          <div className="dashboard-card-header">
            <div>
              <h2>Recent Alerts</h2>
              <p>Latest restock, order, and inventory alerts.</p>
            </div>
            <button className="link-button" type="button" onClick={() => setActiveTab("alerts")}>
              View all alerts
            </button>
          </div>
          <div className="recent-alert-list">
            {visibleAlerts.length ? (
              visibleAlerts.map((alert) => (
                <RecentAlertRow key={alert.id} alert={alert} products={dashboard.products} setActiveTab={setActiveTab} />
              ))
            ) : (
              <div className="dashboard-empty-card">
                <EmptyState icon={Bell} title="No recent alerts yet" detail="Inventory, orders, and storefront alerts will appear here." />
                <div className="dashboard-empty-actions">
                  <button className="mini-action solid" type="button" onClick={() => setActiveTab("inventory")}>
                    <PlusCircle size={14} />
                    Add Inventory
                  </button>
                  <button className="mini-action" type="button" onClick={() => setActiveTab("inventory")}>Add Inventory</button>
                </div>
              </div>
            )}
          </div>
        </section>
        <section className="dashboard-card watchlist-card">
          <div className="dashboard-card-header">
            <div>
              <h2>Inventory Watch</h2>
              <p>Products you own or have listed publicly.</p>
            </div>
            <button className="link-button" type="button" onClick={() => setActiveTab("inventory")}>View all</button>
          </div>
          <div className="dashboard-compact-list">
            {watchlistItems.length ? (
              watchlistItems.map((item) => (
                <DashboardInventoryWatchRow key={item.id} item={item} />
              ))
            ) : (
              <EmptyState icon={Trophy} title="No inventory yet" detail="Add inventory or publish a listing to build this list." />
            )}
          </div>
        </section>
      </section>
      <section className="dashboard-secondary-grid">
        <section className="dashboard-card">
          <div className="dashboard-card-header compact">
            <div>
              <h2>Activity Feed</h2>
              <p>Recent orders, inventory, and alerts.</p>
            </div>
            <button className="link-button" type="button" onClick={() => setActiveTab("analytics")}>View all</button>
          </div>
          <div className="dashboard-compact-list">
            {activityItems.length ? (
              activityItems.map((item) => (
                <DashboardSimpleRow
                  key={item.id}
                  icon={item.icon}
                  title={item.title}
                  detail={item.detail}
                  value={relativeTime(item.time)}
                />
              ))
            ) : (
              <EmptyState icon={Activity} title="No activity yet" detail="Orders, inventory additions, and alerts will show here." />
            )}
          </div>
        </section>
        <section className="dashboard-card">
          <div className="dashboard-card-header compact">
            <div>
              <h2>Best Performing</h2>
              <p>Only uses real sales or saved market estimates.</p>
            </div>
            <button className="link-button" type="button" onClick={() => setActiveTab("analytics")}>View report</button>
          </div>
          <div className="dashboard-compact-list">
            {bestPerforming.length ? (
              bestPerforming.map((item) => (
              <DashboardSimpleRow
                  key={item.id}
                  icon={TrendingUp}
                  title={item.itemName}
                  detail={item.marketCompCount ? "Market comps saved" : "Sales history"}
                  value={money(profitValue(item))}
                  tone={profitValue(item) >= 0 ? "good" : "bad"}
              />
              ))
            ) : (
              <EmptyState icon={LineChart} title="No performance data yet" detail="Record sales or add comps to see winners here." />
            )}
          </div>
        </section>
        <section className="dashboard-card">
          <div className="dashboard-card-header compact">
            <div>
              <h2>Storefront Status</h2>
              <p>No backend health clutter here, just the user-facing scanner queue.</p>
            </div>
          </div>
          <div className="quick-action-list">
            <DashboardStatusRow label="Published products" value={publishedStoreProducts} />
            <DashboardStatusRow label="Open orders" value={dashboard.storefrontSummary.pendingOrderCount} />
            <DashboardStatusRow label="UPC scanner" value="Ready" tone="good" />
            <DashboardStatusRow label="Manual checkout" value="Required" />
          </div>
        </section>
      </section>
    </>
  );
}

function DashboardMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone
}: {
  icon: typeof Radar;
  label: string;
  value: string | number;
  detail: string;
  tone: "green" | "amber" | "blue";
}) {
  return (
    <article className={`dashboard-metric-card tone-${tone}`}>
      <span className="metric-icon">
        <Icon size={24} />
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function DashboardAlertBanner({
  alert,
  setActiveTab
}: {
  alert: DashboardDTO["alerts"][number] | null;
  setActiveTab: (tab: Tab) => void;
}) {
  const alertSummary = alert
    ? `${formatStatus(alert.priority)} priority alert. Open details for the full reason.`
    : "";

  if (!alert) {
    return (
      <section className="dashboard-live-alert is-idle">
        <div className="live-alert-icon">
          <Bell size={20} />
        </div>
        <div className="live-alert-copy">
          <span>No urgent alerts right now</span>
          <strong>Your inventory and storefront are quiet.</strong>
          <p>New order, inventory, storefront, and release alerts will appear here.</p>
        </div>
        <div className="live-alert-actions">
          <button className="mini-action solid" type="button" onClick={() => setActiveTab("inventory")}>
            Open Inventory
          </button>
          <button className="mini-action" type="button" onClick={() => setActiveTab("orders")}>Open Orders</button>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-live-alert">
      <div className="live-alert-icon">
        <Bell size={20} />
      </div>
      <div className="live-alert-copy">
        <span>Latest Alert</span>
        <strong>{alert.title}</strong>
        <p>{alertSummary}{alert.score ? ` Score ${alert.score}.` : ""}</p>
        <small>{formatStatus(alert.priority)} priority - {relativeTime(alert.timestamp)}</small>
      </div>
      <div className="live-alert-actions">
        {alert.actionUrl ? (
          <a className="primary-action" href={alert.actionUrl} target="_blank" rel="noreferrer">
            Go / Buy Now <ExternalLink size={14} />
          </a>
        ) : null}
        <button className="mini-action" type="button" onClick={() => setActiveTab("alerts")}>
          View Details
        </button>
      </div>
    </section>
  );
}

function DashboardStatusRow({ label, value, tone = "muted" }: { label: string; value: string | number; tone?: "good" | "bad" | "muted" }) {
  return (
    <div className="dashboard-status-row">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function DashboardSimpleRow({
  icon: Icon,
  title,
  detail,
  value,
  tone = "muted"
}: {
  icon: typeof Radar;
  title: string;
  detail: string;
  value: string;
  tone?: "good" | "bad" | "warn" | "muted";
}) {
  return (
    <article className="dashboard-simple-row">
      <span>
        <Icon size={16} />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      <em className={tone}>{value}</em>
    </article>
  );
}

function DashboardInventoryWatchRow({ item }: { item: InventoryItemDTO }) {
  const status = item.quantityOwned <= 0 ? "Sold Out" : item.quantityOwned <= 2 ? "Low Stock" : "In Stock";
  return (
    <article className="dashboard-watch-row">
      <ProductImagePreview imageUrl={item.imageUrl ?? ""} itemName={item.itemName} />
      <div className="dashboard-watch-info text-safe">
        <strong className="text-safe">{item.itemName}</strong>
        <span className="text-safe">{item.source || item.retailer || item.category || "Inventory"}</span>
      </div>
      <div className="dashboard-watch-count">
        <b>{item.quantityOwned}</b>
        <small>{status}</small>
      </div>
    </article>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function OnlineDropsPanel({ dashboard, setActiveTab }: { dashboard: DashboardDTO; setActiveTab: (tab: Tab) => void }) {
  const onlineAlerts = dashboard.alerts
    .filter((alert) => !isDeprecatedLocalStoreAlert(alert) && !isTestDashboardAlert(alert))
    .slice(0, 10);
  return (
    <>
      <SectionIntro
        title="Online Drops"
        detail="Discord-style feed for product drops and online restock alerts. Exact monitoring stays conservative and manual-checkout only."
        stats={[{ label: "alerts", value: onlineAlerts.length }, { label: "tracked inventory", value: dashboard.inventory.length }]}
      />
      <section className="module-grid two">
        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <h2>Drop Feed</h2>
              <p>Recent non-local alerts. Test alerts and deprecated local store alerts stay hidden here.</p>
            </div>
            <button className="mini-action" type="button" onClick={() => setActiveTab("alerts")}>Open Alerts</button>
          </div>
          <div className="recent-alert-list">
            {onlineAlerts.length ? onlineAlerts.map((alert) => (
              <RecentAlertRow key={alert.id} alert={alert} products={dashboard.products} setActiveTab={setActiveTab} />
            )) : <EmptyState icon={Wifi} title="No online drops right now" detail="Online drop alerts will appear here when verified data exists." />}
          </div>
        </div>
        <div className="dashboard-card">
          <div className="dashboard-card-header compact">
            <h2>Scanner Rules</h2>
          </div>
          <div className="quick-action-list">
            <DashboardStatusRow label="Manual checkout" value="Always" />
            <DashboardStatusRow label="Search pages" value="Review only" />
            <DashboardStatusRow label="Buy alerts" value="Exact match" />
            <DashboardStatusRow label="Old local tracker" value="Hidden" />
          </div>
        </div>
      </section>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CheckStockPanel({ dashboard, setActiveTab }: { dashboard: DashboardDTO; setActiveTab: (tab: Tab) => void }) {
  const inStock = dashboard.inventory.filter((item) => item.quantityOwned > 0);
  return (
    <>
      <SectionIntro
        title="Check Stock"
        detail="Manual operating screen for checking what you have available without the old local store prediction module."
        stats={[{ label: "products in stock", value: inStock.length }, { label: "items owned", value: dashboard.inventorySummary.itemsOwned }]}
      />
      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <div>
            <h2>Available Inventory</h2>
            <p>Use this for quick in-hand stock checks. No browser location or local store predictions are active.</p>
          </div>
          <button className="primary-action" type="button" onClick={() => setActiveTab("inventory")}>
            Open Inventory <ChevronRight size={15} />
          </button>
        </div>
        <div className="dashboard-compact-list">
          {inStock.slice(0, 12).map((item) => (
            <DashboardInventoryWatchRow key={item.id} item={item} />
          ))}
          {!inStock.length ? <EmptyState icon={PackageSearch} title="No stock to check" detail="Add inventory to start checking product availability." /> : null}
        </div>
      </section>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function WatchlistPanel({ dashboard, setActiveTab }: { dashboard: DashboardDTO; setActiveTab: (tab: Tab) => void }) {
  const watched = dashboard.inventory.filter((item) => item.quantityOwned > 0 || item.publishToStore || item.marketCompCount > 0);
  return (
    <>
      <SectionIntro
        title="Watchlist"
        detail="A clean list of inventory and listings you are actively watching. Old card opportunity panels remain hidden."
        stats={[{ label: "watched", value: watched.length }, { label: "published", value: dashboard.storefrontSummary.activeProductCount }]}
      />
      <section className="dashboard-card">
        <div className="dashboard-card-header">
          <div>
            <h2>Tracked Items</h2>
            <p>Based on inventory, public listings, and saved market comps.</p>
          </div>
          <button className="mini-action" type="button" onClick={() => setActiveTab("inventory")}>Manage Inventory</button>
        </div>
        <div className="dashboard-compact-list">
          {watched.length ? watched.map((item) => <DashboardInventoryWatchRow key={item.id} item={item} />) : (
            <EmptyState icon={Star} title="No watchlist yet" detail="Add inventory or publish products to build this list." />
          )}
        </div>
      </section>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function KeywordsPanel({ dashboard }: { dashboard: DashboardDTO }) {
  const categories = dashboard.inventorySummary.quantityByCategory.slice(0, 8);
  return (
    <>
      <SectionIntro title="Keywords" detail="Lightweight keyword workspace for future tracker tuning. No old Cards module is shown." />
      <section className="module-grid two">
        <div className="dashboard-card">
          <div className="dashboard-card-header compact">
            <h2>Inventory Keywords</h2>
          </div>
          <div className="keyword-chip-cloud">
            {categories.length ? categories.map((item) => (
              <span className="chip good" key={item.category}>{formatStatus(item.category)} · {item.quantity}</span>
            )) : <span className="chip muted">No inventory keywords yet</span>}
          </div>
        </div>
        <div className="dashboard-card">
          <EmptyState icon={Tags} title="Keyword tracker coming next" detail="This page is ready for search terms, drop keywords, and alert tuning when you define the new flow." />
        </div>
      </section>
    </>
  );
}

function SalesPanel({ dashboard }: { dashboard: DashboardDTO }) {
  const sales = dashboard.inventory.flatMap((item) => item.sales);
  return (
    <section className="sales-page">
      <SalesLog
        items={dashboard.inventory}
        sales={sales}
        selectedItem={dashboard.inventory[0] ?? null}
        summary={dashboard.inventorySummary}
        onRecordSale={() => undefined}
      />
    </section>
  );
}

function ProfitLossPanel({ dashboard }: { dashboard: DashboardDTO }) {
  const summary = dashboard.inventorySummary;
  return (
    <>
      <SectionIntro title="Profit & Loss" detail="Cost basis, sales, and profit using recorded inventory data only." />
      <section className="inventory-kpi-grid">
        <InventoryKpiCard label="Total Spent" value={money(summary.totalSpent)} detail="Purchase lots and extra costs" />
        <InventoryKpiCard label="Total Sales" value={money(summary.totalSalesGross)} detail={`${summary.itemsSold} sold`} tone="good" />
        <InventoryKpiCard label="Realized Profit" value={money(summary.realizedProfitLoss)} detail="Sales minus cost basis" tone={summary.realizedProfitLoss >= 0 ? "good" : "bad"} />
        <InventoryKpiCard label="Inventory Cost" value={money(summary.inventoryCostBasis)} detail={`${summary.itemsOwned} items owned`} />
      </section>
      <InventoryAnalyticsPanel dashboard={dashboard} />
    </>
  );
}

function TrendsPanel({ dashboard }: { dashboard: DashboardDTO }) {
  return (
    <>
      <SectionIntro title="Trends" detail="Simple trend view from real saved data. Unknown market values stay labeled as missing." />
      <section className="dashboard-secondary-grid">
        <div className="dashboard-card">
          <div className="dashboard-card-header compact">
            <h2>Category Mix</h2>
          </div>
          <div className="recommendation-list">
            {dashboard.inventorySummary.quantityByCategory.length ? dashboard.inventorySummary.quantityByCategory.map((item) => (
              <span key={item.category}>{formatStatus(item.category)}<b>{item.quantity}</b></span>
            )) : <span>No category data <b>0</b></span>}
          </div>
        </div>
        <div className="dashboard-card">
          <div className="dashboard-card-header compact">
            <h2>Market Freshness</h2>
          </div>
          <div className="quick-action-list">
            <DashboardStatusRow label="Missing market data" value={dashboard.inventorySummary.missingMarketDataCount} />
            <DashboardStatusRow label="eBay comp mode" value={dashboard.ebayStatus.ready ? "Live" : "Manual"} />
            <DashboardStatusRow label="Products tracked" value={dashboard.inventory.length} />
          </div>
        </div>
      </section>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function MyStorePanel({ dashboard, setActiveTab }: { dashboard: DashboardDTO; setActiveTab: (tab: Tab) => void }) {
  const published = dashboard.inventory.filter((item) => item.publishToStore);
  return (
    <>
      <SectionIntro
        title="My Store"
        detail="Public storefront manager. This is separate from the deprecated local Stores/My Area tracker."
        stats={[{ label: "published", value: published.length }, { label: "active", value: dashboard.storefrontSummary.activeProductCount }]}
      />
      <section className="module-grid two">
        <div className="dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <h2>Store Listings</h2>
              <p>Only products you publish from inventory can appear publicly.</p>
            </div>
            <a className="mini-action" href="/shop" target="_blank" rel="noreferrer">
              View Shop <ExternalLink size={14} />
            </a>
          </div>
          <div className="dashboard-compact-list">
            {published.length ? published.map((item) => <DashboardInventoryWatchRow key={item.id} item={item} />) : (
              <EmptyState icon={Store} title="No products published" detail="Open Inventory, choose a product, and edit its store listing." />
            )}
          </div>
        </div>
        <div className="dashboard-card">
          <div className="dashboard-card-header compact">
            <h2>Store Controls</h2>
          </div>
          <div className="quick-action-list">
            <QuickActionRow icon={Trophy} title="Open Inventory" description="Publish or edit product listings" onClick={() => setActiveTab("inventory")} />
            <QuickActionRow icon={ShoppingBag} title="Orders" description="Fulfill storefront purchases" onClick={() => setActiveTab("orders")} />
            <QuickActionRow icon={Settings} title="Store Settings" description="Edit policies and contact details" onClick={() => setActiveTab("orders")} />
          </div>
        </div>
      </section>
    </>
  );
}

function RecentAlertRow({
  alert,
  products,
  setActiveTab
}: {
  alert: DashboardDTO["alerts"][number];
  products: ProductDTO[];
  setActiveTab: (tab: Tab) => void;
}) {
  const product = alert.entityType === "PRODUCT" ? products.find((item) => item.id === alert.entityId) : null;
  const targetTab = alertTargetTab(alert);

  return (
    <article className="recent-alert-row">
      <div className="recent-alert-thumb">
        {product ? (
          <ProductImage product={product} />
        ) : (
          <span>
            <Bell size={18} />
          </span>
        )}
      </div>
      <div className="recent-alert-copy">
        <div className="recent-alert-title-row">
          <strong>{alert.title}</strong>
          <span className={`chip compact-chip ${statusTone(alert.priority)}`}>{alert.priority}</span>
        </div>
        <span>{product ? `${product.retailerName} - ${productStockLabel(product)}` : alert.reason}</span>
        <div className="recent-alert-meta">
          <span className={alert.read ? "recent-alert-status is-read" : "recent-alert-status"}>{alert.read ? "Viewed" : "New"}</span>
          <time>{relativeTime(alert.timestamp)}</time>
        </div>
      </div>
      <div className="recent-alert-actions">
        {alert.actionUrl ? (
          <a className="mini-action solid" href={alert.actionUrl} target="_blank" rel="noreferrer">
            Go <ExternalLink size={13} />
          </a>
        ) : null}
        <button className="mini-action" type="button" onClick={() => setActiveTab(targetTab)}>
          Details
        </button>
      </div>
    </article>
  );
}

function QuickActionRow({
  icon: Icon,
  title,
  description,
  onClick
}: {
  icon: typeof Radar;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button className="quick-action-row" type="button" onClick={onClick}>
      <span>
        <Icon size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>
      <ChevronRight size={16} />
    </button>
  );
}

function isTestDashboardAlert(alert: DashboardDTO["alerts"][number]) {
  const text = `${alert.title} ${alert.reason} ${alert.explanation || ""}`.toLowerCase();
  return text.includes("test alert") || text.includes("selected alert channel") || text.includes("confirms the selected alert");
}

function isDeprecatedLocalStoreAlert(alert: DashboardDTO["alerts"][number]) {
  const text = `${alert.title} ${alert.reason} ${alert.explanation || ""}`.toLowerCase();
  return (
    alert.entityType === "STORE" ||
    text.includes("field result") ||
    text.includes("store sighting") ||
    text.includes("shelf sighting") ||
    text.includes("local restock") ||
    text.includes("store restock") ||
    text.includes("vendor spotted")
  );
}

function alertTargetTab(alert: DashboardDTO["alerts"][number]): Tab {
  if (alert.entityType === "RELEASE") return "releases";
  if (alert.entityType === "PRODUCT" || alert.entityType === "STORE" || alert.entityType === "CARD") return "alerts";
  return "alerts";
}

function AreaSetupPanel({
  dashboard,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const locationSaved = dashboard.userAreaPreferences.currentLatitude !== null && dashboard.userAreaPreferences.currentLongitude !== null;

  return (
    <section className="zone-panel">
      <div>
        <p className="eyeline">Deprecated area setup</p>
        <h2>{zoneDisplay(dashboard.userAreaPreferences.preferredZone, dashboard)}</h2>
        <p>
          Field Mode and dashboard store lists prioritize nearby and favorite stores first. Hide non-zone stores when you only
          want the route you actually check.
        </p>
        <p>Admin default zone = Miami. Switch zones only when you are intentionally planning a different route.</p>
      </div>
      <div className="location-save-row">
        <div>
          <strong>{locationSaved ? "Browser location saved" : "Browser location not saved"}</strong>
          <span>
            {locationSaved
              ? `Nearby sorting updated ${relativeTime(dashboard.userAreaPreferences.locationUpdatedAt)}.`
              : "Save location once on your phone so dashboard and Field Mode stores start closest to you."}
          </span>
        </div>
        <button
          className="mini-action solid"
          disabled={busy}
          type="button"
          onClick={() => saveBrowserLocation(dashboard, runAction)}
        >
          <MapPin size={14} />
          {busyLabel === "Saving browser location" ? "Saving" : "Location Disabled"}
        </button>
      </div>
      <form
        className="form-grid"
        onSubmit={(event) =>
          submit(
            event,
            "Saving area preferences",
            (form) =>
              requestJson("/api/radar/area-preferences", {
                method: "PATCH",
                body: JSON.stringify(formJson(form))
              }),
            { reset: false, success: "Area preferences saved" }
          )
        }
      >
        <SelectInput
          name="preferredZone"
          label="Default zone"
          defaultValue={dashboard.userAreaPreferences.preferredZone}
          options={dashboard.zoneOptions}
        />
        <TextInput name="customZoneName" label="Custom zone name" defaultValue={dashboard.userAreaPreferences.customZoneName ?? ""} />
        <label className="checkbox-label">
          <input name="hideDistantStores" type="hidden" value="false" />
          <input
            name="hideDistantStores"
            type="checkbox"
            value="true"
            defaultChecked={dashboard.userAreaPreferences.hideDistantStores}
          />
          Hide non-zone stores unless favorited
        </label>
        <button className="primary-action" disabled={busy} type="submit">
          <Save size={16} />
          {busyLabel === "Saving area preferences" ? "Saving" : "Save Area"}
        </button>
      </form>
    </section>
  );
}

function StoreCoveragePanel({ dashboard }: { dashboard: DashboardDTO }) {
  const storesWithDistance = dashboard.stores.filter((store) => store.distanceMiles !== null);
  const stats = [
    { label: "Saved stores", value: dashboard.stores.length, detail: "total coverage" },
    { label: "Within 5 miles", value: storesWithDistance.filter((store) => (store.distanceMiles ?? 999) <= 5).length, detail: "near route" },
    { label: "Within 10 miles", value: storesWithDistance.filter((store) => (store.distanceMiles ?? 999) <= 10).length, detail: "local loop" },
    { label: "Favorites", value: dashboard.stores.filter((store) => store.isFavorite).length, detail: "top priority" },
    { label: "Sightings logged", value: dashboard.sightings.length, detail: "manual reports" }
  ];

  return (
    <section className="form-panel store-coverage-panel">
      <div className="edit-card-heading">
        <div>
          <p className="eyeline">Deprecated store coverage</p>
          <h2>Nearby Store Network</h2>
          <span>Coverage uses saved browser location when available, with favorites sorted first.</span>
        </div>
      </div>
      <div className="coverage-grid">
        {stats.map((item) => (
          <div className="coverage-tile" key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

function StoreDiscoveryPanel({
  dashboard,
  isAdmin,
  busy,
  busyLabel,
  runAction
}: {
  dashboard: DashboardDTO;
  isAdmin: boolean;
  busy: boolean;
  busyLabel: string | null;
  runAction: ActionHandler;
}) {
  const [discoveryResult, setDiscoveryResult] = useState<StoreDiscoveryResponseDTO | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(
    dashboard.userAreaPreferences.currentLatitude !== null && dashboard.userAreaPreferences.currentLongitude !== null
      ? {
          latitude: dashboard.userAreaPreferences.currentLatitude,
          longitude: dashboard.userAreaPreferences.currentLongitude
        }
      : null
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const addableCandidates = discoveryResult?.candidates.filter((candidate) => !candidate.duplicate) ?? [];
  const selectedCandidates = addableCandidates.filter((candidate) => selectedIds.has(candidate.id));

  async function useBrowserLocationForDiscovery() {
    setLocating(true);
    setDiscoveryError(null);
    try {
      const position = await browserPosition();
      setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    } catch (error) {
      setDiscoveryError(error instanceof Error ? error.message : "Could not read browser location");
    } finally {
      setLocating(false);
    }
  }

  async function searchStores(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const retailers = data.getAll("retailers").map(String);
    setSearching(true);
    setDiscoveryError(null);
    try {
      const result = await requestJson<StoreDiscoveryResponseDTO>("/api/radar/stores/discovery", {
        method: "POST",
        body: JSON.stringify({
          locationQuery: String(data.get("locationQuery") || "").trim(),
          latitude: coords?.latitude,
          longitude: coords?.longitude,
          radiusMiles: data.get("radiusMiles"),
          retailers
        })
      });
      setDiscoveryResult(result);
      setSelectedIds(new Set(result.candidates.filter((candidate) => !candidate.duplicate).map((candidate) => candidate.id)));
    } catch (error) {
      setDiscoveryError(error instanceof Error ? error.message : "Store discovery failed");
    } finally {
      setSearching(false);
    }
  }

  function toggleCandidate(candidateId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  }

  return (
    <section className="form-panel store-discovery-panel">
      <div className="edit-card-heading">
        <div>
          <p className="eyeline">Deprecated store discovery</p>
          <h2>Store discovery hidden</h2>
          <span>Use public Google Places when configured, or stay in manual CSV/JSON import mode.</span>
        </div>
        <span className="chip muted">{coords ? "Location ready" : "ZIP/city or browser location"}</span>
      </div>
      <div className="template-hint warning">
        <strong>Store discovery setup</strong>
        <span>Nearby store discovery requires GOOGLE_PLACES_API_KEY. Without it, import or add stores manually.</span>
      </div>
      <form className="store-discovery-form" onSubmit={searchStores}>
        <TextInput
          name="locationQuery"
          label="ZIP code or city"
          placeholder="33126 or Miami, FL"
          defaultValue={dashboard.userAreaPreferences.currentLatitude !== null ? "" : zoneDisplay(dashboard.userAreaPreferences.preferredZone, dashboard)}
        />
        <SelectInput
          name="radiusMiles"
          label="Radius"
          defaultValue="10"
          options={[5, 10, 25, 50].map((value) => ({ value: String(value), label: `${value} miles` }))}
        />
        <div className="retailer-chip-grid" aria-label="Retailers">
          {["Target", "Walmart", "GameStop", "Best Buy"].map((retailer) => (
            <label className="checkbox-label" key={retailer}>
              <input name="retailers" type="checkbox" value={retailer} defaultChecked />
              {retailer}
            </label>
          ))}
        </div>
        <div className="form-actions">
          <button className="mini-action" disabled={searching || locating || busy} type="button" onClick={useBrowserLocationForDiscovery}>
            <MapPin size={14} />
            {locating ? "Locating" : "Browser Location Disabled"}
          </button>
          <button className="primary-action" disabled={searching || busy} type="submit">
            <Store size={16} />
            {searching ? "Searching" : "Find Stores"}
          </button>
        </div>
      </form>
      {discoveryError ? <p className="form-error">{discoveryError}</p> : null}
      {discoveryResult ? (
        <div className="discovery-results">
          <div className="edit-card-heading">
            <div>
              <strong>{discoveryResult.message}</strong>
              <span>
                Origin: {discoveryResult.origin.label} - Radius {discoveryResult.radiusMiles} miles
              </span>
            </div>
            <span className={`chip ${discoveryResult.configured ? "good" : "watch"}`}>
              {discoveryResult.configured ? "Google Places" : "Manual mode"}
            </span>
          </div>
          {!discoveryResult.configured ? (
            <div className="template-hint warning">
              <strong>Manual mode</strong>
              <span>Nearby store discovery requires GOOGLE_PLACES_API_KEY. Without it, import or add stores manually.</span>
            </div>
          ) : null}
          {discoveryResult.candidates.length ? (
            <div className="candidate-store-list">
              {discoveryResult.candidates.map((candidate) => (
                <label className={candidate.duplicate ? "candidate-store-row duplicate" : "candidate-store-row"} key={candidate.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(candidate.id)}
                    disabled={candidate.duplicate}
                    onChange={() => toggleCandidate(candidate.id)}
                  />
                  <div>
                    <strong>{candidate.storeName}</strong>
                    <span>
                      {candidate.retailerName} - {candidate.address}, {candidate.city}, {candidate.state}
                      {candidate.distanceMiles !== null ? ` - ${candidate.distanceMiles} mi` : ""}
                    </span>
                    <small>
                      {candidate.phone || "Phone unavailable"}
                      {candidate.placeId ? ` - place_id ${candidate.placeId}` : ""}
                    </small>
                  </div>
                  <span className={`chip ${candidate.duplicate ? "muted" : "good"}`}>
                    {candidate.duplicate ? "Already saved" : "Addable"}
                  </span>
                  {candidate.duplicateReason ? <small>{candidate.duplicateReason}</small> : null}
                </label>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Store}
              title={discoveryResult.configured ? "No candidates found" : "Manual store setup ready"}
              detail="Try a wider radius, different city/ZIP, manual entry, or bulk import."
            />
          )}
          {isAdmin ? (
            <button
              className="primary-action"
              aria-label="Add Store Disabled"
              disabled={busy || selectedCandidates.length === 0}
              type="button"
              onClick={() =>
                runAction(
                  "Adding discovered stores",
                  async () => {
                    const result = await requestJson<{ created: number; skipped: number; errors: string[] }>(
                      "/api/radar/stores/discovery/add",
                      {
                        method: "POST",
                        body: JSON.stringify({ candidates: selectedCandidates })
                      }
                    );
                    if (result.created === 0 && result.skipped > 0) {
                      throw new Error(result.errors.slice(0, 2).join(" ") || "All selected stores were duplicates.");
                    }
                  },
                  { success: `${selectedCandidates.length} selected store${selectedCandidates.length === 1 ? "" : "s"} processed` }
                )
              }
            >
              <Plus size={16} />
              {busyLabel === "Adding discovered stores" ? "Adding" : `Add ${selectedCandidates.length} To My Stores`}
            </button>
          ) : (
            <p className="push-copy">Ask an Admin to add discovered stores to the shared private store list.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function TodayPlanPanel({
  dashboard,
  setActiveTab,
  busy,
  busyLabel,
  runAction
}: {
  dashboard: DashboardDTO;
  setActiveTab: (tab: Tab) => void;
  busy: boolean;
  busyLabel: string | null;
  runAction: ActionHandler;
}) {
  function inventorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    runAction(
      "Logging inventory",
      async () => {
        await requestJson("/api/radar/inventory", { method: "POST", body: JSON.stringify(formJson(form)) });
        form.reset();
      },
      { success: "Inventory item logged" }
    );
  }

  function presetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    runAction(
      "Saving filter preset",
      async () => {
        await requestJson("/api/radar/filter-presets", { method: "POST", body: JSON.stringify(formJson(form)) });
        form.reset();
      },
      { success: "Filter preset saved" }
    );
  }

  return (
    <section className="today-plan-panel">
      <div className="panel-header">
        <div>
          <p className="eyeline">Morning workflow</p>
          <h2>Today&apos;s Plan</h2>
        </div>
        <button
          className="mini-action solid"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              "Generating daily recap",
              () => requestJson("/api/radar/daily-recaps", { method: "POST", body: JSON.stringify({}) }),
              { success: "Daily recap archived" }
            )
          }
        >
          <FileText size={14} />
          {busyLabel === "Generating daily recap" ? "Generating" : "Generate Recap"}
        </button>
      </div>
      <div className="quick-action-grid">
        <button className="mini-action solid" type="button" onClick={() => setActiveTab("inventory")}>
          <Plus size={14} />
          Open Inventory
        </button>
        <button className="mini-action solid" type="button" onClick={() => setActiveTab("orders")}>
          <ShoppingBag size={14} />
          Review Orders
        </button>
        <button className="mini-action" type="button" onClick={() => setActiveTab("alerts")}><Bell size={14} />Alerts</button>
        <button className="mini-action" type="button" onClick={() => setActiveTab("releases")}><CalendarDays size={14} />Releases</button>
      </div>
      <div className="daily-plan-grid">
        <PlanList title="Latest alerts" tab="alerts" setActiveTab={setActiveTab}>
          <div className="stack compact">
            {dashboard.dailyPlan.latestAlerts.length ? (
              dashboard.dailyPlan.latestAlerts.slice(0, 4).map((alert) => (
                <article className="data-card compact-card" key={alert.id}>
                  <div className="card-main">
                    <div className="avatar">
                      <Bell size={15} />
                    </div>
                    <div>
                      <h3>{alert.title}</h3>
                      <p>{alert.reason}</p>
                    </div>
                  </div>
                  <span className={`chip ${statusTone(alert.priority)}`}>{alert.priority}</span>
                </article>
              ))
            ) : (
              <EmptyState icon={Bell} title="No alerts yet" detail="Inventory, order, release, and storefront alerts will appear here." />
            )}
          </div>
        </PlanList>
        <PlanList title="Newest releases" tab="releases" setActiveTab={setActiveTab}>
          <ReleaseStack releases={dashboard.dailyPlan.newestReleases.slice(0, 3)} />
        </PlanList>
        <PlanList title="Recent inventory" tab="inventory" setActiveTab={setActiveTab}>
          <div className="stack compact">
            {dashboard.inventory.slice(0, 3).map((item) => (
              <article className="data-card compact-card" key={item.id}>
                <div className="card-main">
                  <ProductImagePreview imageUrl={item.imageUrl || ""} itemName={item.itemName} />
                  <div>
                    <h3>{item.itemName}</h3>
                    <p>{item.quantityOwned} owned - {money(item.totalCost)} cost basis</p>
                  </div>
                </div>
              </article>
            ))}
            {!dashboard.inventory.length ? <EmptyState icon={Trophy} title="No inventory yet" detail="Add products you own from Inventory." /> : null}
          </div>
        </PlanList>
      </div>
      <div className="split-grid">
        <section className="push-panel">
          <h3>Inventory Log</h3>
          <form className="form-grid" onSubmit={inventorySubmit}>
            <SelectInput
              name="itemType"
              label="Type"
              defaultValue="product"
              options={["product", "card", "sealed", "other"].map((value) => ({ value, label: formatStatus(value) }))}
            />
            <TextInput name="itemName" label="Product/card purchased" required />
            <TextInput name="cost" label="Cost" type="number" min="0" step="0.01" required />
            <TextInput name="quantity" label="Quantity" type="number" min="1" defaultValue="1" required />
            <TextInput name="source" label="Source" placeholder="Target, Pokemon Center, eBay" required />
            <TextInput name="purchasedAt" label="Purchase date" type="date" required />
            <TextareaInput name="expectedPlan" label="Expected resale/grading plan" wide />
            <button className="primary-action" disabled={busy} type="submit">
              <Save size={16} />
              {busyLabel === "Logging inventory" ? "Saving" : "Log Purchase"}
            </button>
          </form>
          {dashboard.inventory.length ? (
            <div className="inventory-list">
              {dashboard.inventory.slice(0, 5).map((item) => (
                <div className="access-row" key={item.id}>
                  <div>
                    <strong>{item.itemName}</strong>
                    <span>
                      {item.quantity} @ {money(item.cost)} from {item.source} - {shortDate(item.purchasedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={PackageSearch} title="No inventory logged" detail="Log purchases as you buy sealed products or raw cards." />
          )}
        </section>
        <section className="push-panel">
          <h3>Saved Filter Presets</h3>
          <form className="form-grid" onSubmit={presetSubmit}>
            <TextInput name="name" label="Preset name" placeholder="High-priority Target ETBs" required />
            <SelectInput name="section" label="Section" defaultValue="products" options={tabs.map((tab) => ({ value: tab.id, label: tab.label }))} />
            <TextareaInput name="filters" label="Filter JSON / notes" defaultValue='{"priority":"HIGH"}' wide required />
            <button className="mini-action solid" disabled={busy} type="submit">
              <Save size={14} />
              {busyLabel === "Saving filter preset" ? "Saving" : "Save Preset"}
            </button>
          </form>
          {dashboard.savedFilterPresets.length ? (
            dashboard.savedFilterPresets.slice(0, 6).map((preset) => (
              <div className="access-row" key={preset.id}>
                <div>
                  <strong>{preset.name}</strong>
                  <span>
                    {formatStatus(preset.section)} - {preset.filters}
                  </span>
                </div>
                <button
                  className="mini-action"
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    runAction(
                      "Deleting filter preset",
                      () => requestJson(`/api/radar/filter-presets/${preset.id}`, { method: "DELETE" }),
                      { confirm: `Delete preset ${preset.name}?`, success: "Preset deleted" }
                    )
                  }
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            ))
          ) : (
            <EmptyState icon={FileText} title="No saved presets" detail="Save filter notes you use every morning." />
          )}
          <h3>Daily Recap Archive</h3>
          {dashboard.dailyRecaps.length ? (
            dashboard.dailyRecaps.slice(0, 5).map((recap) => (
              <div className="access-row" key={recap.id}>
                <div>
                  <strong>{shortDate(recap.recapDate)}</strong>
                  <span>{recap.summary}</span>
                </div>
              </div>
            ))
          ) : (
            <EmptyState icon={History} title="No recaps yet" detail="Generate a recap after morning checks or store runs." />
          )}
        </section>
      </div>
    </section>
  );
}

function PlanList({
  title,
  tab,
  setActiveTab,
  children
}: {
  title: string;
  tab: Tab;
  setActiveTab: (tab: Tab) => void;
  children: ReactNode;
}) {
  return (
    <section className="plan-list">
      <PanelHeader title={title} action="Open" onAction={() => setActiveTab(tab)} />
      {children}
    </section>
  );
}

function StatCard({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article className="stat-card static">
      <strong>{value}</strong>
      <span>{detail}</span>
      <small>{label}</small>
    </article>
  );
}

function SetupChecklistPanel({
  dashboard,
  setActiveTab
}: {
  dashboard: DashboardDTO;
  setActiveTab: (tab: Tab) => void;
}) {
  return (
    <section className="split-grid">
      <PanelHeader title="First Setup Checklist" />
      <div className="setup-list">
        {dashboard.setupChecklist.map((item) => (
          <button className="setup-row" key={item.id} type="button" onClick={() => setActiveTab(item.tab)}>
            <span className={`chip ${item.complete ? "good" : "watch"}`}>{item.complete ? "Done" : "Todo"}</span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
    </section>
  );
}

function DataQualityPanel({
  dashboard,
  setActiveTab
}: {
  dashboard: DashboardDTO;
  setActiveTab: (tab: Tab) => void;
}) {
  return (
    <section className="split-grid">
      <PanelHeader title="Data Quality" />
      {dashboard.dataQualityWarnings.length ? (
        <div className="table-list">
          {dashboard.dataQualityWarnings.slice(0, 8).map((warning) => (
            <button
              className="quality-row"
              key={warning.id}
              type="button"
              onClick={() => setActiveTab(warning.tab)}
            >
              <AlertTriangle size={16} />
              <div>
                <strong>{warning.title}</strong>
                <span>{warning.detail}</span>
              </div>
              <span className={`chip ${statusTone(warning.severity)}`}>{warning.severity}</span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon={ShieldCheck} title="Core data looks clean" detail="No setup or product data quality warnings right now." />
      )}
    </section>
  );
}

function OwnerLaunchChecklistPanel({
  dashboard,
  setActiveTab
}: {
  dashboard: DashboardDTO;
  setActiveTab: (tab: Tab) => void;
}) {
  const completeCount = dashboard.ownerLaunchChecklist.filter((item) => item.complete).length;
  return (
    <section className="split-grid launch-checklist-panel">
      <PanelHeader title="Owner Launch Checklist" />
      <div className="launch-summary">
        <div>
          <strong>
            {completeCount}/{dashboard.ownerLaunchChecklist.length}
          </strong>
          <span>launch items ready</span>
        </div>
        <span className={`chip ${completeCount === dashboard.ownerLaunchChecklist.length ? "good" : "watch"}`}>
          {completeCount === dashboard.ownerLaunchChecklist.length ? "Launch Ready" : "Needs Setup"}
        </span>
      </div>
      <div className="setup-list">
        {dashboard.ownerLaunchChecklist.map((item) => (
          <button className="setup-row" key={item.id} type="button" onClick={() => setActiveTab(item.tab)}>
            <span className={`chip ${item.complete ? "good" : statusTone(item.severity)}`}>
              {item.complete ? "Done" : item.severity}
            </span>
            <div>
              <strong>{item.label}</strong>
              <small>{item.detail}</small>
            </div>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
    </section>
  );
}

function AlertCalibrationPanel({
  dashboard,
  setActiveTab
}: {
  dashboard: DashboardDTO;
  setActiveTab: (tab: Tab) => void;
}) {
  return (
    <section className="split-grid calibration-panel">
      <PanelHeader title="Alert Calibration Queue" />
      {dashboard.alertCalibrationItems.length ? (
        <div className="table-list">
          {dashboard.alertCalibrationItems.slice(0, 8).map((item) => (
            <button className="quality-row calibration-row" key={item.id} type="button" onClick={() => setActiveTab(item.tab)}>
              <Radar size={16} />
              <div>
                <strong>{item.title}</strong>
                <span>
                  {item.category}
                  {item.retailerName ? ` - ${item.retailerName}` : ""}. {item.detail} {item.recommendation}
                </span>
              </div>
              <span className={`chip ${statusTone(item.severity)}`}>{item.severity}</span>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title="No calibration issues"
          detail="No stale checks, blocked pages, low-confidence results, or repeated false positives need attention."
        />
      )}
    </section>
  );
}

function PanelHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="panel-header">
      <h2>{title}</h2>
      {action && onAction ? (
        <button className="text-button" onClick={onAction} type="button">
          {action}
          <ChevronRight size={15} />
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  detail
}: {
  icon: typeof Radar;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <Icon size={20} />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </div>
  );
}

function SectionIntro({
  title,
  detail,
  stats
}: {
  title: string;
  detail: string;
  stats?: Array<{ label: string; value: string | number; tone?: string }>;
}) {
  return (
    <section className="section-intro">
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
      {stats?.length ? (
        <div className="section-intro-stats">
          {stats.map((stat) => (
            <span className={`chip ${stat.tone || "muted"}`} key={stat.label}>
              {stat.value} {stat.label}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function UtilityFold({
  title,
  detail,
  defaultOpen = false,
  children
}: {
  title: string;
  detail: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="utility-fold" open={defaultOpen}>
      <summary>
        <div>
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
        <ChevronRight size={16} />
      </summary>
      <div className="utility-fold-body">{children}</div>
    </details>
  );
}

function ProductStack({
  products,
  compact = false,
  showDiagnostics = false
}: {
  products: ProductDTO[];
  compact?: boolean;
  showDiagnostics?: boolean;
}) {
  if (!products.length) {
    return (
      <EmptyState
        icon={PackageSearch}
        title="No tracked products"
        detail="Add official retailer product URLs to start the watchlist."
      />
    );
  }

  return (
    <div className={compact ? "stack compact" : "stack"}>
      {products.map((product) => {
        const actionable = productActionable(product);
        const goUrl = exactProductUrl(product);
        const score = product.priorityScore?.score ?? 0;
        return (
          <article
            className={compact ? "data-card product-card compact-product-card" : "data-card product-card"}
            id={`product-${product.id}`}
            key={product.id}
          >
            <ProductImage product={product} />
            <div className="product-card-center">
              <div className="product-title-line">
                <h3>{product.name}</h3>
                {product.isDemoData ? <span className="chip muted">Demo data</span> : null}
              </div>
              <p>
                {product.retailerName}
                {product.releaseName || product.setName ? ` - ${product.releaseName || product.setName}` : ""}
              </p>
              <div className="product-main-facts">
                <span>{productPriceLabel(product)}</span>
                <span className={productStockTone(product)}>{productStockLabel(product)}</span>
                <span className={productLiveVerified(product) ? "good" : product.liveBlockedType ? "bad" : "watch"}>
                  {productLiveBadge(product)}
                </span>
              </div>
              {!compact ? (
                <details className="product-details-drawer">
                  <summary>{showDiagnostics ? "Admin Details" : "View Details"}</summary>
                  <VerificationProgress stages={productVerificationStages(product)} />
                  <div className="product-detail-grid">
                    <span>Verified title: {product.liveTitle || "Not verified"}</span>
                    <span>Retailer product ID: {product.retailerProductId || "Missing"}</span>
                    <span>UPC: {product.upc || "Not entered"}</span>
                    <span>SKU/ASIN/TCIN: {product.sku || "Not entered"}</span>
                    <span>DPCI: {product.dpci || "Not entered"}</span>
                    <span>Last verified: {product.lastSuccessfulCheckedAt ? relativeTime(product.lastSuccessfulCheckedAt) : "Not collected yet"}</span>
                  </div>
                  {product.priorityScore ? <p className="reason-text">{product.priorityScore.reason}</p> : null}
                  {showDiagnostics ? (
                    <details className="monitor-details product-monitor-details">
                      <summary>Monitor Details</summary>
                      <div>
                        <span>Verification: {productVerificationLabel(product.verificationStatus)}</span>
                        <span>Final URL: {product.verifiedFinalUrl || "Not verified"}</span>
                        <span>Live retailer price: {product.livePrice !== null ? money(product.livePrice) : "Price not verified"}</span>
                        <span>Stored/manual price: {product.retailPrice !== null ? money(product.retailPrice) : "Unknown"}</span>
                        <span>Live stock: {product.liveStockStatus ? formatStatus(product.liveStockStatus) : "Not verified"}</span>
                        <span>Live confidence: {product.liveConfidenceScore === null ? "Unknown" : `${product.liveConfidenceScore}%`}</span>
                        <span>Image: {product.liveImageUrl ? "Verified retailer image" : "Retailer logo fallback"}</span>
                        <span>Next check: {relativeTime(product.nextCheckAt)}</span>
                        <span>Last result: {product.lastMonitorResult || "No monitor result yet"}</span>
                        {product.lastMonitorError ? <span>Last error: {product.lastMonitorError}</span> : null}
                        {product.requiredWords ? <span>Required words: {product.requiredWords}</span> : null}
                        {product.ignoreWords ? <span>Ignore words: {product.ignoreWords}</span> : null}
                        {product.verificationNotes ? <span>{product.verificationNotes}</span> : null}
                      </div>
                    </details>
                  ) : null}
                </details>
              ) : null}
            </div>
            <div className="product-card-side">
              <strong>{score}</strong>
              <span>Score</span>
              <div className="product-side-badges">
                <span className={`chip ${verificationTone(product.verificationStatus)}`}>
                  {productVerificationLabel(product.verificationStatus)}
                </span>
                {!product.monitorEnabled ? <span className="chip muted">Paused</span> : null}
              </div>
              {goUrl ? (
                <a className={actionable ? "primary-action product-buy-action" : "mini-action product-buy-action"} href={goUrl} target="_blank" rel="noreferrer">
                  {actionable ? "Buy Now" : "View Product"} <ExternalLink size={14} />
                </a>
              ) : (
                <span className="mini-action disabled product-buy-action">Verify first</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function VerificationProgress({ stages }: { stages: Array<{ label: string; complete: boolean }> }) {
  return (
    <div className="verification-progress" aria-label="Exact product verification progress">
      {stages.map((stage) => (
        <span className={stage.complete ? "complete" : ""} key={stage.label}>
          <Check size={11} />
          {stage.label}
        </span>
      ))}
    </div>
  );
}

function ProductImage({ product }: { product: ProductDTO }) {
  const [imageFailure, setImageFailure] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  const verifiedImageUrl = product.liveImageUrl;

  const imageFailed = imageFailure.failed && imageFailure.url === verifiedImageUrl;
  const showVerifiedImage = Boolean(verifiedImageUrl) && !imageFailed;
  const retailerInitials = product.retailerName
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();

  return (
    <div className={showVerifiedImage ? "product-image-frame has-image" : "product-image-frame retailer-fallback-frame"}>
      {showVerifiedImage && verifiedImageUrl ? (
        <Image
          alt={`${product.name} product image`}
          fill
          loading="lazy"
          sizes="(max-width: 560px) 100vw, 210px"
          unoptimized
          referrerPolicy="no-referrer"
          data-verified-product-image="true"
          src={verifiedImageUrl}
          onError={(event) => {
            event.currentTarget.hidden = true;
            setImageFailure({ url: verifiedImageUrl, failed: true });
          }}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth < 32 || image.naturalHeight < 32) {
              image.hidden = true;
              setImageFailure({ url: verifiedImageUrl, failed: true });
            }
          }}
        />
      ) : null}
      <div className="product-image-empty retailer-logo-fallback" hidden={showVerifiedImage} aria-label="Image unavailable">
        <span>{retailerInitials || "TCG"}</span>
      </div>
    </div>
  );
}

function isRenderableImageUrl(url?: string | null) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:", "data:", "blob:"].includes(parsed.protocol)) return false;
    if (parsed.protocol === "data:" || parsed.protocol === "blob:") return true;

    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const productPagePatterns = [
      { host: "bestbuy.com", path: /^\/(product|site)\// },
      { host: "target.com", path: /^\/p\// },
      { host: "walmart.com", path: /^\/ip\// },
      { host: "amazon.com", path: /^\/(dp|gp\/product)\// },
      { host: "pokemoncenter.com", path: /^\/product\// },
      { host: "gamestop.com", path: /^\/.+\/products?\// }
    ];
    if (productPagePatterns.some((pattern) => host.endsWith(pattern.host) && pattern.path.test(pathname))) return false;
    return true;
  } catch {
    return false;
  }
}

function InventoryImage({ item }: { item: InventoryItemDTO }) {
  const [imageFailure, setImageFailure] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  const initials = item.retailer?.slice(0, 2).toUpperCase() || item.category.slice(0, 2).toUpperCase();
  const imageUrl =
    isRenderableImageUrl(item.imageUrl) && !(imageFailure.failed && imageFailure.url === item.imageUrl) ? item.imageUrl : null;
  return (
    <div className={imageUrl ? "inventory-image-frame has-image" : "inventory-image-frame"}>
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={`${item.itemName} inventory image`}
          width={76}
          height={76}
          loading="lazy"
          unoptimized
          onError={() => setImageFailure({ url: imageUrl, failed: true })}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth < 16 || image.naturalHeight < 16) setImageFailure({ url: imageUrl, failed: true });
          }}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

function ProductImagePreview({ imageUrl, itemName }: { imageUrl: string; itemName: string }) {
  if (!imageUrl) {
    return (
      <div className="product-image-preview empty">
        <PackageSearch size={18} />
        <span>No product image yet. Scan or lookup a UPC, paste an image URL, or upload a photo.</span>
      </div>
    );
  }
  return (
    <div className="product-image-preview">
      <Image src={imageUrl} alt={`${itemName} preview`} width={96} height={96} unoptimized />
    </div>
  );
}

function ImageUploadInput({
  defaultValue = "",
  value,
  onValueChange,
  fieldName = "imageUrl",
  label = "Product image",
  placeholder = "Paste verified product image URL"
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  fieldName?: string;
  label?: string;
  placeholder?: string;
}) {
  const [localValue, setLocalValue] = useState(defaultValue);
  const currentValue = value ?? localValue;
  const setCurrentValue = useCallback(
    (nextValue: string) => {
      if (value === undefined) setLocalValue(nextValue);
      onValueChange?.(nextValue);
    },
    [onValueChange, value]
  );
  const isUploadedImage = currentValue.startsWith("data:");
  return (
    <label className="image-upload-field">
      {label}
      <input name={fieldName} type="hidden" value={currentValue} />
      <input
        type="url"
        value={isUploadedImage ? "" : currentValue}
        onChange={(event) => setCurrentValue(event.currentTarget.value)}
        placeholder={placeholder}
      />
      <input
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => setCurrentValue(String(reader.result || ""));
          reader.readAsDataURL(file);
        }}
      />
      <span className="image-upload-actions">
        {currentValue ? <span className="chip good">Image attached</span> : <span className="chip muted">Optional URL or upload</span>}
        {currentValue ? (
          <button className="mini-action" type="button" onClick={() => setCurrentValue("")}>
            Remove image
          </button>
        ) : null}
      </span>
    </label>
  );
}

function StoreStack({
  stores,
  compact = false,
  busy = false,
  busyLabel = null,
  runAction,
  showPreferenceActions = false
}: {
  stores: StoreDTO[];
  compact?: boolean;
  busy?: boolean;
  busyLabel?: string | null;
  runAction?: ActionHandler;
  showPreferenceActions?: boolean;
}) {
  if (!stores.length) {
    return (
      <EmptyState
        icon={Store}
        title="No local stores"
        detail="Admin can add stores, then friends can log sightings."
      />
    );
  }

  return (
    <div className={compact ? "store-row-list compact" : "store-row-list"}>
      {stores.map((store) => {
        const favoriteLabel = `${store.isFavorite ? "Removing favorite" : "Adding favorite"} ${store.id}`;
        const favoriteButton =
          showPreferenceActions && runAction ? (
            <button
              className={store.isFavorite ? "store-favorite-button active" : "store-favorite-button"}
              disabled={busy}
              type="button"
              aria-label={store.isFavorite ? `Remove ${store.storeName} from favorites` : `Favorite ${store.storeName}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void runAction(
                  favoriteLabel,
                  () =>
                    requestJson("/api/radar/area-preferences", {
                      method: "POST",
                      body: JSON.stringify({ storeId: store.id, favorite: !store.isFavorite })
                    }),
                  { success: store.isFavorite ? "Favorite removed" : "Store favorited" }
                );
              }}
            >
              <Star size={14} />
            </button>
          ) : (
            <span className={store.isFavorite ? "store-favorite-static active" : "store-favorite-static"}>
              <Star size={14} />
            </span>
          );

        return (
          <details className="store-row" id={`store-${store.id}`} key={store.id}>
            <summary className="store-row-summary">
              <span className={`store-color-bar ${statusTone(store.prediction.probability)}`} aria-hidden="true" />
              <span className="store-row-main">
                <strong>{store.storeName}</strong>
                <span>
                  {store.city} - {storeDistanceLabel(store)} - {store.retailerName}
                </span>
              </span>
              <span className="store-row-score">
                <strong>{store.prediction.confidenceScore}%</strong>
                <small>{store.prediction.nextLikelyRestockWindow}</small>
              </span>
              {favoriteButton}
            </summary>
          <div className="store-row-detail">
            <p className="reason-text">{store.prediction.reason}</p>
            {storeNeedsCoordinates(store) ? (
              <p className="form-error">Store needs address/coordinates before distance sorting.</p>
            ) : null}
            <div className="monitor-meta">
              <span>
                <Clock size={13} />
                Last restock{" "}
                {store.prediction.daysSinceLastConfirmedRestock === null
                  ? "unknown"
                  : `${store.prediction.daysSinceLastConfirmedRestock}d ago`}
              </span>
              <span>Avg interval {store.prediction.averageRestockIntervalDays ?? "TBD"}d</span>
              <span>Overdue {store.prediction.overdueScore}</span>
              <span>{storeDistanceLabel(store)}</span>
              <span>{store.city}, {store.state}</span>
              <span>{store.prediction.mostCommonRestockDays.join(", ") || store.typicalRestockDays}</span>
              <span>{store.prediction.mostCommonRestockTimeWindows.join(", ") || store.typicalRestockTimeWindow}</span>
              {store.isFavorite ? <span>Favorite</span> : null}
            </div>
            {busyLabel === favoriteLabel ? <span className="chip muted">Saving favorite</span> : null}
          </div>
        </details>
        );
      })}
    </div>
  );
}

function ReleaseStack({ releases }: { releases: ReleaseDTO[] }) {
  if (!releases.length) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No releases tracked"
        detail="Add upcoming sets and products when dates are verified."
      />
    );
  }

  return (
    <div className="stack">
      {releases.map((release) => {
        const actionUrl = firstUrl(release.productLinks);
        return (
          <article className="data-card" id={`release-${release.id}`} key={release.id}>
            <div className="card-main">
              <div className="avatar">
                <CalendarDays size={16} />
              </div>
              <div>
                <h3>{release.setName}</h3>
                <p>
                  {shortDate(release.officialReleaseDate)} - {Math.max(0, release.daysUntilRelease)} days to release
                </p>
              </div>
            </div>
            <div className="card-actions">
              <span className={`chip ${statusTone(release.sealedProductPriority)}`}>
                {release.sealedProductPriority}
              </span>
              <span className="chip muted">{release.productType || release.productTypes.split(",")[0]}</span>
              {actionUrl ? (
                <a className="mini-action" href={actionUrl} target="_blank" rel="noreferrer">
                  Go <ExternalLink size={14} />
                </a>
              ) : null}
            </div>
            <div className="monitor-meta">
              <span>Preorder {release.daysUntilPreorder === null ? "TBD" : `${Math.max(0, release.daysUntilPreorder)}d`}</span>
              <span>{release.profitablePsa9Count} PSA 9 targets</span>
              <span>PSA 10 upside {money(release.psa10Upside)}</span>
              {release.pokemonCenterExclusiveVersion ? <span>Pokemon Center exclusive</span> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CompReviewButtons({
  comp,
  busy,
  runAction
}: {
  comp: CardCompSaleDTO;
  busy: boolean;
  runAction: ActionHandler;
}) {
  return (
    <>
      {comp.reviewStatus === "REJECTED" ? (
        <button
          className="mini-action"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              `Accepting comp ${comp.id}`,
              () =>
                requestJson(`/api/radar/cards/comps/${comp.id}/review`, {
                  method: "POST",
                  body: JSON.stringify({ action: "accept" })
                }),
              { success: "Comp accepted" }
            )
          }
        >
          <Check size={14} />
          Accept this comp
        </button>
      ) : (
        <button
          className="mini-action danger"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              `Rejecting comp ${comp.id}`,
              () =>
                requestJson(`/api/radar/cards/comps/${comp.id}/review`, {
                  method: "POST",
                  body: JSON.stringify({ action: "reject" })
                }),
              {
                confirm: "Reject this comp and remove it from card averages?",
                success: "Comp rejected"
              }
            )
          }
        >
          <X size={14} />
          Reject this comp
        </button>
      )}
    </>
  );
}

function CardStack({
  cards,
  compact = false,
  busy = false,
  busyLabel = null,
  runAction,
  allowRefresh = false
}: {
  cards: CardDTO[];
  compact?: boolean;
  busy?: boolean;
  busyLabel?: string | null;
  runAction?: ActionHandler;
  allowRefresh?: boolean;
}) {
  if (!cards.length) {
    return (
      <EmptyState
        icon={CircleDollarSign}
        title="No card comps"
        detail="Enter raw and graded sales manually to build the watchlist."
      />
    );
  }

  return (
    <div className={compact ? "card-opportunity-list compact" : "card-opportunity-list"}>
      {cards.map((card) => {
        const hasRealComps = card.compCount > 0;
        const confidenceLabel = cardCompConfidenceLabel(card);
        return (
        <article className="card-opportunity-row" id={`card-${card.id}`} key={card.id}>
          <div className="card-opportunity-main">
            <div className="avatar">
              <Sparkles size={16} />
            </div>
            <div>
              <h3>{card.cardName}</h3>
              <p>
                {hasRealComps
                  ? `Raw avg last 3 ${money(card.rawAveragePrice)} - PSA 9 avg last 3 ${money(
                      card.psa9AverageSalePrice
                    )} - PSA 10 avg last 3 ${money(card.psa10AverageSalePrice)}`
                  : "Real sold comps not collected yet"}
              </p>
              <small>
                {dataSourceLabel(card.dataSource)} - {cardFreshnessLabel(card)} - {card.compCount} comps used
              </small>
            </div>
          </div>
          <div className="card-opportunity-actions">
            <span className={`chip ${statusTone(card.rating)}`}>{card.rating}</span>
            {hasRealComps ? (
              <>
                <span className="chip muted">PSA 9 profit {money(card.psa9EstimatedProfit)}</span>
                <span className="chip muted">PSA 10 profit {money(card.psa10EstimatedProfit)}</span>
              </>
            ) : (
              <span className="chip muted">Profit not verified</span>
            )}
            <span className={`chip ${cardCompConfidenceTone(card)}`}>Comp confidence {confidenceLabel}</span>
            <span className={`chip ${cardConfidenceTone(card)}`}>Score {card.compConfidenceScore}%</span>
            <span className="chip muted">Buy limit {money(card.maxRawBuyPrice)}</span>
            {allowRefresh && runAction ? (
              <button
                className="mini-action"
                disabled={busy}
                type="button"
                onClick={() =>
                  runAction(
                    `Refreshing comps ${card.id}`,
                    () => requestJson(`/api/radar/cards/${card.id}/refresh-comps`, { method: "POST" }),
                    { success: "Comp refresh finished" }
                  )
                }
              >
                <RefreshCw size={14} />
                {busyLabel === `Refreshing comps ${card.id}` ? "Refreshing" : "Refresh eBay Comps"}
              </button>
            ) : null}
          </div>
          {!compact ? (
            <>
              <div className="monitor-meta">
                <span>{card.setName} #{card.cardNumber}</span>
                <span>Raw comps {card.rawCompCount}</span>
                <span>PSA 9 comps {card.psa9CompCount}</span>
                <span>PSA 10 comps {card.psa10CompCount}</span>
                <span>Source {dataSourceLabel(card.dataSource)}</span>
                <span>{cardFreshnessLabel(card)}</span>
                <span>BGS 10 profit {money(card.bgs10EstimatedProfit)}</span>
                <span>Black Label profit {money(card.blackLabelEstimatedProfit)}</span>
              </div>
              <div className="last-comp-list grade-comp-list">
                <strong>Exact 3 sold comps used</strong>
                {card.lastThreeComps.length ? (
                  gradeTypes.map((gradeType) => {
                    const comps = compsForGrade(card, gradeType);
                    return (
                      <div className="grade-comp-group" key={gradeType}>
                        <div className="grade-comp-heading">
                          <span className="chip muted">{formatGradeType(gradeType)}</span>
                          <span>{comps.length ? `${comps.length}/3 used` : "No accepted comps"}</span>
                        </div>
                        {comps.map((comp) => (
                          <div className="comp-review-row" key={comp.id}>
                            <div>
                              <strong>{money(comp.salePrice)}</strong>
                              <span>
                                {shortDate(comp.soldAt)} - match {comp.matchScore}% - {comp.saleTitle || "Untitled sold comp"}
                              </span>
                              {comp.conditionNotes ? <small>{comp.conditionNotes}</small> : null}
                            </div>
                            <div className="row-actions">
                              <span className={`chip ${comp.reviewStatus === "REJECTED" ? "bad" : "good"}`}>
                                {comp.reviewStatus === "REJECTED" ? "Rejected" : "Accepted"}
                              </span>
                              {comp.sourceUrl ? (
                                <a className="mini-action" href={comp.sourceUrl} target="_blank" rel="noreferrer">
                                  Source <ExternalLink size={14} />
                                </a>
                              ) : null}
                              {allowRefresh && runAction ? (
                                <CompReviewButtons comp={comp} busy={busy} runAction={runAction} />
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })
                ) : (
                  <span>No completed sales collected yet. Use Refresh eBay Comps or add manual sold comps.</span>
                )}
                {card.rawCompCount < 3 ? <span>Only {card.rawCompCount} raw comps found - low confidence.</span> : null}
                {card.psa9CompCount < 3 ? <span>Only {card.psa9CompCount} PSA 9 comps found - low confidence.</span> : null}
                {card.psa10CompCount < 3 ? <span>Only {card.psa10CompCount} PSA 10 comps found - low confidence.</span> : null}
              </div>
            </>
          ) : null}
        </article>
        );
      })}
    </div>
  );
}

type StoreFilterState = {
  highOnly: boolean;
  todayOnly: boolean;
  nearMe: boolean;
  favoritesOnly: boolean;
  retailer: string;
};

function storeMatchesFilters(store: StoreDTO, filters: StoreFilterState, preferredZone: Zone) {
  if (filters.highOnly && store.prediction.probability !== "HIGH") return false;
  if (filters.todayOnly && !store.prediction.isLikelyToday) return false;
  if (filters.nearMe && !store.isFavorite) {
    if (store.distanceMiles !== null) {
      if (store.distanceMiles > 50) return false;
    } else if (store.zone !== preferredZone) {
      return false;
    }
  }
  if (filters.favoritesOnly && !store.isFavorite) return false;
  if (filters.retailer !== "ALL" && store.retailerName !== filters.retailer) return false;
  return true;
}

function productsForStore(store: StoreDTO, dashboard: DashboardDTO) {
  const retailerProducts = dashboard.todaysChaseList.filter(
    (product) => product.retailerName === store.retailerName && product.priorityScore?.buyWatchSkip !== "SKIP"
  );
  const fallbackProducts = dashboard.todaysChaseList.filter((product) => product.priorityScore?.buyWatchSkip !== "SKIP");
  return (retailerProducts.length ? retailerProducts : fallbackProducts).slice(0, 3);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function FieldModePanel({
  dashboard,
  busy,
  busyLabel,
  runAction
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  runAction: ActionHandler;
}) {
  const [filters, setFilters] = useState<StoreFilterState>({
    highOnly: false,
    todayOnly: false,
    nearMe: true,
    favoritesOnly: false,
    retailer: "ALL"
  });
  const preferredZone = dashboard.userAreaPreferences.preferredZone;
  const targetProducts = dashboard.todaysChaseList.filter((product) => product.priorityScore?.buyWatchSkip !== "SKIP").slice(0, 4);
  const filteredStores = useMemo(
    () =>
      (dashboard.checkTodayStores.length ? dashboard.checkTodayStores : dashboard.stores)
        .filter((store) => storeMatchesFilters(store, filters, preferredZone))
        .sort(
          (a, b) =>
            Number(b.isFavorite) - Number(a.isFavorite) ||
            a.distanceRank - b.distanceRank ||
            Number(b.prediction.isLikelyToday) - Number(a.prediction.isLikelyToday) ||
            b.prediction.confidenceScore - a.prediction.confidenceScore ||
            b.prediction.overdueScore - a.prediction.overdueScore ||
            a.storeName.localeCompare(b.storeName)
        ),
    [dashboard.checkTodayStores, dashboard.stores, filters, preferredZone]
  );

  function updateFilter(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, type, value } = event.currentTarget;
    setFilters((current) => ({
      ...current,
      [name]: type === "checkbox" ? (event.currentTarget as HTMLInputElement).checked : value
    }));
  }

  return (
    <>
      <section className="field-mode-panel">
        <div className="field-mode-heading">
          <div>
            <p className="eyeline">Field Mode</p>
            <h2>Check Today</h2>
            <p>Closest and favorite stores first, with big one-tap field logs.</p>
          </div>
          <div className="field-heading-actions">
            <span className="chip muted">
              {dashboard.userAreaPreferences.currentLatitude !== null ? "Nearby" : zoneDisplay(preferredZone, dashboard)} -{" "}
              {filteredStores.length} stops
            </span>
            <button
              className="mini-action solid"
              disabled={busy}
              type="button"
              onClick={() => saveBrowserLocation(dashboard, runAction)}
            >
              <MapPin size={14} />
              {busyLabel === "Saving browser location" ? "Saving" : "Location Disabled"}
            </button>
          </div>
        </div>
        <div className="field-targets">
          <strong>Look for</strong>
          <div className="target-strip">
            {targetProducts.length ? (
              targetProducts.map((product) => (
                <span className="chip muted" key={product.id}>
                  {product.name}
                </span>
              ))
            ) : (
              <span className="chip muted">ETBs, booster bundles, sleeved boosters, and collection boxes</span>
            )}
          </div>
        </div>
        <div className="field-filter-grid">
          <label className="checkbox-label">
            <input name="highOnly" type="checkbox" checked={filters.highOnly} onChange={updateFilter} />
            High probability only
          </label>
          <label className="checkbox-label">
            <input name="todayOnly" type="checkbox" checked={filters.todayOnly} onChange={updateFilter} />
            Today only
          </label>
          <label className="checkbox-label">
            <input name="nearMe" type="checkbox" checked={filters.nearMe} onChange={updateFilter} />
            Nearby Hidden
          </label>
          <label className="checkbox-label">
            <input name="favoritesOnly" type="checkbox" checked={filters.favoritesOnly} onChange={updateFilter} />
            Favorites
          </label>
          <SelectInput
            name="retailer"
            label="Retailer"
            value={filters.retailer}
            onChange={updateFilter}
            options={fieldRetailerFilters.map((value) => ({ value, label: value === "ALL" ? "All retailers" : value }))}
          />
        </div>
      </section>
      <div className="field-store-list">
        {filteredStores.length ? (
          filteredStores.map((store) => (
            <FieldStoreCard
              key={store.id}
              store={store}
              products={productsForStore(store, dashboard)}
              busy={busy}
              busyLabel={busyLabel}
              runAction={runAction}
            />
          ))
        ) : (
          <EmptyState icon={Navigation} title="No stores match these filters" detail="Relax filters or add more store history." />
        )}
      </div>
    </>
  );
}

function FieldStoreCard({
  store,
  products,
  busy,
  busyLabel,
  runAction
}: {
  store: StoreDTO;
  products: ProductDTO[];
  busy: boolean;
  busyLabel: string | null;
  runAction: ActionHandler;
}) {
  const targetNames = products.map((product) => product.name);
  const fallbackProduct = targetNames[0] || "Pokemon TCG shelf";
  const quickActions: Array<{
    resultType: StoreVisitResult;
    label: string;
    quantityEstimate: string;
    productSeen: string;
    icon: typeof Check;
  }> = [
    { resultType: "no_visit", label: "Arrived", quantityEstimate: "Arrived", productSeen: "Store arrival", icon: MapPin },
    { resultType: "stock_seen", label: "Found Product", quantityEstimate: "1+", productSeen: fallbackProduct, icon: Sparkles },
    { resultType: "stock_seen", label: "Seen Stock", quantityEstimate: "1+", productSeen: fallbackProduct, icon: Check },
    { resultType: "empty_shelf", label: "Empty Shelf", quantityEstimate: "0", productSeen: "Pokemon TCG shelf", icon: X },
    { resultType: "vendor_spotted", label: "Vendor Spotted", quantityEstimate: "Vendor present", productSeen: "Vendor", icon: Activity },
    { resultType: "bought_product", label: "Bought Product", quantityEstimate: "Bought one", productSeen: fallbackProduct, icon: Trophy },
    { resultType: "no_visit", label: "No Visit", quantityEstimate: "No visit", productSeen: "Store visit", icon: Clock }
  ];

  function logQuickAction(action: (typeof quickActions)[number]) {
    return runAction(
      `${action.label} ${store.id}`,
      () =>
        requestJson("/api/radar/sightings", {
          method: "POST",
          body: JSON.stringify({
            storeId: store.id,
            productSeen: action.productSeen,
            resultType: action.resultType,
            seenAt: new Date().toISOString(),
            quantityEstimate: action.quantityEstimate,
            notes: `Field Mode quick log: ${action.label}.`
          })
        }),
      { success: `${action.label} logged` }
    );
  }

  function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formJson(form);
    void runAction(
      `Adding field note ${store.id}`,
      () =>
        requestJson("/api/radar/sightings", {
          method: "POST",
          body: JSON.stringify({
            ...data,
            storeId: store.id,
            resultType: "no_visit",
            seenAt: new Date().toISOString(),
            quantityEstimate: "Field note"
          })
        }),
      { success: "Field note saved" }
    ).then(() => form.reset());
  }

  return (
    <article className="field-card" id={`store-${store.id}`}>
      <div className="field-card-top">
        <div>
          <p className="eyeline">{store.retailerName}</p>
          <h3>{store.storeName}</h3>
          <span>
            {store.address} - {store.city}, {store.state} - {storeDistanceLabel(store)}
          </span>
        </div>
        <div className="field-score">
          <strong>{store.prediction.confidenceScore}%</strong>
          <span className={`chip ${statusTone(store.prediction.probability)}`}>{store.prediction.probability}</span>
        </div>
      </div>
      <div className="field-metrics">
        <span>
          <Clock size={13} />
          {store.prediction.nextLikelyRestockWindow}
        </span>
        <span>Last {store.prediction.daysSinceLastConfirmedRestock ?? "?"}d</span>
        <span>Avg {store.prediction.averageRestockIntervalDays ?? "TBD"}d</span>
        <span>Overdue {store.prediction.overdueScore}</span>
        <span>{storeDistanceLabel(store)}</span>
      </div>
      <p className="reason-text">{store.prediction.reason}</p>
      <div className="target-strip">
        {targetNames.length ? (
          targetNames.map((name) => (
            <span className="chip muted" key={name}>
              {name}
            </span>
          ))
        ) : (
          <span className="chip muted">Look for ETBs, booster bundles, sleeved boosters, and collection boxes</span>
        )}
      </div>
      <div className="quick-action-grid">
        {quickActions.map((action) => {
          const Icon = action.icon;
          const label = `${action.label} ${store.id}`;
          return (
            <button
              className={`quick-action ${statusTone(action.resultType)}`}
              disabled={busy}
              key={action.label}
              onClick={() => logQuickAction(action)}
              type="button"
            >
              <Icon size={15} />
              {busyLabel === label ? "Saving" : action.label}
            </button>
          );
        })}
      </div>
      <form className="field-note-form" onSubmit={saveNote}>
        <TextInput name="productSeen" label="Product / note target" defaultValue={fallbackProduct} required />
        <TextInput name="notes" label="Add note" placeholder="Aisle note, limit sign, shelf location" required />
        <button className="mini-action solid" disabled={busy} type="submit">
          <Plus size={14} />
          {busyLabel === `Adding field note ${store.id}` ? "Saving" : "Add Note"}
        </button>
      </form>
    </article>
  );
}

function InventoryPanel({
  dashboard,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const [view, setView] = useState<"items" | "purchases" | "sales">("items");
  const [addProductChoiceOpen, setAddProductChoiceOpen] = useState(false);
  const [purchaseFlowOpen, setPurchaseFlowOpen] = useState(false);
  const [purchaseDefaultItemId, setPurchaseDefaultItemId] = useState<string>("");
  const [purchasePrefill, setPurchasePrefill] = useState<InventoryPurchasePrefill | null>(null);
  const [barcodeScannerOpen, setBarcodeScannerOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [saleItemId, setSaleItemId] = useState<string>("");
  const [detailItemId, setDetailItemId] = useState<string>("");
  const [editItemId, setEditItemId] = useState<string>("");
  const [storeListingItemId, setStoreListingItemId] = useState<string>("");
  const [editStockLotTarget, setEditStockLotTarget] = useState<{ itemId: string; lotId: string } | null>(null);
  const [filters, setFilters] = useState({
    search: "",
    category: "ALL",
    source: "",
    listingStatus: "ALL",
    sort: "date"
  });
  const visibleItems = useMemo(() => {
    const search = filters.search.toLowerCase().trim();
    return dashboard.inventory
      .filter(
        (item) =>
          !search ||
          item.itemName.toLowerCase().includes(search) ||
          (item.upc || "").toLowerCase().includes(search) ||
          (item.sku || "").toLowerCase().includes(search) ||
          (item.setName || "").toLowerCase().includes(search)
      )
      .filter((item) => filters.category === "ALL" || item.category === filters.category)
      .filter(
        (item) =>
          !filters.source ||
          item.source.toLowerCase().includes(filters.source.toLowerCase()) ||
          (item.sourceStore || "").toLowerCase().includes(filters.source.toLowerCase())
      )
      .filter((item) => filters.listingStatus === "ALL" || item.listingStatus === filters.listingStatus)
      .sort((a, b) => {
        if (filters.sort === "quantity") return b.quantityOwned - a.quantityOwned;
        if (filters.sort === "sales") return b.quantitySold - a.quantitySold;
        if (filters.sort === "name") return a.itemName.localeCompare(b.itemName);
        if (filters.sort === "date") return new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime();
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [dashboard.inventory, filters]);

  function updateFilter(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = event.currentTarget;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  const summary = dashboard.inventorySummary;
  const allSales = useMemo(() => dashboard.inventory.flatMap((item) => item.sales), [dashboard.inventory]);
  const selectedItem = visibleItems.find((item) => item.id === selectedItemId) ?? visibleItems[0] ?? null;
  const detailItem = dashboard.inventory.find((item) => item.id === detailItemId) ?? null;
  const editItem = dashboard.inventory.find((item) => item.id === editItemId) ?? null;
  const storeListingItem = dashboard.inventory.find((item) => item.id === storeListingItemId) ?? null;
  const saleItem = dashboard.inventory.find((item) => item.id === saleItemId) ?? null;
  const editStockItem = editStockLotTarget
    ? dashboard.inventory.find((item) => item.id === editStockLotTarget.itemId) ?? null
    : null;
  const editStockLot = editStockItem?.stockLots.find((lot) => lot.id === editStockLotTarget?.lotId) ?? null;
  const openPurchaseFlow = useCallback((itemId = "", prefill: InventoryPurchasePrefill | null = null) => {
    setPurchaseDefaultItemId(itemId);
    setPurchasePrefill(prefill);
    setAddProductChoiceOpen(false);
    setPurchaseFlowOpen(true);
  }, []);
  const openBarcodeResult = useCallback(
    (result: UpcLookupResultDTO) => {
      if (result.matchedInventoryItem) {
        openPurchaseFlow(result.matchedInventoryItem.id, { upc: result.upc });
      } else {
        const product = result.lookupProduct;
        openPurchaseFlow("", {
          upc: result.upc,
          itemName: product?.productName ?? "",
          brand: product?.brand ?? "",
          category: inventoryCategoryFromLookup(product?.category),
          setName: product?.setName ?? "",
          description: product?.description ?? "",
          manufacturer: product?.manufacturer ?? "",
          model: product?.model ?? "",
          msrp: product?.msrp ?? null,
          sku: product?.sku ?? "",
          productId: product?.productId ?? null,
          retailer: product?.retailer ?? "",
          exactProductUrl: product?.exactProductUrl ?? "",
          imageUrl: product?.imageUrl ?? "",
          source: product?.retailer ?? ""
        });
      }
      setBarcodeScannerOpen(false);
    },
    [openPurchaseFlow]
  );

  async function downloadInventoryPdf(mode: "client" | "internal") {
    await runAction(
      mode === "client" ? "Generating client inventory PDF" : "Generating internal inventory PDF",
      async () => {
        const params = new URLSearchParams({
          mode,
          stock: mode === "client" ? "in-stock" : "all"
        });
        if (filters.search.trim()) params.set("q", filters.search.trim());
        if (filters.category !== "ALL") params.set("category", filters.category);
        if (filters.listingStatus !== "ALL") params.set("listingStatus", filters.listingStatus);
        if (filters.source.trim()) params.set("source", filters.source.trim());
        const response = await fetch(`/api/radar/inventory/export-pdf?${params.toString()}`, {
          credentials: "same-origin"
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "PDF export failed.");
        }
        const blob = await response.blob();
        const disposition = response.headers.get("content-disposition") || "";
        const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
        const filename = filenameMatch?.[1] || `poke-radar-inventory-${mode}-${todayDateInput()}.pdf`;
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
      },
      {
        reload: false,
        success: mode === "client" ? "Client PDF downloaded" : "Internal PDF downloaded"
      }
    );
  }

  return (
    <>
      <section className="inventory-page-header inventory-ops-header" data-hidden-inventory-capabilities={inventoryHiddenUiRegistry.length}>
        <div>
          <h2>Inventory</h2>
          <p>Track products you own, add purchases, and record sales.</p>
        </div>
        <div className="inventory-header-actions">
          <details className="inventory-export-menu">
            <summary className="mini-action">
              <Download size={14} />
              Import / Export
            </summary>
            <div>
              <strong className="inventory-export-section-label">PDF exports</strong>
              <button disabled={busy} type="button" onClick={() => downloadInventoryPdf("client")}>
                {busyLabel === "Generating client inventory PDF" ? "Generating client PDF" : "Export Client PDF"}
              </button>
              <button disabled={busy} type="button" onClick={() => downloadInventoryPdf("internal")}>
                {busyLabel === "Generating internal inventory PDF" ? "Generating internal PDF" : "Export Internal PDF"}
              </button>
              <strong className="inventory-export-section-label">CSV exports</strong>
              <a href="/api/radar/inventory?format=product-catalog-csv" target="_blank" rel="noreferrer">Catalog CSV</a>
              <a href="/api/radar/inventory?format=stock-lots-csv" target="_blank" rel="noreferrer">Lots CSV</a>
              <a href="/api/radar/inventory?format=sales-csv" target="_blank" rel="noreferrer">Sales CSV</a>
              <a href="/api/radar/inventory?format=profit-loss-summary-csv" target="_blank" rel="noreferrer">P/L CSV</a>
              <button
                disabled={busy}
                type="button"
                onClick={() =>
                  runAction(
                    "Refreshing inventory market",
                    () => requestJson("/api/radar/inventory/refresh-comps", { method: "POST" }),
                    { success: "Inventory market refresh finished" }
                  )
                }
              >
                {busyLabel === "Refreshing inventory market" ? "Refreshing market" : "Refresh Market"}
              </button>
            </div>
          </details>
          <button className="mini-action" disabled={!selectedItem} type="button" onClick={() => selectedItem && setSaleItemId(selectedItem.id)}>
            <CircleDollarSign size={14} />
            Record Sale
          </button>
          <button className="mini-action" type="button" onClick={() => setBarcodeScannerOpen(true)}>
            <PackageSearch size={14} />
            Scan UPC
          </button>
          <button
            className="primary-action"
            type="button"
            onClick={() => {
              setAddProductChoiceOpen(true);
            }}
          >
            <Plus size={16} />
            Add Product
          </button>
        </div>
      </section>
      <section className="inventory-kpi-grid">
        <InventoryKpiCard label="Total Products" value={String(dashboard.inventory.length)} detail="Unique products" />
        <InventoryKpiCard label="Items Owned" value={String(summary.itemsOwned)} detail="Total quantity" />
        <InventoryKpiCard label="Total Spent" value={money(summary.totalSpent)} detail="Cost basis" />
        <InventoryKpiCard label="Total Sales" value={money(summary.totalSalesGross)} detail="Revenue" tone="watch" />
        <InventoryKpiCard
          label="Net Profit / Loss"
          value={money(summary.netProfitLoss)}
          detail="Sales minus cost basis"
          tone={summary.netProfitLoss >= 0 ? "good" : "bad"}
        />
      </section>
      <section className="inventory-view-tabs" aria-label="Inventory views">
        {[
          { id: "items", label: "Inventory" },
          { id: "purchases", label: "Purchases" },
          { id: "sales", label: "Sales" }
        ].map((option) => (
          <button
            className={view === option.id ? "active" : ""}
            key={option.id}
            onClick={() => setView(option.id as "items" | "purchases" | "sales")}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </section>
      {view === "items" ? (
        <>
          <InventoryQuickActions
            dashboard={dashboard}
            onAddProduct={() => openPurchaseFlow("")}
            onAddStock={() => {
              openPurchaseFlow(selectedItem?.id ?? "");
            }}
            onScan={() => setBarcodeScannerOpen(true)}
            onRecordSale={() => selectedItem && setSaleItemId(selectedItem.id)}
            onViewSales={() => setView("sales")}
            selectedItem={selectedItem}
          />
          <section className="inventory-management-grid">
            <div className="catalog-panel">
              <InventoryFilters filters={filters} itemCount={visibleItems.length} updateFilter={updateFilter} />
              <InventoryList
                items={visibleItems}
                selectedId={selectedItem?.id ?? ""}
                onSelect={(item) => setSelectedItemId(item.id)}
                onAddStock={(item) => {
                  openPurchaseFlow(item.id);
                }}
                onRecordSale={(item) => {
                  setSaleItemId(item.id);
                }}
                onViewDetails={(item) => setDetailItemId(item.id)}
                onEditListing={(item) => setStoreListingItemId(item.id)}
              />
            </div>
          </section>
        </>
      ) : null}
      {view === "purchases" ? <PurchasesLog items={dashboard.inventory} summary={summary} /> : null}
      {view === "sales" ? (
        <SalesLog
          items={dashboard.inventory}
          sales={allSales}
          selectedItem={selectedItem}
          summary={summary}
          onRecordSale={() => selectedItem && setSaleItemId(selectedItem.id)}
        />
      ) : null}
      {addProductChoiceOpen ? (
        <AddProductChoiceModal
          onClose={() => setAddProductChoiceOpen(false)}
          onScan={() => {
            setAddProductChoiceOpen(false);
            setBarcodeScannerOpen(true);
          }}
          onManual={() => openPurchaseFlow("")}
        />
      ) : null}
      {purchaseFlowOpen ? (
        <div className="inventory-modal-backdrop" role="presentation">
          <div className="inventory-modal" role="dialog" aria-modal="true" aria-label="Add purchase">
            <div className="edit-card-heading">
              <div>
                <h2>Add Purchase</h2>
                <span>Add a stock lot to an existing product or create a new catalog item.</span>
              </div>
              <button className="icon-button" type="button" aria-label="Close add purchase" onClick={() => setPurchaseFlowOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <PurchaseFlow
              key={`${purchaseDefaultItemId || "new-purchase"}-${purchasePrefill?.upc || ""}`}
              items={dashboard.inventory}
              defaultItemId={purchaseDefaultItemId}
              prefill={purchasePrefill}
              onScanBarcode={() => setBarcodeScannerOpen(true)}
              busy={busy}
              busyLabel={busyLabel}
              submit={async (event, label, run, options) => {
                await submit(event, label, run, options);
                setPurchaseFlowOpen(false);
                setPurchasePrefill(null);
              }}
            />
          </div>
        </div>
      ) : null}
      {saleItem ? (
        <RecordSaleModal
          item={saleItem}
          busy={busy}
          busyLabel={busyLabel}
          submit={async (event, label, run, options) => {
            await submit(event, label, run, options);
            setSaleItemId("");
          }}
          onClose={() => setSaleItemId("")}
        />
      ) : null}
      {barcodeScannerOpen ? (
        <BarcodeScannerModal
          dashboard={dashboard}
          onUseResult={openBarcodeResult}
          onViewProduct={(item) => {
            setBarcodeScannerOpen(false);
            setDetailItemId(item.id);
          }}
          onClose={() => setBarcodeScannerOpen(false)}
        />
      ) : null}
      {detailItem ? (
        <InventoryDetailsModal
          item={detailItem}
          onAddStock={(item) => openPurchaseFlow(item.id)}
          onRecordSale={(item) => {
            setDetailItemId("");
            setSelectedItemId(item.id);
            setSaleItemId(item.id);
          }}
          onEditProduct={(item) => {
            setDetailItemId("");
            setEditItemId(item.id);
          }}
          onEditListing={(item) => {
            setDetailItemId("");
            setStoreListingItemId(item.id);
          }}
          onEditStockLot={(item, lot) => {
            setDetailItemId("");
            setEditStockLotTarget({ itemId: item.id, lotId: lot.id });
          }}
          onDeleteStockLot={(item, lot) =>
            runAction(
              `Removing stock lot ${lot.id}`,
              () =>
                requestJson(`/api/radar/inventory/${item.id}/stock-lots/${lot.id}`, {
                  method: "DELETE"
                }),
              {
                confirm:
                  "Remove this stock lot? This is for fixing mistaken stock entries. Lots with recorded sales cannot be removed.",
                success: "Stock lot removed"
              }
            )
          }
          onClose={() => setDetailItemId("")}
        />
      ) : null}
      {editStockItem && editStockLot ? (
        <InventoryEditStockLotModal
          item={editStockItem}
          lot={editStockLot}
          busy={busy}
          busyLabel={busyLabel}
          submit={async (event, label, run, options) => {
            await submit(event, label, run, options);
            setEditStockLotTarget(null);
          }}
          onClose={() => setEditStockLotTarget(null)}
        />
      ) : null}
      {editItem ? (
        <InventoryEditProductModal
          item={editItem}
          busy={busy}
          busyLabel={busyLabel}
          submit={submit}
          onClose={() => setEditItemId("")}
        />
      ) : null}
      {storeListingItem ? (
        <StoreListingModal
          item={storeListingItem}
          busy={busy}
          busyLabel={busyLabel}
          submit={async (event, label, run, options) => {
            await submit(event, label, run, options);
            setStoreListingItemId("");
          }}
          onClose={() => setStoreListingItemId("")}
        />
      ) : null}
    </>
  );
}

function StorefrontOrdersPanel({
  dashboard,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const selectedOrder = dashboard.storefrontOrders.find((order) => order.id === selectedOrderId) ?? null;
  const stats = dashboard.storefrontSummary;

  return (
    <>
      <section className="inventory-page-header inventory-ops-header storefront-admin-header">
        <div>
          <h2>Orders</h2>
          <p>Manage storefront sales, fulfillment, shipping, and profit.</p>
        </div>
        <div className="inventory-header-actions">
          <a className="mini-action" href="/shop" target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            View Store
          </a>
          <button
            className="mini-action"
            disabled={busy}
            type="button"
            onClick={() => runAction("Refreshing orders", () => requestJson("/api/radar/dashboard"), { success: "Orders refreshed" })}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </section>

      <section className="inventory-kpi-grid">
        <InventoryKpiCard label="Published Products" value={String(stats.productCount)} detail={`${stats.activeProductCount} active`} />
        <InventoryKpiCard label="Pending Orders" value={String(stats.pendingOrderCount)} detail="Awaiting payment" tone={stats.pendingOrderCount ? "watch" : "neutral"} />
        <InventoryKpiCard label="Paid Orders" value={String(stats.paidOrderCount)} detail="All time" tone="good" />
        <InventoryKpiCard label="Store Revenue" value={money(stats.totalRevenue)} detail="Paid orders" tone="watch" />
        <InventoryKpiCard label="Store Profit" value={money(stats.netProfit)} detail="After cost estimates" tone={stats.netProfit >= 0 ? "good" : "bad"} />
      </section>

      <section className="storefront-admin-grid">
        <section className="dashboard-card storefront-orders-card">
          <div className="dashboard-card-header">
            <div>
              <h3>Order Queue</h3>
              <span>{dashboard.storefrontOrders.length} recent orders</span>
            </div>
          </div>
          <div className="storefront-order-list">
            {dashboard.storefrontOrders.length ? (
              dashboard.storefrontOrders.map((order) => (
                <article className="storefront-order-row" key={order.id}>
                  <button type="button" onClick={() => setSelectedOrderId(order.id)}>
                    <strong>{order.orderNumber}</strong>
                    <span>{order.customerEmail || "No customer email"} - {relativeTime(order.createdAt)}</span>
                    <small>{order.items.map((item) => `${item.quantity}x ${item.publicTitle}`).join(", ")}</small>
                  </button>
                  <span className={`chip compact-chip ${order.paymentStatus === "paid" ? "good" : "watch"}`}>{order.paymentStatus}</span>
                  <span className="storefront-order-total">{money(order.total)}</span>
                  <div className="catalog-actions">
                    <button
                      className="mini-action"
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        runAction(
                          `Marking ${order.orderNumber} packing`,
                          () =>
                            requestJson(`/api/radar/storefront/orders/${order.id}`, {
                              method: "PATCH",
                              body: JSON.stringify({ status: "packing", fulfillmentStatus: "packing" })
                            }),
                          { success: "Order marked packing" }
                        )
                      }
                    >
                      Packing
                    </button>
                    <button className="mini-action" type="button" onClick={() => setSelectedOrderId(order.id)}>
                      Details
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <EmptyState icon={ShoppingBag} title="No orders yet" detail="Published products will appear in your store when active." />
            )}
          </div>
        </section>

        <StorefrontSettingsCard dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} />
      </section>

      {selectedOrder ? (
        <StorefrontOrderDetailsModal
          order={selectedOrder}
          busy={busy}
          busyLabel={busyLabel}
          submit={submit}
          runAction={runAction}
          onClose={() => setSelectedOrderId("")}
        />
      ) : null}
    </>
  );
}

function StorefrontSettingsCard({
  dashboard,
  busy,
  busyLabel,
  submit
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
}) {
  const settings = dashboard.storefrontSettings;
  return (
    <section className="dashboard-card storefront-settings-card">
      <div className="dashboard-card-header">
        <div>
          <h3>Store Settings</h3>
          <span>Public policies, shipping price, and storefront branding.</span>
        </div>
      </div>
      <form
        className="form-stack"
        onSubmit={(event) =>
          submit(
            event,
            "Saving storefront settings",
            (form) => requestJson("/api/radar/storefront/settings", { method: "PATCH", body: JSON.stringify(formJson(form)) }),
            { reset: false, success: "Store settings saved" }
          )
        }
      >
        <TextInput name="storeName" label="Store name" defaultValue={settings.storeName} required />
        <TextInput name="contactEmail" label="Contact email" type="email" defaultValue={settings.contactEmail ?? ""} />
        <TextInput name="defaultShippingPrice" label="Flat-rate shipping" type="number" min="0" step="0.01" defaultValue={settings.defaultShippingPrice} />
        <TextInput name="freeShippingThreshold" label="Free shipping threshold" type="number" min="0" step="0.01" defaultValue={settings.freeShippingThreshold ?? ""} />
        <TextareaInput name="announcementBanner" label="Announcement banner" defaultValue={settings.announcementBanner ?? ""} />
        <TextareaInput name="shippingPolicyText" label="Shipping policy" defaultValue={settings.shippingPolicyText ?? ""} />
        <TextareaInput name="returnPolicyText" label="Return policy" defaultValue={settings.returnPolicyText ?? ""} />
        <TextareaInput name="localPickupInstructions" label="Local pickup instructions" defaultValue={settings.localPickupInstructions ?? ""} />
        <button className="primary-action" disabled={busy} type="submit">
          <Save size={16} />
          {busyLabel === "Saving storefront settings" ? "Saving" : "Save Store Settings"}
        </button>
      </form>
    </section>
  );
}

function StorefrontOrderDetailsModal({
  order,
  busy,
  busyLabel,
  submit,
  runAction,
  onClose
}: {
  order: StorefrontOrderDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
  onClose: () => void;
}) {
  const saveLabel = `Updating order ${order.id}`;
  return (
    <div className="inventory-modal-backdrop" role="presentation">
      <div className="inventory-details-modal" role="dialog" aria-modal="true" aria-label={`Order ${order.orderNumber}`}>
        <header className="inventory-details-header">
          <div className="storefront-order-avatar"><ShoppingBag size={24} /></div>
          <div>
            <h2>{order.orderNumber}</h2>
            <p>{order.customerName || "Customer"} - {order.customerEmail || "email not saved"}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close order details" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <section className="inventory-details-actions">
          <button
            className="mini-action"
            disabled={busy}
            type="button"
            onClick={() =>
              runAction(
                `Marking ${order.orderNumber} packing`,
                () =>
                  requestJson(`/api/radar/storefront/orders/${order.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ status: "packing", fulfillmentStatus: "packing" })
                  }),
                { success: "Order marked packing" }
              )
            }
          >
            Mark Packing
          </button>
          <button className="mini-action" type="button" onClick={() => window.print()}>
            <Printer size={14} />
            Packing Slip
          </button>
        </section>
        <div className="inventory-details-grid">
          <section>
            <h3>Items</h3>
            <div className="storefront-order-items">
              {order.items.map((item) => (
                <article className="storefront-order-item" key={item.id}>
                  <span>{item.imageUrl ? <Image src={item.imageUrl} alt={item.publicTitle} width={72} height={72} unoptimized /> : <ShoppingBag size={22} />}</span>
                  <div>
                    <strong>{item.publicTitle}</strong>
                    <small>Qty {item.quantity} - {money(item.unitPrice)} each</small>
                  </div>
                  <b>{money(item.lineTotal)}</b>
                </article>
              ))}
            </div>
          </section>
          <section>
            <h3>Totals</h3>
            <div className="detail-stat-grid">
              <DetailStat label="Subtotal" value={money(order.subtotal)} />
              <DetailStat label="Shipping charged" value={money(order.shippingCharged)} />
              <DetailStat label="Total paid" value={money(order.total)} tone="good" />
              <DetailStat label="Cost basis" value={money(order.costBasis)} />
              <DetailStat label="Net profit" value={money(order.netProfit)} tone={order.netProfit >= 0 ? "good" : "bad"} />
              <DetailStat label="ROI" value={percent(order.roiPercent)} />
            </div>
          </section>
          <section className="wide">
            <h3>Fulfillment</h3>
            <form
              className="form-grid compact"
              onSubmit={(event) =>
                submit(
                  event,
                  saveLabel,
                  (form) => requestJson(`/api/radar/storefront/orders/${order.id}`, { method: "PATCH", body: JSON.stringify(formJson(form)) }),
                  { reset: false, success: "Order updated" }
                )
              }
            >
              <SelectInput
                name="status"
                label="Order status"
                defaultValue={order.status}
                options={["pending_payment", "paid", "packing", "shipped", "canceled", "refunded"].map(optionFromString)}
              />
              <SelectInput
                name="fulfillmentStatus"
                label="Fulfillment status"
                defaultValue={order.fulfillmentStatus}
                options={["unfulfilled", "packing", "shipped", "pickup_ready", "picked_up", "canceled"].map(optionFromString)}
              />
              <TextInput name="carrier" label="Carrier" defaultValue={order.carrier ?? ""} />
              <TextInput name="trackingNumber" label="Tracking number" defaultValue={order.trackingNumber ?? ""} />
              <TextInput name="shippingCost" label="Actual shipping cost" type="number" min="0" step="0.01" defaultValue={order.shippingCost || ""} />
              <TextareaInput name="notes" label="Order notes" defaultValue={order.notes ?? ""} wide />
              <button className="primary-action" disabled={busy} type="submit">
                <Save size={16} />
                {busyLabel === saveLabel ? "Saving" : "Save Fulfillment"}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

function InventoryKpiCard({
  label,
  value,
  detail,
  tone = "neutral"
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "watch" | "bad";
}) {
  return (
    <article className={`inventory-kpi-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function AddProductChoiceModal({
  onClose,
  onScan,
  onManual
}: {
  onClose: () => void;
  onScan: () => void;
  onManual: () => void;
}) {
  return (
    <div className="inventory-modal-backdrop" role="presentation">
      <div className="inventory-modal inventory-choice-modal" role="dialog" aria-modal="true" aria-label="Add product">
        <div className="edit-card-heading">
          <div>
            <h2>Add Product</h2>
            <span>Choose how you want to add a product.</span>
          </div>
          <button className="icon-button" type="button" aria-label="Close add product" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="inventory-choice-grid">
          <button className="inventory-choice-card primary" type="button" onClick={onScan}>
            <span><PackageSearch size={22} /></span>
            <strong>Scan UPC / Barcode</strong>
            <small>Use camera scan or enter UPC manually.</small>
          </button>
          <button className="inventory-choice-card" type="button" onClick={onManual}>
            <span><Plus size={22} /></span>
            <strong>Add Manually</strong>
            <small>Enter product details and purchase info yourself.</small>
          </button>
        </div>
        <button className="mini-action" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function InventoryMarketDecisionPanels({ items }: { items: InventoryItemDTO[] }) {
  const sellToday = [...items]
    .filter((item) => ["SELL_NOW", "LIST_HIGH"].includes(item.recommendedAction))
    .sort((a, b) => (b.marketProfitLoss ?? b.businessProfitLoss ?? 0) - (a.marketProfitLoss ?? a.businessProfitLoss ?? 0))
    .slice(0, 3);
  const bestHold = [...items]
    .filter((item) => item.recommendedAction === "HOLD" && (item.marketProfitLoss ?? item.businessProfitLoss ?? 0) >= 0)
    .sort((a, b) => (b.marketRoiPercent ?? b.roiPercent ?? 0) - (a.marketRoiPercent ?? a.roiPercent ?? 0))
    .slice(0, 3);
  const avoidBuying = [...items]
    .filter((item) => item.recommendedAction === "AVOID_BUYING_MORE" || (item.marketProfitLoss ?? item.businessProfitLoss ?? 0) < 0)
    .sort((a, b) => (a.marketProfitLoss ?? a.businessProfitLoss ?? 0) - (b.marketProfitLoss ?? b.businessProfitLoss ?? 0))
    .slice(0, 3);

  return (
    <section className="inventory-decision-grid" aria-label="Inventory market decisions">
      <InventoryDecisionCard title="What should I sell today?" empty="No urgent sells yet." items={sellToday} metric={(item) => money(item.marketProfitLoss ?? item.businessProfitLoss)} />
      <InventoryDecisionCard
        title="Best hold"
        empty="No strong holds yet."
        items={bestHold}
        metric={(item) => percent(item.marketRoiPercent ?? item.roiPercent)}
        tone="watch"
      />
      <InventoryDecisionCard title="Avoid buying more" empty="No avoid signals yet." items={avoidBuying} metric={(item) => money(item.marketProfitLoss ?? item.businessProfitLoss)} tone="bad" />
    </section>
  );
}

function InventoryDecisionCard({
  title,
  empty,
  items,
  metric,
  tone = "good"
}: {
  title: string;
  empty: string;
  items: InventoryItemDTO[];
  metric: (item: InventoryItemDTO) => string;
  tone?: "good" | "watch" | "bad";
}) {
  return (
    <article className={`inventory-decision-card ${tone}`}>
      <h3>{title}</h3>
      {items.length ? (
        items.map((item) => (
          <div className="inventory-decision-row" key={item.id}>
            <span>
              <strong>{item.itemName}</strong>
              <small>{item.recommendationReason || "Review current market comps before listing."}</small>
            </span>
            <b>{metric(item)}</b>
          </div>
        ))
      ) : (
        <p>{empty}</p>
      )}
    </article>
  );
}

function normalizeBarcodeValue(value: string) {
  return normalizeUPC(value);
}

type BarcodeFrameMode = "normal" | "contrast" | "threshold" | "invertedThreshold";
type BarcodeFrameAttempt = {
  cropScale: number;
  cropXScale?: number;
  cropYScale?: number;
  offsetX?: number;
  offsetY?: number;
  rotation: 0 | 90 | -90 | 180;
  scale: number;
  mode: BarcodeFrameMode;
  smoothing?: boolean;
};

type BarcodeScanDiagnostics = {
  frames: number;
  zxingMisses: number;
  backupAttempts: number;
  lastDecoder: string;
  lastRead: string;
  lastError: string;
  videoSize: string;
};

type QuaggaReader = typeof import("@ericblade/quagga2").default;

let quaggaReaderPromise: Promise<QuaggaReader> | null = null;

function loadQuaggaReader() {
  quaggaReaderPromise ??= import("@ericblade/quagga2").then((module) => module.default);
  return quaggaReaderPromise;
}

const supportedBarcodeFormats = [
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128
];

const initialBarcodeScanDiagnostics: BarcodeScanDiagnostics = {
  frames: 0,
  zxingMisses: 0,
  backupAttempts: 0,
  lastDecoder: "Idle",
  lastRead: "",
  lastError: "Waiting for camera",
  videoSize: ""
};

function createBarcodeReader() {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, supportedBarcodeFormats);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatOneDReader(hints, {
    delayBetweenScanAttempts: 70,
    delayBetweenScanSuccess: 300,
    tryPlayVideoTimeout: 8000
  });
}

function enhanceBarcodeCanvas(canvas: HTMLCanvasElement, mode: BarcodeFrameMode) {
  if (mode === "normal") return;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  let min = 255;
  let max = 0;
  for (let index = 0; index < data.length; index += 4) {
    const luminance = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    min = Math.min(min, luminance);
    max = Math.max(max, luminance);
  }
  const midpoint = Math.max(72, Math.min(184, Math.round((min + max) / 2)));
  for (let index = 0; index < data.length; index += 4) {
    const luminance = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    const contrasted = Math.max(0, Math.min(255, Math.round((luminance - 128) * 2.1 + 128)));
    const value =
      mode === "contrast"
        ? contrasted
        : mode === "threshold"
          ? luminance > midpoint
            ? 255
            : 0
          : luminance > midpoint
            ? 0
            : 255;
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function drawBarcodeVideoFrame(videoElement: HTMLVideoElement, attempt: BarcodeFrameAttempt) {
  if (!videoElement.videoWidth || !videoElement.videoHeight) return null;
  const videoWidth = videoElement.videoWidth;
  const videoHeight = videoElement.videoHeight;
  const sourceWidth = Math.max(1, Math.floor(videoWidth * (attempt.cropXScale ?? attempt.cropScale)));
  const sourceHeight = Math.max(1, Math.floor(videoHeight * (attempt.cropYScale ?? attempt.cropScale)));
  const centeredX = (videoWidth - sourceWidth) / 2 + (attempt.offsetX ?? 0) * videoWidth;
  const centeredY = (videoHeight - sourceHeight) / 2 + (attempt.offsetY ?? 0) * videoHeight;
  const sourceX = Math.max(0, Math.min(videoWidth - sourceWidth, Math.floor(centeredX)));
  const sourceY = Math.max(0, Math.min(videoHeight - sourceHeight, Math.floor(centeredY)));
  const targetWidth = Math.max(1, Math.floor(sourceWidth * attempt.scale));
  const targetHeight = Math.max(1, Math.floor(sourceHeight * attempt.scale));
  const canvas = document.createElement("canvas");
  const rotated = Math.abs(attempt.rotation) === 90;
  canvas.width = rotated ? targetHeight : targetWidth;
  canvas.height = rotated ? targetWidth : targetHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = attempt.smoothing ?? false;
  if (attempt.mode === "contrast") context.filter = "contrast(1.65) brightness(1.12) saturate(0)";
  if (attempt.rotation === 90) {
    context.translate(canvas.width, 0);
    context.rotate(Math.PI / 2);
  } else if (attempt.rotation === -90) {
    context.translate(0, canvas.height);
    context.rotate(-Math.PI / 2);
  } else if (attempt.rotation === 180) {
    context.translate(canvas.width, canvas.height);
    context.rotate(Math.PI);
  }
  context.drawImage(videoElement, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);
  enhanceBarcodeCanvas(canvas, attempt.mode);
  return canvas;
}

function decodeCurrentBarcodeFrame(reader: BrowserMultiFormatOneDReader, videoElement: HTMLVideoElement) {
  if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  const attempts: BarcodeFrameAttempt[] = [
    { cropScale: 1, rotation: 0, scale: 1, mode: "normal", smoothing: true },
    { cropScale: 1, cropXScale: 0.96, cropYScale: 0.36, offsetY: 0.14, rotation: 0, scale: 2.25, mode: "contrast" },
    { cropScale: 1, cropXScale: 0.96, cropYScale: 0.36, offsetY: 0.14, rotation: 0, scale: 2.25, mode: "threshold" },
    { cropScale: 1, cropXScale: 0.9, cropYScale: 0.28, offsetY: 0.18, rotation: 0, scale: 2.7, mode: "contrast" },
    { cropScale: 1, cropXScale: 0.9, cropYScale: 0.28, offsetY: 0.18, rotation: 0, scale: 2.7, mode: "threshold" },
    { cropScale: 0.82, rotation: 0, scale: 1.45, mode: "contrast" },
    { cropScale: 0.72, rotation: 0, scale: 1.9, mode: "contrast" },
    { cropScale: 0.72, rotation: 0, scale: 1.9, mode: "threshold" },
    { cropScale: 0.58, rotation: 0, scale: 2.4, mode: "contrast" },
    { cropScale: 0.58, rotation: 0, scale: 2.4, mode: "threshold" },
    { cropScale: 0.82, rotation: 180, scale: 1.45, mode: "contrast" },
    { cropScale: 1, rotation: 90, scale: 1, mode: "normal", smoothing: true },
    { cropScale: 1, rotation: -90, scale: 1, mode: "normal", smoothing: true }
  ];
  for (const attempt of attempts) {
    const canvas = drawBarcodeVideoFrame(videoElement, attempt);
    if (!canvas) continue;
    try {
      return reader.decodeFromCanvas(canvas).getText();
    } catch {
      // Missed frames are expected while the barcode is out of focus, angled, or not yet centered.
    }
  }
  return null;
}

function quaggaDecodeCanvas(canvas: HTMLCanvasElement) {
  return new Promise<string | null>((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), 520);
    loadQuaggaReader()
      .then((Quagga) => {
        void Quagga.decodeSingle(
          {
            src: canvas.toDataURL("image/png"),
            inputStream: {
              type: "ImageStream",
              size: 960,
              singleChannel: false,
              willReadFrequently: true
            },
            locate: true,
            numOfWorkers: 0,
            frequency: 8,
            canvas: { createOverlay: false },
            locator: {
              halfSample: false,
              patchSize: "medium",
              willReadFrequently: true
            },
            decoder: {
              readers: ["upc_reader", "upc_e_reader", "ean_reader", "ean_8_reader", "code_128_reader"]
            }
          },
          (scan) => {
            window.clearTimeout(timeout);
            resolve(scan?.codeResult?.code ?? null);
          }
        ).catch(() => {
          window.clearTimeout(timeout);
          resolve(null);
        });
      })
      .catch(() => {
        window.clearTimeout(timeout);
        resolve(null);
      });
  });
}

async function decodeCurrentBarcodeFrameWithQuagga(videoElement: HTMLVideoElement) {
  if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  const attempts: BarcodeFrameAttempt[] = [
    { cropScale: 1, cropXScale: 0.96, cropYScale: 0.36, offsetY: 0.14, rotation: 0, scale: 2.25, mode: "contrast" },
    { cropScale: 1, cropXScale: 0.9, cropYScale: 0.28, offsetY: 0.18, rotation: 0, scale: 2.7, mode: "contrast" },
    { cropScale: 1, cropXScale: 0.9, cropYScale: 0.28, offsetY: 0.18, rotation: 0, scale: 2.7, mode: "threshold" },
    { cropScale: 0.78, rotation: 0, scale: 1.7, mode: "contrast" },
    { cropScale: 0.64, rotation: 0, scale: 2.25, mode: "contrast" },
    { cropScale: 0.64, rotation: 0, scale: 2.25, mode: "threshold" },
    { cropScale: 0.54, rotation: 0, scale: 2.65, mode: "threshold" }
  ];
  for (const attempt of attempts.slice(0, 3)) {
    const canvas = drawBarcodeVideoFrame(videoElement, attempt);
    if (!canvas) continue;
    const decoded = await quaggaDecodeCanvas(canvas);
    if (decoded) return decoded;
  }
  return null;
}

function upcLookupFailureMessage(result: UpcLookupResultDTO) {
  if (result.lookupProduct) return result.message;
  if (result.status === "NEW_UPC") {
    return result.externalLookupConfigured
      ? "New UPC detected. No existing product was found, so create this product manually."
      : "New UPC detected. External UPC lookup is not configured, but you can still create this product manually.";
  }
  const searchFailure = result.debug.failures.find((failure) => failure.source === "search");
  if (searchFailure?.reason === "missing_env_or_no_results" && searchFailure.configured === false) {
    return "No product found from configured sources. Search fallback is not configured. UPC provider may miss newer Pokemon products.";
  }
  const providerFailure = result.debug.failures.find((failure) => failure.source === "upc_provider");
  if (providerFailure?.reason === "not_found") {
    return "No product found from configured sources. UPC provider missed this barcode and no configured search fallback returned a result.";
  }
  return result.message || "No product found from configured sources.";
}

function upcLookupSuccessMessage(result: UpcLookupResultDTO) {
  const product = result.lookupProduct;
  if (result.matchedInventoryItem) return "Product found in your inventory catalog. Add stock to the existing item.";
  if (result.matchedProduct) return "Watched product found. Create an inventory product from the saved tracker details.";
  if (!product) return upcLookupFailureMessage(result);
  if (product.source === "external" && product.matchQuality && product.matchQuality !== "HIGH") {
    return `Possible match from ${product.retailer || "product search"} (${product.matchQuality.toLowerCase()} confidence). Review before saving.`;
  }
  if (product.source === "external") {
    return `Found from ${product.retailer || "product search"}. Confirm before saving.`;
  }
  return result.message;
}

function upcLookupResultTitle(result: UpcLookupResultDTO) {
  if (result.matchedInventoryItem) return "Product found";
  if (result.matchedProduct) return "Watched product found";
  if (result.lookupProduct) return "Product details found";
  if (result.status === "NEW_UPC") return "New UPC detected";
  return "Manual product needed";
}

function upcLookupPrimaryAction(result: UpcLookupResultDTO) {
  if (result.nextAction === "ADD_STOCK") return "Add Stock";
  if (result.nextAction === "CREATE_FROM_WATCHED") return "Create Inventory Product From This";
  return "Create New Product";
}

function upcLookupMatchSource(result: UpcLookupResultDTO) {
  if (result.matchedInventoryItem) return "Inventory Catalog";
  if (result.matchedProduct) return "Watched Product";
  if (result.lookupProduct?.source === "external") return "External Lookup";
  if (result.debug.matchedPreviousScan) return "Previous Scan";
  return "Manual Needed";
}

function UpcLookupDebugDetails({ result }: { result: UpcLookupResultDTO }) {
  return (
    <details className="barcode-debug-details">
      <summary>Lookup details</summary>
      <div>
        <span>Sources tried: {result.debug.attemptedSources.join(", ") || "None"}</span>
        <span>Raw scan: {result.debug.rawCode || result.rawCode}</span>
        <span>Normalized: {result.debug.normalizedUpc || result.normalizedUpc}</span>
        <span>Variants: {(result.debug.variantsChecked || result.variantsChecked).join(", ")}</span>
        <span>Inventory match: {result.debug.matchedInventoryProduct ? "Yes" : "No"}</span>
        <span>Watched product match: {result.debug.matchedWatchedProduct ? "Yes" : "No"}</span>
        <span>Previous scan match: {result.debug.matchedPreviousScan ? "Yes" : "No"}</span>
        <span>External attempted: {result.debug.externalLookupAttempted ? "Yes" : "No"}</span>
        <span>Reason: {result.debug.resultReason || "Not recorded"}</span>
        <span>Search fallback: {result.debug.providerConfig.searchFallback ? "Configured" : "Not configured"}</span>
        {result.debug.providerConfig.searchProvider ? <span>Search provider: {result.debug.providerConfig.searchProvider}</span> : null}
      </div>
      {result.debug.failures.length ? (
        <ul>
          {result.debug.failures.map((failure, index) => (
            <li key={`${failure.source}-${failure.reason}-${index}`}>
              {failure.source}: {failure.reason}
              {failure.statusCode ? ` (${failure.statusCode})` : ""}
              {failure.detail ? ` - ${failure.detail}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p>No lookup failures recorded.</p>
      )}
    </details>
  );
}

function BarcodeScannerModal({
  dashboard,
  onUseResult,
  onViewProduct,
  onClose
}: {
  dashboard: DashboardDTO;
  onUseResult: (result: UpcLookupResultDTO) => void;
  onViewProduct: (item: InventoryItemDTO) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const frameDecodeTimerRef = useRef<number | null>(null);
  const frameDecodeInFlightRef = useRef(false);
  const scanLockedRef = useRef(false);
  const cameraStartLockedRef = useRef(false);
  const scanDiagnosticsRef = useRef<BarcodeScanDiagnostics>({ ...initialBarcodeScanDiagnostics });
  const zxingMissCountRef = useRef(0);
  const [manualUpc, setManualUpc] = useState("");
  const [result, setResult] = useState<UpcLookupResultDTO | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [imageDecodeBusy, setImageDecodeBusy] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraPreviewReady, setCameraPreviewReady] = useState(false);
  const [cameraCaptured, setCameraCaptured] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("Tap Start Camera to scan a UPC/EAN barcode with ZXing. No image or video is saved.");
  const [scanDiagnostics, setScanDiagnostics] = useState<BarcodeScanDiagnostics>(initialBarcodeScanDiagnostics);
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const history = result?.history ?? dashboard.barcodeScans;
  const cameraAvailable = typeof window !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  const updateScanDiagnostics = useCallback((patch: Partial<BarcodeScanDiagnostics>) => {
    const next = { ...scanDiagnosticsRef.current, ...patch };
    scanDiagnosticsRef.current = next;
    setScanDiagnostics(next);
  }, []);

  const resetScanDiagnostics = useCallback((patch?: Partial<BarcodeScanDiagnostics>) => {
    const next = { ...initialBarcodeScanDiagnostics, ...patch };
    scanDiagnosticsRef.current = next;
    zxingMissCountRef.current = 0;
    setScanDiagnostics(next);
  }, []);

  const refreshCameraDevices = useCallback(async () => {
    if (!cameraAvailable) return [] as MediaDeviceInfo[];
    try {
      const devices = await BrowserCodeReader.listVideoInputDevices();
      setCameraDevices(devices);
      if (selectedCameraId && !devices.some((device) => device.deviceId === selectedCameraId)) {
        setSelectedCameraId("");
      }
      return devices;
    } catch {
      setCameraDevices([]);
      return [] as MediaDeviceInfo[];
    }
  }, [cameraAvailable, selectedCameraId]);

  const stopCameraStream = useCallback((message?: string) => {
    scanLockedRef.current = true;
    cameraStartLockedRef.current = false;
    try {
      scannerControlsRef.current?.stop();
    } catch {
      // Camera cleanup must continue even if the scanner already stopped itself.
    }
    scannerControlsRef.current = null;
    if (frameDecodeTimerRef.current) {
      window.clearInterval(frameDecodeTimerRef.current);
      frameDecodeTimerRef.current = null;
    }
    frameDecodeInFlightRef.current = false;
    try {
      BrowserCodeReader.releaseAllStreams();
    } catch {
      // Older ZXing-owned streams are released as a backup; manual streams are handled below.
    }
    const videoElement = videoRef.current;
    const stream = mediaStreamRef.current ?? videoElement?.srcObject;
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    mediaStreamRef.current = null;
    if (videoElement) {
      videoElement.pause();
      videoElement.srcObject = null;
      videoElement.removeAttribute("src");
      videoElement.load();
    }
    setCameraActive(false);
    setCameraStarting(false);
    setCameraPreviewReady(false);
    if (message) {
      updateScanDiagnostics({ lastDecoder: "Stopped", lastError: message });
    }
    if (message) setCameraMessage(message);
  }, [updateScanDiagnostics]);

  const cameraErrorMessage = useCallback((error: unknown) => {
    const name = error instanceof Error ? error.name : "";
    const rawMessage = error instanceof Error ? error.message : "";
    if (!window.isSecureContext) {
      return "Camera scanning requires a secure HTTPS page. Open the live app at https://poke-restock-radar.vercel.app.";
    }
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "Camera permission was blocked. Use the browser lock icon beside the address bar, allow Camera for Poke Radar, then try Start Camera again.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No laptop camera was found. Connect or enable your webcam, then try Start Camera again.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "Your camera is already in use by another app or browser tab. Close the other camera app, then try again.";
    }
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      return "The selected camera was not available. Choose another camera or use Default webcam.";
    }
    return rawMessage || "Camera could not start. Try another camera, refresh the page, or type the UPC manually.";
  }, []);

  const createManualLookupResult = useCallback(
    (upc: string, source: "camera" | "manual", message: string): UpcLookupResultDTO => ({
      upc,
      rawCode: upc,
      normalizedUpc: upc,
      variantsChecked: [upc],
      nextAction: "CREATE_MANUAL",
      status: "NEW_UPC",
      message,
      matchedInventoryItem: null,
      matchedProduct: null,
      lookupProduct: null,
      externalLookupConfigured: false,
      debug: {
        attemptedSources: ["local", "catalog", "scan_history"],
        failures: [
          {
            source: "lookup",
            reason: "request_failed",
            configured: false,
            detail: message
          }
        ],
        rawCode: upc,
        normalizedUpc: upc,
        variantsChecked: [upc],
        matchedInventoryProduct: false,
        matchedWatchedProduct: false,
        matchedPreviousScan: false,
        externalLookupAttempted: false,
        resultReason: source === "camera" ? "camera_lookup_failed_manual_create" : "manual_lookup_failed_manual_create",
        providerConfig: {
          configuredUpcProvider: false,
          publicUpcProvider: false,
          searchFallback: false,
          searchProvider: null
        }
      },
      history: dashboard.barcodeScans
    }),
    [dashboard.barcodeScans]
  );

  const lookupUpc = useCallback(async (upc: string, source: "camera" | "manual") => {
    const normalized = normalizeBarcodeValue(upc);
    if (!/^\d{6,14}$/.test(normalized)) {
      setCameraMessage("Enter or scan a 6 to 14 digit UPC/EAN.");
      return;
    }
    setLookupBusy(true);
    setResult(null);
    setCameraMessage(source === "camera" ? `Scanned ${normalized}. Looking up product...` : `Looking up ${normalized}...`);
    try {
      const lookup = await requestJson<UpcLookupResultDTO>("/api/radar/inventory/upc/lookup", {
        method: "POST",
        body: JSON.stringify({ upc: normalized, source })
      });
      setResult(lookup);
      setManualUpc(lookup.upc);
      setCameraMessage(lookup.lookupProduct ? upcLookupSuccessMessage(lookup) : upcLookupFailureMessage(lookup));
    } catch (error) {
      const message =
        error instanceof Error
          ? `${error.message} You can still create this product manually.`
          : "Lookup failed. You can still create this product manually.";
      const fallback = createManualLookupResult(normalized, source, message);
      setResult(fallback);
      setManualUpc(fallback.upc);
      setCameraMessage(message);
    } finally {
      setLookupBusy(false);
    }
  }, [createManualLookupResult]);

  const handleDecodedBarcode = useCallback(
    (rawValue: string, source: "camera" | "manual") => {
      const normalized = normalizeBarcodeValue(rawValue);
      if (!/^\d{6,14}$/.test(normalized)) {
        setCameraMessage("Scanner Could Not Read Barcode: detected value was not a valid 6 to 14 digit UPC/EAN. Try again or type it manually.");
        return;
      }
      scanLockedRef.current = true;
      setCameraCaptured(true);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate?.(90);
      }
      setManualUpc(normalized);
      setResult(null);
      stopCameraStream(`Barcode captured: ${normalized}. Looking up product...`);
      void lookupUpc(normalized, source);
    },
    [lookupUpc, stopCameraStream]
  );

  const startCamera = useCallback(async () => {
    if (cameraStartLockedRef.current) return;
    if (!cameraAvailable) {
      setCameraMessage("Camera access is not available in this browser. Use manual UPC entry.");
      return;
    }
    stopCameraStream();
    cameraStartLockedRef.current = true;
    scanLockedRef.current = false;
    resetScanDiagnostics({ lastDecoder: "Starting", lastError: "Requesting camera permission" });
    setResult(null);
    setCameraCaptured(false);
    setCameraActive(true);
    setCameraStarting(true);
    setCameraPreviewReady(false);
      setCameraMessage("Starting camera. Approve camera permission if your browser asks.");
    try {
      const videoElement = videoRef.current;
      if (!videoElement) throw new Error("Camera preview is not ready. Close and reopen the scanner.");
      videoElement.muted = true;
      videoElement.playsInline = true;
      videoElement.autoplay = true;
      const reader = createBarcodeReader();
      const onDecoded = (scanResult: Result | undefined | null, _error: unknown, callbackControls: IScannerControls) => {
        if (scanLockedRef.current) return;
        if (!scanResult) {
          zxingMissCountRef.current += 1;
          if (zxingMissCountRef.current === 1 || zxingMissCountRef.current % 20 === 0) {
            updateScanDiagnostics({
              zxingMisses: zxingMissCountRef.current,
              lastDecoder: "ZXing live",
              lastError: _error instanceof Error ? _error.name || "No barcode in live frame" : "No barcode in live frame"
            });
          }
          return;
        }
        const normalized = normalizeBarcodeValue(scanResult.getText());
        if (!/^\d{6,14}$/.test(normalized)) return;
        scanLockedRef.current = true;
        setCameraCaptured(true);
        updateScanDiagnostics({ lastDecoder: "ZXing live", lastRead: normalized, lastError: "Barcode detected" });
        try {
          callbackControls.stop();
        } catch {
          // ZXing may already be stopping if the modal is closing at the same time.
        }
        scannerControlsRef.current = null;
        handleDecodedBarcode(normalized, "camera");
      };
      const devices = await refreshCameraDevices();
      const preferredLaptopOrRearCamera = selectedCameraId
        ? selectedCameraId
        : devices.find((device) => /back|rear|environment/i.test(device.label))?.deviceId ?? "";
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: preferredLaptopOrRearCamera
            ? {
                deviceId: { exact: preferredLaptopOrRearCamera },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
              }
            : {
                facingMode: { ideal: "environment" },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
              },
          audio: false
        });
      } catch (primaryError) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          setSelectedCameraId("");
        } catch {
          throw primaryError;
        }
      }

      mediaStreamRef.current = stream;
      videoElement.srcObject = stream;
      await videoElement.play();
      updateScanDiagnostics({
        lastDecoder: "Camera",
        lastError: "Camera preview active",
        videoSize: videoElement.videoWidth && videoElement.videoHeight ? `${videoElement.videoWidth}x${videoElement.videoHeight}` : "starting"
      });

      const [videoTrack] = stream.getVideoTracks();
      if (videoTrack) {
        videoTrack
          .applyConstraints({
            advanced: [
              {
                focusMode: "continuous",
                exposureMode: "continuous"
              } as MediaTrackConstraintSet
            ]
          })
          .catch(() => {
            // Many laptop webcams do not expose focus/exposure controls. Scanning still works without them.
          });
      }

      const controls = await reader.decodeFromVideoElement(videoElement, onDecoded);
      if (scanLockedRef.current) {
        try {
          controls.stop();
        } catch {
          // The decode callback may have already stopped controls after a successful scan.
        }
      } else {
        scannerControlsRef.current = controls;
        const tryDecodeFrame = async () => {
          if (scanLockedRef.current || frameDecodeInFlightRef.current || !videoRef.current) return;
          frameDecodeInFlightRef.current = true;
          try {
            const videoElementForDecode = videoRef.current;
            const nextFrameCount = scanDiagnosticsRef.current.frames + 1;
            const videoSize =
              videoElementForDecode.videoWidth && videoElementForDecode.videoHeight
                ? `${videoElementForDecode.videoWidth}x${videoElementForDecode.videoHeight}`
                : "waiting";
            updateScanDiagnostics({
              frames: nextFrameCount,
              lastDecoder: "ZXing frame",
              lastError: "Scanning live frame",
              videoSize
            });
            let decodedValue = decodeCurrentBarcodeFrame(reader, videoElementForDecode);
            if (!decodedValue && nextFrameCount % 3 === 0) {
              updateScanDiagnostics({
                backupAttempts: scanDiagnosticsRef.current.backupAttempts + 1,
                lastDecoder: "Backup 1D reader",
                lastError: "Trying enhanced barcode crop"
              });
              decodedValue = await decodeCurrentBarcodeFrameWithQuagga(videoElementForDecode);
            }
            if (!decodedValue || scanLockedRef.current) return;
            const normalized = normalizeBarcodeValue(decodedValue);
            if (!/^\d{6,14}$/.test(normalized)) {
              updateScanDiagnostics({ lastRead: decodedValue, lastError: "Detected value was not a valid UPC/EAN" });
              return;
            }
            scanLockedRef.current = true;
            setCameraCaptured(true);
            updateScanDiagnostics({ lastRead: normalized, lastError: "Barcode detected" });
            try {
              controls.stop();
            } catch {
              // The continuous scan loop may already be stopping.
            }
            handleDecodedBarcode(normalized, "camera");
          } finally {
            frameDecodeInFlightRef.current = false;
          }
        };
        frameDecodeTimerRef.current = window.setInterval(() => {
          void tryDecodeFrame();
        }, 260);
        window.setTimeout(() => {
          void tryDecodeFrame();
        }, 120);
        setCameraActive(true);
        setCameraStarting(false);
        setCameraPreviewReady(true);
      setCameraMessage("Point camera at barcode. ZXing plus the backup 1D reader are scanning live frames. Keep the bars flat, bright, and filling most of the box.");
        updateScanDiagnostics({
          lastDecoder: "Live scanning",
          lastError: "No barcode detected yet",
          videoSize: videoElement.videoWidth && videoElement.videoHeight ? `${videoElement.videoWidth}x${videoElement.videoHeight}` : "waiting"
        });
        void refreshCameraDevices();
      }
    } catch (error) {
      stopCameraStream();
      setCameraMessage(`Camera Permission Needed: ${cameraErrorMessage(error)} Manual UPC lookup is still available below.`);
    } finally {
      cameraStartLockedRef.current = false;
    }
  }, [cameraAvailable, cameraErrorMessage, handleDecodedBarcode, refreshCameraDevices, resetScanDiagnostics, selectedCameraId, stopCameraStream, updateScanDiagnostics]);

  const decodeBarcodeImage = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setImageDecodeBusy(true);
      setCameraMessage("Reading barcode image...");
      const objectUrl = URL.createObjectURL(file);
      const image = new window.Image();
      try {
        const reader = createBarcodeReader();
        image.src = objectUrl;
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("Could not read that image. Try another photo or type the UPC."));
        });
        const decoded = await reader.decodeFromImageElement(image);
        handleDecodedBarcode(decoded.getText(), "manual");
      } catch (error) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context || !canvas.width || !canvas.height) throw error;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          enhanceBarcodeCanvas(canvas, "contrast");
          const decoded = await quaggaDecodeCanvas(canvas);
          if (decoded) {
            handleDecodedBarcode(decoded, "manual");
          } else {
            setCameraMessage(error instanceof Error ? error.message : "Barcode was not detected in that image. Type the UPC manually.");
          }
        } catch {
          setCameraMessage(error instanceof Error ? error.message : "Barcode was not detected in that image. Type the UPC manually.");
        }
      } finally {
        URL.revokeObjectURL(objectUrl);
        setImageDecodeBusy(false);
      }
    },
    [handleDecodedBarcode]
  );

  useEffect(() => {
    return () => stopCameraStream();
  }, [stopCameraStream]);

  useEffect(() => {
    if (!result) return;
    resultRef.current?.scrollIntoView({ block: "nearest" });
  }, [result]);

  const scanAgain = useCallback(() => {
    setResult(null);
    setCameraCaptured(false);
    window.setTimeout(() => {
      void startCamera();
    }, 0);
  }, [startCamera]);

  const resultPanel = result ? (
    <section ref={resultRef} className={`barcode-result-card ${result.status.toLowerCase().replaceAll("_", "-")}`} aria-live="polite">
      <div className="barcode-result-topline">
        <span className="barcode-result-badge">
          <Check size={14} />
          {upcLookupResultTitle(result)}
        </span>
        <span>Scanned UPC {result.rawCode}</span>
        <span>{upcLookupMatchSource(result)}</span>
      </div>
      <div className="barcode-result-layout">
        <div className="barcode-result-media">
          {result.lookupProduct?.imageUrl ? (
            <Image
              src={result.lookupProduct.imageUrl}
              alt={`${result.lookupProduct.productName} scan result`}
              width={280}
              height={280}
              unoptimized
            />
          ) : (
            <div className="barcode-result-placeholder" aria-hidden="true">
              <PackageSearch size={32} />
            </div>
          )}
        </div>
        <div className="barcode-result-copy">
          <div>
            <h3>{result.lookupProduct?.productName || `UPC ${result.upc}`}</h3>
            <p>{result.lookupProduct ? upcLookupSuccessMessage(result) : upcLookupFailureMessage(result)}</p>
          </div>
          <div className="barcode-result-detail-grid">
            <span>
              <strong>UPC</strong>
              {result.upc}
            </span>
            <span>
              <strong>Source</strong>
              {upcLookupMatchSource(result)}
            </span>
            <span>
              <strong>Category</strong>
              {formatStatus(result.matchedInventoryItem?.category ?? result.lookupProduct?.category ?? "Not set")}
            </span>
            <span>
              <strong>Set</strong>
              {result.matchedInventoryItem?.setName || result.lookupProduct?.setName || "Not set"}
            </span>
            {result.matchedInventoryItem ? (
              <>
                <span>
                  <strong>Owned</strong>
                  {result.matchedInventoryItem.quantityOwned}
                </span>
                <span>
                  <strong>Avg cost</strong>
                  {money(result.matchedInventoryItem.averageCost)}
                </span>
              </>
            ) : null}
            {result.lookupProduct?.retailer ? (
              <span>
                <strong>Retailer</strong>
                {result.lookupProduct.retailer}
              </span>
            ) : null}
            {result.lookupProduct?.confidence !== null && result.lookupProduct?.confidence !== undefined ? (
              <span>
                <strong>Confidence</strong>
                {result.lookupProduct.confidence}%
              </span>
            ) : null}
          </div>
          <div className="barcode-action-row barcode-result-actions">
            <button className="primary-action" type="button" onClick={() => onUseResult(result)}>
              <Check size={15} />
              {upcLookupPrimaryAction(result)}
            </button>
            {result.matchedInventoryItem ? (
              <button className="mini-action" type="button" onClick={() => onViewProduct(result.matchedInventoryItem!)}>
                <Eye size={15} />
                View Product
              </button>
            ) : null}
            <button className="mini-action" type="button" onClick={scanAgain}>
              <PackageSearch size={15} />
              Scan Again
            </button>
            <button className="mini-action" type="button" onClick={onClose}>
              <X size={15} />
              Close
            </button>
          </div>
        </div>
      </div>
      <div className="barcode-result-meta">
        {result.normalizedUpc !== result.rawCode ? <span>Normalized {result.normalizedUpc}</span> : null}
        {result.lookupProduct?.brand ? <span>{result.lookupProduct.brand}</span> : null}
        {!result.externalLookupConfigured && !result.lookupProduct ? <span>External lookup not configured</span> : null}
      </div>
      {dashboard.currentUser.role === "ADMIN" ? <UpcLookupDebugDetails result={result} /> : null}
    </section>
  ) : null;

  return (
    <div className="inventory-modal-backdrop" role="presentation">
      <div className="inventory-modal barcode-scanner-modal" role="dialog" aria-modal="true" aria-label="Scan UPC barcode">
        <div className="edit-card-heading">
          <div>
            <h2>Scan UPC / Barcode</h2>
            <span>Scanning live video frames. No photos or video are saved.</span>
          </div>
          <button className="icon-button" type="button" aria-label="Close barcode scanner" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {resultPanel}
        {!result ? (
          <section className="barcode-scanner-grid">
          <div className="barcode-camera-panel">
            <div
              className={[
                "barcode-video-frame",
                cameraActive ? "active" : "",
                cameraStarting ? "starting" : "",
                cameraPreviewReady ? "ready" : "",
                cameraCaptured ? "captured" : ""
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                onLoadedMetadata={() => {
                  if (cameraActive) {
                    setCameraStarting(false);
                    setCameraPreviewReady(true);
                  }
                }}
              />
              {!cameraActive ? (
                <span className="barcode-camera-placeholder">Camera preview will appear here</span>
              ) : !cameraPreviewReady ? (
                <span className="barcode-camera-placeholder">Starting camera...</span>
              ) : (
                <span className="barcode-camera-guide">{cameraCaptured ? "Barcode captured. Processing..." : "Align barcode inside the frame"}</span>
              )}
            </div>
            <p>{cameraMessage}</p>
            <div className="barcode-live-log" aria-live="polite">
              <span>
                <strong>Frames</strong>
                {scanDiagnostics.frames}
              </span>
              <span>
                <strong>ZXing misses</strong>
                {scanDiagnostics.zxingMisses}
              </span>
              <span>
                <strong>Backup tries</strong>
                {scanDiagnostics.backupAttempts}
              </span>
              <span>
                <strong>Video</strong>
                {scanDiagnostics.videoSize || "waiting"}
              </span>
              <span className="wide">
                <strong>Decoder</strong>
                {scanDiagnostics.lastDecoder}
              </span>
              <span className="wide">
                <strong>Status</strong>
                {scanDiagnostics.lastError}
              </span>
              {scanDiagnostics.lastRead ? (
                <span className="wide">
                  <strong>Last read</strong>
                  {scanDiagnostics.lastRead}
                </span>
              ) : null}
            </div>
            <label className="barcode-camera-select">
              Camera
              <select value={selectedCameraId} onChange={(event) => setSelectedCameraId(event.currentTarget.value)}>
                <option value="">Default webcam</option>
                {cameraDevices.map((device, index) => (
                  <option key={device.deviceId || `camera-${index}`} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="barcode-action-row">
              <button
                className="primary-action barcode-start-button"
                disabled={lookupBusy || cameraStarting}
                type="button"
                onClick={startCamera}
              >
                <PackageSearch size={15} />
                {cameraStarting ? "Starting Camera" : cameraActive ? "Restart Camera" : "Start Camera"}
              </button>
              <button
                className="mini-action"
                disabled={!cameraActive && !cameraStarting}
                type="button"
                onClick={() => {
                  stopCameraStream("Camera stopped. Tap Start Camera to try again.");
                }}
              >
                Stop
              </button>
            </div>
            {!cameraAvailable ? <small>Camera access is not available here. Manual UPC lookup still works.</small> : null}
            <small>Hold barcode flat and fill the frame. ZXing decodes the live camera feed by scanning live video frames; no photos or video are saved.</small>
          </div>
          <form
            className="barcode-manual-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void lookupUpc(manualUpc, "manual");
            }}
          >
            <TextInput
              name="manualUpc"
              label="Manual UPC / EAN"
              inputMode="numeric"
              value={manualUpc}
              onChange={(event) => setManualUpc(normalizeBarcodeValue(event.currentTarget.value))}
              placeholder="Scan or type barcode"
            />
            <button className="primary-action" disabled={lookupBusy} type="submit">
              <PackageSearch size={15} />
              {lookupBusy ? "Looking up" : "Lookup UPC"}
            </button>
            <label className="barcode-image-upload">
              Upload barcode image
              <input
                accept="image/*"
                disabled={imageDecodeBusy || lookupBusy}
                type="file"
                onChange={(event) => {
                  void decodeBarcodeImage(event.currentTarget.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
            </label>
          </form>
          </section>
        ) : null}
        <section className="barcode-history-panel">
          <h3>Scanned UPC history</h3>
          {history.length ? (
            <div>
              {history.slice(0, 8).map((scan) => (
                <button
                  className="barcode-history-row"
                  key={scan.id}
                  type="button"
                  onClick={() => {
                    void lookupUpc(scan.rawCode || scan.normalizedUpc || scan.upc, scan.source === "camera" ? "camera" : "manual");
                  }}
                >
                  <strong>{scan.upc}</strong>
                  <span>
                    {scan.productName || (scan.status === "NEW_UPC" ? "New UPC" : formatStatus(scan.status))}
                    <small>{formatStatus(scan.resultType || scan.status)}</small>
                  </span>
                  <small>{relativeTime(scan.createdAt)}</small>
                  <em>{scan.productName ? "Open" : "Create"}</em>
                </button>
              ))}
            </div>
          ) : (
            <p>No barcode scans yet.</p>
          )}
        </section>
        <small className="manual-safety-note">Privacy: camera access starts only after tapping Start Camera. No image or video frame is saved; only the decoded UPC is stored.</small>
      </div>
    </div>
  );
}

function InventoryQuickActions({
  dashboard,
  selectedItem,
  onAddProduct,
  onAddStock,
  onScan,
  onRecordSale,
  onViewSales
}: {
  dashboard: DashboardDTO;
  selectedItem: InventoryItemDTO | null;
  onAddProduct: () => void;
  onAddStock: () => void;
  onScan: () => void;
  onRecordSale: () => void;
  onViewSales: () => void;
}) {
  return (
    <section className="inventory-quick-actions-strip" aria-label="Inventory quick actions">
      <div className="inventory-quick-actions-heading">
        <div>
          <h2>Quick Actions</h2>
          <span>Add products, stock, and sales without leaving inventory.</span>
        </div>
      </div>
      <div className="inventory-quick-actions-list">
        <button className="inventory-quick-button" type="button" onClick={onScan}>
          <PackageSearch size={16} />
          <span>
            Scan UPC
            <small>Camera or typed barcode</small>
          </span>
          <ChevronRight size={15} />
        </button>
        <button className="inventory-quick-button" type="button" onClick={onAddProduct}>
          <Plus size={16} />
          <span>
            Manual Product
            <small>Create without UPC</small>
          </span>
          <ChevronRight size={15} />
        </button>
        <button className="inventory-quick-button" type="button" onClick={onAddStock} disabled={!selectedItem}>
          <Plus size={16} />
          <span>
            Add Stock
            <small>{selectedItem ? selectedItem.itemName : "Select a product first"}</small>
          </span>
          <ChevronRight size={15} />
        </button>
        <button className="inventory-quick-button" type="button" disabled={!selectedItem} onClick={onRecordSale}>
          <CircleDollarSign size={16} />
          <span>
            Record Sale
            <small>{selectedItem ? "Selected stock" : "Select a product first"}</small>
          </span>
          <ChevronRight size={15} />
        </button>
        <button className="inventory-quick-button" type="button" onClick={onViewSales}>
          <History size={16} />
          <span>
            Sold Items
            <small>{dashboard.inventorySummary.itemsSold} items sold</small>
          </span>
          <ChevronRight size={15} />
        </button>
      </div>
    </section>
  );
}

function PurchaseFlow({
  items,
  defaultItemId,
  prefill,
  onScanBarcode,
  busy,
  busyLabel,
  submit
}: {
  items: InventoryItemDTO[];
  defaultItemId?: string;
  prefill?: InventoryPurchasePrefill | null;
  onScanBarcode: () => void;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
}) {
  const [selectedExistingId, setSelectedExistingId] = useState(defaultItemId ?? "");
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [extraCost, setExtraCost] = useState(0);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(
    defaultItemId
      ? "Product already exists in your catalog. Add stock to the existing item."
      : prefill?.upc
      ? prefill.itemName
        ? "Product details found and filled from UPC."
        : "No product found for this UPC yet. Keep the UPC and enter product details manually."
      : null
  );
  const totalCost = quantity * price + extraCost;
  const selectedExisting = items.find((item) => item.id === selectedExistingId) ?? null;
  const flowKey = selectedExisting?.id ?? prefill?.upc ?? "new";
  const initialDraft = useMemo(
    () => ({
      itemName: selectedExisting?.itemName ?? prefill?.itemName ?? "",
      brand: selectedExisting?.brand ?? prefill?.brand ?? "",
      category: selectedExisting?.category ?? prefill?.category ?? "sealed_packs",
      setName: selectedExisting?.setName ?? prefill?.setName ?? "",
      description: selectedExisting?.description ?? prefill?.description ?? "",
      manufacturer: selectedExisting?.manufacturer ?? prefill?.manufacturer ?? "",
      model: selectedExisting?.model ?? prefill?.model ?? "",
      msrp: selectedExisting?.msrp === null || selectedExisting?.msrp === undefined ? prefill?.msrp?.toString() ?? "" : String(selectedExisting.msrp),
      imageUrl: selectedExisting?.imageUrl ?? prefill?.imageUrl ?? "",
      retailer: selectedExisting?.retailer ?? prefill?.retailer ?? "",
      exactProductUrl: selectedExisting?.exactProductUrl ?? prefill?.exactProductUrl ?? "",
      upc: selectedExisting?.upc ?? prefill?.upc ?? "",
      sku: selectedExisting?.sku ?? prefill?.sku ?? "",
      source: prefill?.source ?? selectedExisting?.source ?? ""
    }),
    [prefill, selectedExisting]
  );
  const [draft, setDraft] = useState(initialDraft);
  const costPrefillKeyRef = useRef("");

  useEffect(() => {
    const fallbackCost =
      selectedExisting && selectedExisting.cost > 0
        ? selectedExisting.cost
        : selectedExisting?.msrp && selectedExisting.msrp > 0
          ? selectedExisting.msrp
          : prefill?.msrp && prefill.msrp > 0
          ? prefill.msrp
          : null;
    const key = `${selectedExisting?.id ?? "new"}:${prefill?.upc ?? ""}:${fallbackCost ?? ""}`;
    if (fallbackCost && price <= 0 && costPrefillKeyRef.current !== key) {
      costPrefillKeyRef.current = key;
      setPrice(fallbackCost);
    }
  }, [prefill?.msrp, prefill?.upc, price, selectedExisting]);

  function updateDraft(name: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [name]: value }));
  }

  function draftFromItem(item: InventoryItemDTO | null) {
    if (!item) return initialDraft;
    return {
      itemName: item.itemName,
      brand: item.brand ?? "",
      category: item.category || "sealed_packs",
      setName: item.setName ?? "",
      description: item.description ?? "",
      manufacturer: item.manufacturer ?? "",
      model: item.model ?? "",
      msrp: item.msrp === null || item.msrp === undefined ? "" : String(item.msrp),
      imageUrl: item.imageUrl ?? "",
      retailer: item.retailer ?? "",
      exactProductUrl: item.exactProductUrl ?? "",
      upc: item.upc ?? "",
      sku: item.sku ?? "",
      source: item.source ?? ""
    };
  }

  function applyLookupToDraft(lookup: UpcLookupResultDTO) {
    const product = lookup.lookupProduct;
    if (product?.msrp && product.msrp > 0 && price <= 0) setPrice(product.msrp);
    setDraft((current) => ({
      ...current,
      upc: lookup.upc,
      itemName: current.itemName || product?.productName || "",
      brand: current.brand || product?.brand || "",
      category: current.category && current.category !== "sealed_packs" ? current.category : inventoryCategoryFromLookup(product?.category),
      setName: current.setName || product?.setName || "",
      description: current.description || product?.description || "",
      manufacturer: current.manufacturer || product?.manufacturer || "",
      model: current.model || product?.model || "",
      msrp: current.msrp || (product?.msrp === null || product?.msrp === undefined ? "" : String(product.msrp)),
      imageUrl: current.imageUrl || product?.imageUrl || "",
      retailer: current.retailer || product?.retailer || "",
      exactProductUrl: current.exactProductUrl || product?.exactProductUrl || "",
      sku: current.sku || product?.sku || "",
      source: current.source || product?.retailer || ""
    }));
  }

  async function lookupDraftUpc() {
    const normalized = normalizeBarcodeValue(draft.upc);
    if (!/^\d{6,14}$/.test(normalized)) {
      setLookupMessage("Enter a valid 6 to 14 digit UPC/EAN.");
      return;
    }
    setLookupBusy(true);
    setLookupMessage(`Looking up UPC ${normalized}...`);
    try {
      const lookup = await requestJson<UpcLookupResultDTO>("/api/radar/inventory/upc/lookup", {
        method: "POST",
        body: JSON.stringify({ upc: normalized, source: "manual" })
      });
      if (lookup.matchedInventoryItem) {
        setSelectedExistingId(lookup.matchedInventoryItem.id);
        setLookupMessage("Product already exists in your catalog. Add stock to the existing item.");
      } else if (lookup.lookupProduct) {
        applyLookupToDraft(lookup);
        setLookupMessage(`${upcLookupSuccessMessage(lookup)} Existing typed fields were kept.`);
      } else {
        updateDraft("upc", lookup.upc);
        setLookupMessage(upcLookupFailureMessage(lookup));
      }
    } catch (error) {
      setLookupMessage(error instanceof Error ? error.message : "UPC lookup failed. You can still fill the product manually.");
    } finally {
      setLookupBusy(false);
    }
  }

  return (
    <section className="inventory-flow-panel">
      <form
        key={flowKey}
        className="purchase-flow"
        onSubmit={(event) =>
          submit(
            event,
            "Adding inventory item",
            (form) => requestJson("/api/radar/inventory", { method: "POST", body: JSON.stringify(formJson(form)) }),
            { reset: true, success: "Purchase added" }
          )
        }
      >
        <input name="itemType" type="hidden" value="product" />
        <input name="totalCost" type="hidden" value={totalCost.toFixed(2)} />
        {prefill?.productId && !selectedExisting ? <input name="productId" type="hidden" value={prefill.productId} /> : null}
        <article className="flow-step">
          <div className="flow-step-title">
            <span>Step 1</span>
            <button className="mini-action" type="button" onClick={onScanBarcode}>
              <PackageSearch size={13} />
              Scan UPC
            </button>
          </div>
          <h3>What did you buy?</h3>
          {prefill?.upc ? (
            <p className="scan-prefill-note">UPC {prefill.upc} is prefilled. Confirm the product details before saving.</p>
          ) : null}
          <div className="upc-lookup-strip">
            <TextInput
              name="upc"
              label="UPC / EAN"
              inputMode="numeric"
              value={draft.upc}
              onChange={(event) => updateDraft("upc", normalizeBarcodeValue(event.currentTarget.value))}
              placeholder="Scan or type barcode"
              readOnly={Boolean(selectedExisting)}
            />
            <button className="mini-action" disabled={lookupBusy} type="button" onClick={lookupDraftUpc}>
              <PackageSearch size={14} />
              {lookupBusy ? "Looking up" : "Lookup UPC"}
            </button>
            <button className="mini-action" type="button" onClick={onScanBarcode}>
              <PackageSearch size={14} />
              Scan UPC
            </button>
          </div>
          {lookupMessage ? <p className="scan-prefill-note">{lookupMessage}</p> : null}
          {selectedExisting ? (
            <div className="selected-stock-product">
              <input name="existingInventoryItemId" type="hidden" value={selectedExisting.id} />
              <input name="itemName" type="hidden" value={draft.itemName} />
              <input name="category" type="hidden" value={draft.category || "sealed_packs"} />
              <input name="brand" type="hidden" value={draft.brand} />
              <input name="setName" type="hidden" value={draft.setName} />
              <InventoryImage item={selectedExisting} />
              <div>
                <span className="barcode-result-badge">
                  <Check size={14} />
                  Existing product selected
                </span>
                <h4>{selectedExisting.itemName}</h4>
                <p>UPC {selectedExisting.upc || draft.upc || "Missing"} - {formatStatus(selectedExisting.category)} - {selectedExisting.setName || selectedExisting.retailer || "Set not saved"}</p>
              </div>
              <TextInput
                name="quantity"
                label="Quantity to add"
                type="number"
                min="1"
                value={String(quantity)}
                onChange={(event) => setQuantity(Math.max(1, Number(event.currentTarget.value) || 1))}
                required
              />
            </div>
          ) : (
            <div className="form-grid compact">
              <label>
                Existing product
                <select
                  name="existingInventoryItemId"
                  value={selectedExistingId}
                  onChange={(event) => {
                    const nextId = event.currentTarget.value;
                    const nextItem = items.find((item) => item.id === nextId) ?? null;
                    setSelectedExistingId(nextId);
                    setDraft(draftFromItem(nextItem));
                    setLookupMessage(nextItem ? "Existing product selected. This will add stock to that catalog item." : null);
                  }}
                >
                  <option value="">Create new product</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.itemName}
                    </option>
                  ))}
                </select>
              </label>
              <TextInput
                name="itemName"
                label="Product/card name"
                value={draft.itemName}
                onChange={(event) => updateDraft("itemName", event.currentTarget.value)}
                required
              />
              <TextInput name="brand" label="Brand" value={draft.brand} onChange={(event) => updateDraft("brand", event.currentTarget.value)} />
              <SelectInput
                name="category"
                label="Category"
                value={draft.category || "sealed_packs"}
                onChange={(event) => updateDraft("category", event.currentTarget.value)}
                options={inventoryCategories.map(optionFromString)}
              />
              <TextInput name="setName" label="Set" value={draft.setName} onChange={(event) => updateDraft("setName", event.currentTarget.value)} />
              <TextInput
                name="quantity"
                label="Quantity"
                type="number"
                min="1"
                value={String(quantity)}
                onChange={(event) => setQuantity(Math.max(1, Number(event.currentTarget.value) || 1))}
                required
              />
            </div>
          )}
        </article>
        <article className="flow-step">
          <span>Step 2</span>
          <h3>What did it cost?</h3>
          <div className="form-grid compact">
            <TextInput
              name="cost"
              label="Price paid per item"
              type="number"
              min="0"
              step="0.01"
              value={String(price)}
              onChange={(event) => setPrice(Math.max(0, Number(event.currentTarget.value) || 0))}
              required
            />
            <TextInput
              name="purchaseExtraCost"
              label="Tax/shipping"
              type="number"
              min="0"
              step="0.01"
              value={String(extraCost)}
              onChange={(event) => setExtraCost(Math.max(0, Number(event.currentTarget.value) || 0))}
            />
            <TextInput
              name="source"
              label="Store/source"
              placeholder="Target Hialeah, eBay, friend"
              value={draft.source}
              onChange={(event) => updateDraft("source", event.currentTarget.value)}
              required
            />
            <TextInput name="sourceStore" label="Source store" placeholder="Target Hialeah, eBay seller, Whatnot stream" defaultValue={selectedExisting?.sourceStore ?? ""} />
            <TextInput name="purchasedAt" label="Purchase date" type="date" defaultValue={todayDateInput()} required />
          </div>
          <div className="total-preview">
            <span>Total cost</span>
            <strong>{money(totalCost)}</strong>
          </div>
        </article>
        <article className="flow-step">
          <span>Step 3</span>
          <h3>Add proof/image</h3>
          <ProductImagePreview imageUrl={draft.imageUrl} itemName={draft.itemName || "Product"} />
          <div className="form-grid compact">
            <ImageUploadInput value={draft.imageUrl} onValueChange={(value) => updateDraft("imageUrl", value)} />
            <ImageUploadInput
              fieldName="receiptImageUrl"
              label="Receipt image"
              placeholder="Paste receipt image URL or upload photo"
              defaultValue={selectedExisting?.receiptImageUrl ?? ""}
            />
            <TextInput name="receiptNumber" label="Receipt number" defaultValue={selectedExisting?.receiptNumber ?? ""} />
            <TextInput name="orderNumber" label="Order number" defaultValue={selectedExisting?.orderNumber ?? ""} />
            <TextInput name="transactionId" label="Transaction ID" defaultValue={selectedExisting?.transactionId ?? ""} />
            <TextInput name="paymentMethod" label="Payment method" placeholder="Visa, cash, PayPal" defaultValue={selectedExisting?.paymentMethod ?? ""} />
          </div>
        </article>
        <article className="flow-step">
          <span>Step 4</span>
          <h3>Plan</h3>
          <div className="form-grid compact">
            <SelectInput name="expectedPlan" label="Plan" options={inventoryPlanOptions} />
            <TextInput
              name="targetSellPrice"
              label="Target sell price"
              type="number"
              min="0"
              step="0.01"
              defaultValue={selectedExisting?.targetSellPrice ?? ""}
            />
          </div>
        </article>
        <details className="inventory-advanced-details">
          <summary>Advanced details</summary>
          <div className="form-grid compact">
            <TextInput name="retailer" label="Retailer" value={draft.retailer} onChange={(event) => updateDraft("retailer", event.currentTarget.value)} />
            <TextInput
              name="exactProductUrl"
              label="Exact product URL"
              type="url"
              value={draft.exactProductUrl}
              onChange={(event) => updateDraft("exactProductUrl", event.currentTarget.value)}
            />
            <TextInput name="sku" label="SKU / TCIN" value={draft.sku} onChange={(event) => updateDraft("sku", event.currentTarget.value)} />
            <TextInput name="dpci" label="DPCI" defaultValue={selectedExisting?.dpci ?? ""} />
            <TextInput name="asin" label="ASIN" defaultValue={selectedExisting?.asin ?? ""} />
            <TextInput name="manufacturer" label="Manufacturer" value={draft.manufacturer} onChange={(event) => updateDraft("manufacturer", event.currentTarget.value)} />
            <TextInput name="model" label="Model" value={draft.model} onChange={(event) => updateDraft("model", event.currentTarget.value)} />
            <TextInput name="msrp" label="MSRP / retail price" type="number" min="0" step="0.01" value={draft.msrp} onChange={(event) => updateDraft("msrp", event.currentTarget.value)} />
            <TextInput name="condition" label="Condition" defaultValue={selectedExisting?.condition ?? ""} placeholder="Mint box, clean corners, raw NM" />
            <SelectInput
              name="itemStatus"
              label="Status"
              defaultValue={selectedExisting?.itemStatus ?? "sealed"}
              options={inventoryStatuses.map(optionFromString)}
            />
            <TextInput
              name="minimumAcceptablePrice"
              label="Minimum acceptable price"
              type="number"
              min="0"
              step="0.01"
              defaultValue={selectedExisting?.minimumAcceptablePrice ?? ""}
            />
            <TextInput
              name="currentMarketEstimate"
              label="Manual market estimate"
              type="number"
              min="0"
              step="0.01"
              defaultValue={selectedExisting?.currentMarketEstimate ?? ""}
            />
            <SelectInput
              name="listingStatus"
              label="Listing status"
              defaultValue={selectedExisting?.listingStatus ?? "not_listed"}
              options={listingStatuses.map(optionFromString)}
            />
            <TextInput name="listingPlatform" label="Listing platform" defaultValue={selectedExisting?.listingPlatform ?? ""} placeholder="eBay, Facebook, TCGPlayer" />
            <TextareaInput
              name="description"
              label="Product description"
              value={draft.description}
              onChange={(event) => updateDraft("description", event.currentTarget.value)}
              wide
            />
            <TextareaInput name="notes" label="Notes" wide />
          </div>
        </details>
        <button className="primary-action inventory-save-action" disabled={busy} type="submit">
          <Save size={16} />
          {busyLabel === "Adding inventory item" ? "Saving" : "Save Purchase"}
        </button>
      </form>
    </section>
  );
}

function InventoryFilters({
  filters,
  itemCount,
  updateFilter
}: {
  filters: { search: string; category: string; source: string; listingStatus: string; sort: string };
  itemCount: number;
  updateFilter: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
}) {
  return (
    <section className="form-panel inventory-filter-panel">
      <div className="edit-card-heading">
        <div>
          <h2>Product Catalog</h2>
          <span>{itemCount} products shown. Add stock, sell, or view details from each row.</span>
        </div>
        <a className="mini-action" href="/api/radar/inventory?format=product-catalog-csv" target="_blank" rel="noreferrer">
          <Download size={14} />
          Export CSV
        </a>
      </div>
      <div className="inventory-filter-row">
        <TextInput name="search" label="Search" value={filters.search} onChange={updateFilter} />
        <SelectInput name="category" label="Category" value={filters.category} onChange={updateFilter} options={[{ value: "ALL", label: "All Categories" }, ...inventoryCategories.map(optionFromString)]} />
        <SelectInput name="listingStatus" label="Status" value={filters.listingStatus} onChange={updateFilter} options={[{ value: "ALL", label: "All Statuses" }, ...listingStatuses.map(optionFromString)]} />
        <TextInput name="source" label="Source/Retailer" value={filters.source} onChange={updateFilter} />
        <SelectInput
          name="sort"
          label="Sort"
          value={filters.sort}
          onChange={updateFilter}
          options={[
            { value: "date", label: "Recently Added" },
            { value: "quantity", label: "Quantity" },
            { value: "sales", label: "Sold" },
            { value: "name", label: "Name" }
          ]}
        />
      </div>
    </section>
  );
}

function InventoryList({
  items,
  selectedId,
  onSelect,
  onAddStock,
  onRecordSale,
  onViewDetails,
  onEditListing
}: {
  items: InventoryItemDTO[];
  selectedId: string;
  onSelect: (item: InventoryItemDTO) => void;
  onAddStock: (item: InventoryItemDTO) => void;
  onRecordSale: (item: InventoryItemDTO) => void;
  onViewDetails: (item: InventoryItemDTO) => void;
  onEditListing: (item: InventoryItemDTO) => void;
}) {
  if (!items.length) return <EmptyState icon={Trophy} title="No inventory items" detail="Add sealed products or cards as you buy them." />;
  function closeActionDetails(event: { currentTarget: HTMLElement }) {
    event.currentTarget.closest("details")?.removeAttribute("open");
  }
  return (
    <div className="catalog-table">
      <div className="catalog-row catalog-head" aria-hidden="true">
        <span>Product</span>
        <span>UPC / SKU</span>
        <span>Quantity</span>
        <span>Avg Cost</span>
        <span>Total Cost</span>
        <span>Sell Price</span>
        <span>Sold</span>
        <span>Profit / Loss</span>
        <span>Status</span>
        <span>Actions</span>
      </div>
      {items.map((item) => (
        <article className={selectedId === item.id ? "catalog-row selected" : "catalog-row"} key={item.id}>
          <button className="catalog-product" type="button" onClick={() => onSelect(item)}>
            <InventoryImage item={item} />
            <span className="catalog-product-copy text-safe">
              <strong className="catalog-product-title text-safe">{item.itemName}</strong>
              <small className="text-safe">{formatStatus(item.category)} - {item.setName || item.retailer || "Source unknown"}</small>
            </span>
          </button>
          <span className="catalog-cell inventory-id-cell identifier-text" data-label="UPC / SKU">
            {item.upc || item.sku || item.dpci || item.asin || "Missing ID"}
          </span>
          <span className="catalog-cell strong" data-label="Quantity">{item.quantityOwned}</span>
          <span className="catalog-cell" data-label="Avg Cost">{money(item.averageCost)}</span>
          <span className="catalog-cell" data-label="Total Cost">{money(item.averageCost * item.quantityOwned)}</span>
          <span className={item.targetSellPrice !== null ? "catalog-cell strong sell-price-cell" : "catalog-cell"} data-label="Sell Price">
            {item.targetSellPrice !== null ? money(item.targetSellPrice) : "Not set"}
            {item.minimumAcceptablePrice !== null ? <small>Min {money(item.minimumAcceptablePrice)}</small> : null}
          </span>
          <span className="catalog-cell" data-label="Sold">{item.quantitySold}</span>
          <span
            className={`catalog-cell strong ${
              (item.realizedProfitLoss ?? 0) >= 0 ? "profit-good" : "profit-bad"
            }`}
            data-label="Profit / Loss"
          >
            {item.sales.length ? money(item.realizedProfitLoss) : "—"}
          </span>
          <span className="catalog-cell" data-label="Status">
            <span className={`chip compact-chip ${inventoryStockStatusTone(item)}`}>{inventoryStockStatusLabel(item)}</span>
            <span className={`chip compact-chip ${storeListingTone(item)}`}>{storeListingLabel(item)}</span>
          </span>
          <div className="catalog-actions">
            <details className="catalog-action-menu-wrap">
              <summary className="catalog-action-trigger">
                Actions
                <MoreHorizontal size={15} />
              </summary>
              <div className="catalog-action-menu" role="menu">
                <button role="menuitem" type="button" onClick={(event) => { closeActionDetails(event); onAddStock(item); }}>
                  <Plus size={14} />
                  Add Stock
                </button>
                <button role="menuitem" type="button" onClick={(event) => { closeActionDetails(event); onRecordSale(item); }}>
                  <CircleDollarSign size={14} />
                  Record Sale
                </button>
                <button role="menuitem" type="button" onClick={(event) => { closeActionDetails(event); onViewDetails(item); }}>
                  <FileText size={14} />
                  View Details
                </button>
                <button role="menuitem" type="button" onClick={(event) => { closeActionDetails(event); onEditListing(item); }}>
                  <Store size={14} />
                  Edit Listing
                </button>
                {item.publishToStore && item.publicSlug ? (
                  <a role="menuitem" href={`/shop/product/${item.publicSlug}`} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} />
                    View Public Page
                  </a>
                ) : null}
              </div>
            </details>
          </div>
        </article>
      ))}
    </div>
  );
}

function inventoryStockStatusLabel(item: InventoryItemDTO) {
  if (item.quantityOwned <= 0) return "Sold Out";
  if (item.quantityOwned <= 2) return "Low Stock";
  return "In Stock";
}

function inventoryStockStatusTone(item: InventoryItemDTO) {
  if (item.quantityOwned <= 0) return "bad";
  if (item.quantityOwned <= 2) return "watch";
  return "good";
}

function storeListingLabel(item: InventoryItemDTO) {
  if (!item.publishToStore) return "Not Published";
  if (item.storeStatus === "active" && item.quantityOwned <= 0) return "Sold Out";
  return item.storeStatus.replace("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function storeListingTone(item: InventoryItemDTO) {
  if (!item.publishToStore || item.storeStatus === "hidden") return "neutral";
  if (item.storeStatus === "active" && item.quantityOwned > 0) return "good";
  if (item.storeStatus === "draft") return "watch";
  return "bad";
}

function InventoryDetailsModal({
  item,
  onAddStock,
  onRecordSale,
  onEditProduct,
  onEditListing,
  onEditStockLot,
  onDeleteStockLot,
  onClose
}: {
  item: InventoryItemDTO;
  onAddStock: (item: InventoryItemDTO) => void;
  onRecordSale: (item: InventoryItemDTO) => void;
  onEditProduct: (item: InventoryItemDTO) => void;
  onEditListing: (item: InventoryItemDTO) => void;
  onEditStockLot: (item: InventoryItemDTO, lot: InventoryStockLotDTO) => void;
  onDeleteStockLot: (item: InventoryItemDTO, lot: InventoryStockLotDTO) => void;
  onClose: () => void;
}) {
  return (
    <div className="inventory-modal-backdrop" role="presentation">
      <div className="inventory-details-modal" role="dialog" aria-modal="true" aria-label={`${item.itemName} inventory details`}>
        <header className="inventory-details-header">
          <InventoryImage item={item} />
          <div>
            <h2>{item.itemName}</h2>
            <p>{formatStatus(item.category)} - {item.setName || item.retailer || "Set and retailer not saved"}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Close inventory details" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <section className="inventory-details-actions">
          <button className="mini-action" type="button" onClick={() => onAddStock(item)}>
            <Plus size={14} />
            Add Stock
          </button>
          <button className="mini-action" type="button" onClick={() => onRecordSale(item)}>
            <CircleDollarSign size={14} />
            Record Sale
          </button>
          <button className="mini-action" type="button" onClick={() => onEditProduct(item)} title="Edit product details.">
            <Settings size={14} />
            Edit Product
          </button>
          <button className="mini-action" type="button" onClick={() => onEditListing(item)} title="Edit public storefront listing.">
            <ShoppingBag size={14} />
            Edit Listing
          </button>
          {item.publishToStore && item.publicSlug ? (
            <a className="mini-action" href={`/shop/product/${item.publicSlug}`} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              Public Page
            </a>
          ) : null}
          {item.exactProductUrl ? (
            <a className="mini-action" href={item.exactProductUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              Product Page
            </a>
          ) : null}
        </section>

        <div className="inventory-details-grid">
          <section className="inventory-detail-section">
            <h3>Overview</h3>
            <div className="detail-stat-grid">
              <DetailStat label="Owned" value={String(item.quantityOwned)} />
              <DetailStat label="Sold" value={String(item.quantitySold)} />
              <DetailStat label="Average Cost" value={money(item.averageCost)} />
              <DetailStat label="Total Cost Basis" value={money(item.averageCost * item.quantityOwned)} />
              <DetailStat label="Sales" value={money(item.totalSalesGross)} />
              <DetailStat label="Profit / Loss" value={item.sales.length ? money(item.realizedProfitLoss) : "No sales yet"} tone={(item.realizedProfitLoss ?? 0) >= 0 ? "good" : "bad"} />
            </div>
            <div className="detail-line-list">
              <span>Status: <strong>{inventoryStockStatusLabel(item)}</strong></span>
              <span>Linked product: {item.linkedProductName ? `${item.linkedProductName} (${item.linkedProductRetailer || "retailer unknown"})` : "Not attached"}</span>
              <span>Brand {item.brand || "Missing"} - Model {item.model || "Missing"} - MSRP {money(item.msrp)}</span>
              {item.description ? <span>{item.description}</span> : null}
              <span>UPC {item.upc || "Missing"} - SKU {item.sku || "Missing"} - DPCI {item.dpci || "Missing"} - ASIN {item.asin || "Missing"}</span>
            </div>
          </section>

          <section className="inventory-detail-section">
            <h3>Stock Lots</h3>
            <CompactLotsList item={item} onEditLot={onEditStockLot} onDeleteLot={onDeleteStockLot} />
          </section>

          <section className="inventory-detail-section">
            <h3>Sales History</h3>
            <CompactSalesList item={item} />
          </section>

          <section className="inventory-detail-section">
            <h3>Attachments / Receipts</h3>
            <div className="detail-line-list">
              <span>Receipt: {item.receiptNumber || "Not saved"}</span>
              <span>Order: {item.orderNumber || "Not saved"}</span>
              <span>Transaction: {item.transactionId || "Not saved"}</span>
              <span>Payment: {item.paymentMethod || "Not saved"}</span>
              <span>Source store: {item.sourceStore || item.source || "Not saved"}</span>
              {item.receiptImageUrl ? (
                <a href={item.receiptImageUrl} target="_blank" rel="noreferrer">Open receipt image</a>
              ) : (
                <span>Receipt image missing</span>
              )}
            </div>
          </section>

          <section className="inventory-detail-section">
            <h3>Notes</h3>
            <div className="detail-line-list">
              <span>Plan: {item.expectedPlan || "Not saved"}</span>
              <span>Condition: {item.condition || "Not saved"}</span>
              <span>Target sell: {money(item.targetSellPrice)} - minimum: {money(item.minimumAcceptablePrice)}</span>
              <span>{item.notes || "No notes saved."}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function InventoryEditStockLotModal({
  item,
  lot,
  busy,
  busyLabel,
  submit,
  onClose
}: {
  item: InventoryItemDTO;
  lot: InventoryStockLotDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  onClose: () => void;
}) {
  const saveLabel = `Updating stock lot ${lot.id}`;
  const soldFromLot = Math.max(0, lot.quantity - lot.remainingQuantity);

  return (
    <div className="inventory-modal-backdrop" role="presentation">
      <div className="inventory-modal inventory-edit-modal stock-lot-edit-modal" role="dialog" aria-modal="true" aria-label={`Edit stock for ${item.itemName}`}>
        <div className="edit-card-heading">
          <div>
            <h2>Edit Stock</h2>
            <span>Fix a purchase lot quantity, cost, source, or receipt without changing product details.</span>
          </div>
          <button className="icon-button" type="button" aria-label="Close edit stock" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <section className="inventory-edit-preview">
          <InventoryImage item={item} />
          <div>
            <strong>{item.itemName}</strong>
            <span>
              Lot from {lot.sourceStore || lot.source} - {lot.remainingQuantity} remaining - {soldFromLot} sold
            </span>
          </div>
        </section>

        <form
          className="inventory-edit-form"
          onSubmit={(event) =>
            submit(
              event,
              saveLabel,
              (form) =>
                requestJson(`/api/radar/inventory/${item.id}/stock-lots/${lot.id}`, {
                  method: "PATCH",
                  body: JSON.stringify(formJson(form))
                }),
              { reset: false, success: "Stock lot updated" }
            )
          }
        >
          <section className="flow-step">
            <span>Stock lot</span>
            <h3>Quantity and cost</h3>
            <p className="form-helper">
              To remove a mistaken unsold lot completely, use Remove Stock Lot from Product Details. If any units were sold,
              quantity cannot go below the sold count.
            </p>
            <div className="form-grid compact">
              <TextInput name="quantity" label="Quantity purchased" type="number" min={String(Math.max(1, soldFromLot))} max="1000" defaultValue={lot.quantity} required />
              <TextInput name="costPerUnit" label="Cost per unit" type="number" min="0" step="0.01" defaultValue={lot.costPerUnit} required />
              <TextInput name="purchaseExtraCost" label="Tax / shipping" type="number" min="0" step="0.01" defaultValue={lot.purchaseExtraCost ?? ""} />
              <TextInput name="totalCost" label="Total cost override" type="number" min="0" step="0.01" defaultValue={lot.totalCost} />
              <TextInput name="source" label="Source / store" defaultValue={lot.source} required />
              <TextInput name="purchasedAt" label="Purchase date" type="date" defaultValue={toDateInput(lot.purchasedAt)} required />
            </div>
          </section>

          <section className="flow-step">
            <span>Proof</span>
            <h3>Receipt and notes</h3>
            <div className="form-grid compact">
              <ImageUploadInput
                fieldName="receiptImageUrl"
                label="Receipt image"
                placeholder="Paste receipt image URL or upload photo"
                defaultValue={lot.receiptImageUrl ?? ""}
              />
              <TextInput name="receiptNumber" label="Receipt number" defaultValue={lot.receiptNumber ?? ""} />
              <TextInput name="orderNumber" label="Order number" defaultValue={lot.orderNumber ?? ""} />
              <TextInput name="transactionId" label="Transaction ID" defaultValue={lot.transactionId ?? ""} />
              <TextInput name="sourceStore" label="Source store" defaultValue={lot.sourceStore ?? ""} />
              <TextInput name="paymentMethod" label="Payment method" defaultValue={lot.paymentMethod ?? ""} />
              <TextareaInput name="notes" label="Notes" defaultValue={lot.notes ?? ""} wide />
            </div>
          </section>

          <div className="inventory-edit-actions">
            <button className="mini-action" disabled={busy} type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-action" disabled={busy} type="submit">
              <Save size={16} />
              {busyLabel === saveLabel ? "Saving" : "Save Stock"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InventoryEditProductModal({
  item,
  busy,
  busyLabel,
  submit,
  onClose
}: {
  item: InventoryItemDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  onClose: () => void;
}) {
  const [imageUrl, setImageUrl] = useState(item.imageUrl ?? "");
  const saveLabel = `Updating inventory item ${item.id}`;

  return (
    <div className="inventory-modal-backdrop" role="presentation">
      <div className="inventory-modal inventory-edit-modal" role="dialog" aria-modal="true" aria-label={`Edit ${item.itemName}`}>
        <div className="edit-card-heading">
          <div>
            <h2>Edit Product</h2>
            <span>Update the saved catalog details. Stock lots and sales history stay unchanged.</span>
          </div>
          <button className="icon-button" type="button" aria-label="Close edit product" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form
          className="inventory-edit-form"
          onSubmit={(event) =>
            submit(
              event,
              saveLabel,
              (form) => requestJson(`/api/radar/inventory/${item.id}`, { method: "PATCH", body: JSON.stringify(formJson(form)) }),
              { reset: false, success: "Product updated" }
            )
          }
        >
          <section className="inventory-edit-preview">
            <ProductImagePreview imageUrl={imageUrl} itemName={item.itemName} />
            <div>
              <strong>{item.itemName}</strong>
              <span>
                {formatStatus(item.category)} - UPC {item.upc || "missing"} - {inventoryStockStatusLabel(item)}
              </span>
            </div>
          </section>

          <section className="flow-step">
            <span>Catalog</span>
            <h3>Product details</h3>
            <div className="form-grid compact">
              <TextInput name="itemName" label="Product/card name" defaultValue={item.itemName} required />
              <TextInput name="brand" label="Brand" defaultValue={item.brand ?? ""} />
              <SelectInput name="category" label="Category" defaultValue={item.category || "sealed_packs"} options={inventoryCategories.map(optionFromString)} />
              <TextInput name="setName" label="Set" defaultValue={item.setName ?? ""} />
              <TextInput name="retailer" label="Retailer" defaultValue={item.retailer ?? ""} />
              <TextInput name="source" label="Default source/store" defaultValue={item.source} required />
              <TextInput name="manufacturer" label="Manufacturer" defaultValue={item.manufacturer ?? ""} />
              <TextInput name="model" label="Model" defaultValue={item.model ?? ""} />
              <TextareaInput name="description" label="Description" defaultValue={item.description ?? ""} wide />
            </div>
          </section>

          <section className="flow-step">
            <span>Identifiers</span>
            <h3>UPC and retailer IDs</h3>
            <div className="form-grid compact">
              <TextInput name="upc" label="UPC / EAN" inputMode="numeric" defaultValue={item.upc ?? ""} />
              <TextInput name="sku" label="SKU / TCIN" defaultValue={item.sku ?? ""} />
              <TextInput name="dpci" label="DPCI" defaultValue={item.dpci ?? ""} />
              <TextInput name="asin" label="ASIN" defaultValue={item.asin ?? ""} />
              <TextInput name="exactProductUrl" label="Exact product URL" type="url" defaultValue={item.exactProductUrl ?? ""} wide />
            </div>
          </section>

          <section className="flow-step">
            <span>Image</span>
            <h3>Product image</h3>
            <div className="form-grid compact">
              <ImageUploadInput defaultValue={item.imageUrl ?? ""} value={imageUrl} onValueChange={setImageUrl} />
            </div>
          </section>

          <section className="flow-step">
            <span>Plan</span>
            <h3>Condition and selling plan</h3>
            <div className="form-grid compact">
              <SelectInput name="itemStatus" label="Item status" defaultValue={item.itemStatus || "sealed"} options={inventoryStatuses.map(optionFromString)} />
              <TextInput name="condition" label="Condition" defaultValue={item.condition ?? ""} placeholder="Sealed, raw NM, graded PSA 10" />
              <SelectInput name="expectedPlan" label="Plan" defaultValue={item.expectedPlan || "Hold"} options={inventoryPlanOptions} />
              <TextInput name="targetSellPrice" label="Target sell price" type="number" min="0" step="0.01" defaultValue={item.targetSellPrice ?? ""} />
              <TextInput name="minimumAcceptablePrice" label="Minimum acceptable price" type="number" min="0" step="0.01" defaultValue={item.minimumAcceptablePrice ?? ""} />
              <SelectInput name="listingStatus" label="Listing status" defaultValue={item.listingStatus || "not_listed"} options={listingStatuses.map(optionFromString)} />
              <TextInput name="listingPlatform" label="Listing platform" defaultValue={item.listingPlatform ?? ""} placeholder="eBay, Whatnot, Facebook" />
              <TextInput name="msrp" label="MSRP / retail price" type="number" min="0" step="0.01" defaultValue={item.msrp ?? ""} />
              <TextareaInput name="notes" label="Notes" defaultValue={item.notes ?? ""} wide />
            </div>
          </section>

          <section className="flow-step">
            <span>Proof</span>
            <h3>Receipt and order details</h3>
            <div className="form-grid compact">
              <ImageUploadInput
                fieldName="receiptImageUrl"
                label="Receipt image"
                placeholder="Paste receipt image URL or upload photo"
                defaultValue={item.receiptImageUrl ?? ""}
              />
              <TextInput name="receiptNumber" label="Receipt number" defaultValue={item.receiptNumber ?? ""} />
              <TextInput name="orderNumber" label="Order number" defaultValue={item.orderNumber ?? ""} />
              <TextInput name="transactionId" label="Transaction ID" defaultValue={item.transactionId ?? ""} />
              <TextInput name="sourceStore" label="Source store" defaultValue={item.sourceStore ?? ""} />
              <TextInput name="paymentMethod" label="Payment method" defaultValue={item.paymentMethod ?? ""} />
            </div>
          </section>

          <div className="inventory-edit-actions">
            <button className="mini-action" disabled={busy} type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-action" disabled={busy} type="submit">
              <Save size={16} />
              {busyLabel === saveLabel ? "Saving" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StoreListingModal({
  item,
  busy,
  busyLabel,
  submit,
  onClose
}: {
  item: InventoryItemDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  onClose: () => void;
}) {
  const [imageUrl, setImageUrl] = useState(item.publicImages[0] || item.imageUrl || "");
  const saveLabel = `Updating store listing ${item.id}`;
  return (
    <div className="inventory-modal-backdrop" role="presentation">
      <div className="inventory-modal inventory-edit-modal" role="dialog" aria-modal="true" aria-label={`Edit store listing ${item.itemName}`}>
        <div className="edit-card-heading">
          <div>
            <h2>Edit Store Listing</h2>
            <span>Public shoppers only see this safe listing data. Costs, sources, lots, and radar notes stay private.</span>
          </div>
          <button className="icon-button" type="button" aria-label="Close store listing" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <form
          className="inventory-edit-form"
          onSubmit={(event) =>
            submit(
              event,
              saveLabel,
              (form) => requestJson(`/api/radar/inventory/${item.id}/store-listing`, { method: "PATCH", body: JSON.stringify(formJson(form)) }),
              { reset: false, success: "Store listing saved" }
            )
          }
        >
          <section className="inventory-edit-preview">
            <ProductImagePreview imageUrl={imageUrl || item.imageUrl || ""} itemName={item.itemName} />
            <div>
              <strong>{item.publicTitle || item.itemName}</strong>
              <span>{storeListingLabel(item)} - {item.quantityOwned} owned - {item.publicPrice !== null ? money(item.publicPrice) : "No public price"}</span>
            </div>
          </section>
          <section className="flow-step">
            <span>Publish</span>
            <h3>Storefront visibility</h3>
            <div className="form-grid compact">
              <label className="checkbox-label">
                <input name="publishToStore" type="checkbox" value="true" defaultChecked={item.publishToStore} />
                Publish to public store
              </label>
              <SelectInput
                name="storeStatus"
                label="Store status"
                defaultValue={item.storeStatus || "draft"}
                options={[
                  { value: "draft", label: "Draft" },
                  { value: "active", label: "Active" },
                  { value: "hidden", label: "Hidden" },
                  { value: "sold_out", label: "Sold Out" }
                ]}
              />
              <TextInput name="publicSlug" label="Public URL slug" defaultValue={item.publicSlug ?? ""} />
              <TextInput name="storefrontCategory" label="Store category" defaultValue={item.storefrontCategory || item.category} />
            </div>
          </section>
          <section className="flow-step">
            <span>Listing</span>
            <h3>Customer-facing product data</h3>
            <div className="form-grid compact">
              <TextInput name="publicTitle" label="Public title" defaultValue={item.publicTitle || item.itemName} required />
              <TextInput name="publicPrice" label="Public price" type="number" min="0" step="0.01" defaultValue={item.publicPrice ?? item.targetSellPrice ?? ""} />
              <TextInput name="compareAtPrice" label="Compare at price" type="number" min="0" step="0.01" defaultValue={item.compareAtPrice ?? ""} />
              <TextInput name="availableForSale" label="Available for sale" type="number" min="0" step="1" defaultValue={item.availableForSale ?? item.quantityOwned} />
              <TextInput name="maxQuantityPerOrder" label="Max quantity/order" type="number" min="1" max="25" step="1" defaultValue={item.maxQuantityPerOrder || 4} />
              <TextInput name="storefrontTags" label="Tags" defaultValue={item.storefrontTags.join(", ")} />
              <TextareaInput name="publicDescription" label="Public description" defaultValue={item.publicDescription || item.description || ""} wide />
            </div>
          </section>
          <section className="flow-step">
            <span>Images and shipping</span>
            <h3>Public image and delivery options</h3>
            <div className="form-grid compact">
              <ImageUploadInput
                fieldName="publicImages"
                label="Public image URL"
                defaultValue={imageUrl}
                value={imageUrl}
                onValueChange={setImageUrl}
              />
              <TextInput name="shippingProfile" label="Shipping profile" defaultValue={item.shippingProfile || "standard"} />
              <label className="checkbox-label">
                <input name="shippingAvailable" type="checkbox" value="true" defaultChecked={item.shippingAvailable} />
                Shipping available
              </label>
              <label className="checkbox-label">
                <input name="localPickupAvailable" type="checkbox" value="true" defaultChecked={item.localPickupAvailable} />
                Local pickup available
              </label>
            </div>
          </section>
          <div className="inventory-edit-actions">
            {item.publicSlug ? (
              <a className="mini-action" href={`/shop/product/${item.publicSlug}`} target="_blank" rel="noreferrer">
                <ExternalLink size={14} />
                View Public Page
              </a>
            ) : null}
            <button className="mini-action" disabled={busy} type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-action" disabled={busy} type="submit">
              <Save size={16} />
              {busyLabel === saveLabel ? "Saving Listing" : "Save Listing"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InventoryMarketHero({ item, tone }: { item: InventoryItemDTO; tone: "good" | "watch" | "bad" | "muted" }) {
  const hasComps = item.marketCompCount > 0;
  return (
    <div className={`inventory-market-hero ${tone}`}>
      <div className="market-hero-primary">
        <small>Current Market Value</small>
        <strong>{hasComps ? money(item.grossMarketValue) : "Not collected"}</strong>
        <span>
          {hasComps
            ? `${item.marketCompCount}/3 sold comps used - ${inventoryMarketSource(item)}`
            : "Add manual sold comps or configure eBay before market value is treated as real."}
        </span>
      </div>
      <div className="market-hero-metrics">
        <MarketHeroMetric label="Estimated Net After Fees" value={hasComps ? money(item.netMarketValue) : "Needs comps"} tone={tone} />
        <MarketHeroMetric label="Estimated Profit" value={hasComps ? money(item.marketProfitLoss) : "Needs comps"} tone={tone} />
        <MarketHeroMetric label="ROI %" value={hasComps ? percent(item.marketRoiPercent) : "Needs comps"} tone={tone} />
      </div>
    </div>
  );
}

function MarketHeroMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "good" | "watch" | "bad" | "muted";
}) {
  return (
    <span className={`market-hero-metric ${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function InventoryInlineCompForm({
  item,
  busy,
  busyLabel,
  submit
}: {
  item: InventoryItemDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
}) {
  return (
    <form
      className="market-inline-comp-form"
      onSubmit={(event) =>
        submit(
          event,
          `Adding manual comp ${item.id}`,
          (form) => requestJson("/api/radar/inventory/comps", { method: "POST", body: JSON.stringify(formJson(form)) }),
          { reset: true, success: "Manual sold comp added" }
        )
      }
    >
      <input type="hidden" name="inventoryItemId" value={item.id} />
      <div className="inline-comp-heading">
        <strong>Add Manual Sold Comp</strong>
        <span>Use a real completed sale. This comp becomes visible proof and updates market value.</span>
      </div>
      <TextInput name="saleTitle" label="Sold listing title" required />
      <TextInput name="salePrice" label="Sold price" type="number" min="0" step="0.01" required />
      <TextInput name="soldAt" label="Sold date" type="date" required />
      <TextInput name="sourceUrl" label="Sold listing URL" type="url" />
      <SelectInput name="sourceQuality" label="Source" defaultValue="MANUAL_ESTIMATE" options={compSourceQualities.map((value) => ({ value, label: formatSourceQuality(value) }))} />
      <TextInput name="matchScore" label="Confidence" type="number" min="0" max="100" defaultValue="90" />
      <TextareaInput name="notes" label="Notes" wide />
      <button className="primary-action" disabled={busy} type="submit">
        <Plus size={16} />
        {busyLabel === `Adding manual comp ${item.id}` ? "Saving Comp" : "Add Manual Sold Comp"}
      </button>
    </form>
  );
}

function DetailStat({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <span className={`detail-stat ${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function CompactLotsList({
  item,
  onEditLot,
  onDeleteLot
}: {
  item: InventoryItemDTO;
  onEditLot?: (item: InventoryItemDTO, lot: InventoryStockLotDTO) => void;
  onDeleteLot?: (item: InventoryItemDTO, lot: InventoryStockLotDTO) => void;
}) {
  if (!item.stockLots.length) return <EmptyState icon={History} title="No lots yet" detail="Add stock to create purchase batches." />;
  return (
    <div className="compact-ledger-list">
      {item.stockLots.map((lot) => (
        <article key={lot.id}>
          <strong>{shortDate(lot.purchasedAt)}</strong>
          <span>{lot.sourceStore || lot.source}</span>
          <span>Qty {lot.quantity} - remaining {lot.remainingQuantity}</span>
          <b>{money(lot.totalCost)}</b>
          <small>{lot.receiptNumber || lot.orderNumber || "No receipt saved"}</small>
          {onEditLot || onDeleteLot ? (
            <div className="compact-ledger-actions">
              {onEditLot ? (
                <button className="mini-action" type="button" onClick={() => onEditLot(item, lot)}>
                  Edit Stock
                </button>
              ) : null}
              {onDeleteLot ? (
                <button
                  className="mini-action danger"
                  type="button"
                  disabled={lot.remainingQuantity !== lot.quantity}
                  title={lot.remainingQuantity !== lot.quantity ? "Lots with recorded sales cannot be removed." : "Remove this stock lot"}
                  onClick={() => onDeleteLot(item, lot)}
                >
                  Remove
                </button>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function CompactSalesList({ item }: { item: InventoryItemDTO }) {
  if (!item.sales.length) return <EmptyState icon={CircleDollarSign} title="No sales recorded" detail="Use Record Sale from the row actions after you sell." />;
  return (
    <div className="compact-ledger-list">
      {item.sales.map((sale) => (
        <article key={sale.id}>
          <strong>{shortDate(sale.soldAt)}</strong>
          <span>{formatStatus(sale.platform)}</span>
          <span>Qty {sale.quantitySold} - net {money(sale.netSale)}</span>
          <b className={sale.profitLoss >= 0 ? "profit-good" : "profit-bad"}>{money(sale.profitLoss)}</b>
          <small>ROI {percent(sale.roiPercent)}</small>
        </article>
      ))}
    </div>
  );
}

function AttachWatchedProductForm({
  item,
  products,
  busy,
  busyLabel,
  submit
}: {
  item: InventoryItemDTO;
  products: ProductDTO[];
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
}) {
  const productOptions = products
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((product) => ({
      value: product.id,
      label: `${product.name} - ${product.retailerName}${product.upc ? ` - UPC ${product.upc}` : ""}${product.sku ? ` - SKU ${product.sku}` : ""}`
    }));
  return (
    <form
      className="attach-product-form"
      onSubmit={(event) =>
        submit(
          event,
          `Attaching watched product ${item.id}`,
          (form) => requestJson(`/api/radar/inventory/${item.id}`, { method: "PATCH", body: JSON.stringify(formJson(form)) }),
          { success: "Watched product attached and image synced" }
        )
      }
    >
      <div>
        <strong>Attach watched product</strong>
        <span>Matches by UPC, SKU, DPCI, ASIN, or exact product name. Verified retailer images copy into inventory.</span>
      </div>
      <SelectInput
        name="productId"
        label="Watched product"
        defaultValue={item.productId ?? ""}
        options={[{ value: "", label: productOptions.length ? "Choose a watched product" : "No watched products available" }, ...productOptions]}
        disabled={!productOptions.length || busy}
      />
      <button className="mini-action" disabled={!productOptions.length || busy} type="submit">
        <Save size={13} />
        {busyLabel === `Attaching watched product ${item.id}` ? "Attaching" : "Attach"}
      </button>
    </form>
  );
}

function StockLotsPanel({ item }: { item: InventoryItemDTO | null }) {
  return (
    <section className="inventory-detail-panel stock-lots-panel">
      <div className="edit-card-heading">
        <div>
          <h2>Stock Lots</h2>
          <span>{item ? `Purchase batches for ${item.itemName}` : "Select a product to see purchase batches."}</span>
        </div>
      </div>
      {!item ? (
        <EmptyState icon={History} title="No product selected" detail="Select a catalog product to see lots." />
      ) : item.stockLots.length ? (
        <div className="lot-table">
          <div className="lot-row lot-head">
            <span>Purchased</span>
            <span>Source</span>
            <span>Qty</span>
            <span>Cost / Unit</span>
            <span>Total</span>
            <span>Remaining</span>
            <span>Proof</span>
          </div>
          {item.stockLots.map((lot) => (
            <div className="lot-row" key={lot.id}>
              <span>{shortDate(lot.purchasedAt)}</span>
              <strong>{lot.source}</strong>
              <span>{lot.quantity}</span>
              <span>{money(lot.costPerUnit)}</span>
              <span>{money(lot.totalCost)}</span>
              <span>{lot.remainingQuantity}</span>
              <span>
                {lot.receiptNumber || lot.orderNumber || "No receipt"}
                {lot.receiptImageUrl ? " - image" : ""}
                {lot.sourceStore ? ` - ${lot.sourceStore}` : ""}
              </span>
            </div>
          ))}
          <div className="lot-summary">
            <span>Total Remaining: <strong>{item.quantityOwned}</strong></span>
            <span>Total Cost: <strong>{money(item.totalCost)}</strong></span>
          </div>
        </div>
      ) : (
        <EmptyState icon={History} title="No lots yet" detail="Add stock to create purchase batches for true cost basis." />
      )}
    </section>
  );
}

function SelectedSalesPanel({
  item,
  busy,
  busyLabel,
  submit
}: {
  item: InventoryItemDTO | null;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
}) {
  return (
    <section className="inventory-detail-panel sales-log-panel" id="inventory-sales-panel">
      <div className="edit-card-heading">
        <div>
          <h2>Sales Log</h2>
          <span>{item ? `Sales and realized profit for ${item.itemName}` : "Select a product to record a sale."}</span>
        </div>
      </div>
      {!item ? (
        <EmptyState icon={CircleDollarSign} title="No product selected" detail="Select a catalog product to record sales." />
      ) : (
        <>
          <RecordSaleForm key={item.id} item={item} busy={busy} busyLabel={busyLabel} submit={submit} />
          {item.sales.length ? (
            <div className="lot-table">
              <div className="lot-row lot-head">
                <span>Sold</span>
                <span>Qty</span>
                <span>Sold Price</span>
                <span>Platform</span>
                <span>Fees</span>
                <span>Ship</span>
                <span>Net Profit</span>
                <span>ROI</span>
              </div>
              {item.sales.map((sale) => (
                <div className="lot-row sale-row" key={sale.id}>
                  <span>{shortDate(sale.soldAt)}</span>
                  <span>{sale.quantitySold}</span>
                  <span>{money(sale.soldPricePerItem)}</span>
                  <strong>{formatStatus(sale.platform)}</strong>
                  <span>{money(sale.fees)}</span>
                  <span>{money(sale.shippingCost)}</span>
                  <span className={sale.profitLoss >= 0 ? "profit-good" : "profit-bad"}>{money(sale.profitLoss)}</span>
                  <span>{percent(sale.roiPercent)}</span>
                </div>
              ))}
              <div className="lot-summary">
                <span>Total Sold: <strong>{item.quantitySold}</strong></span>
                <span>Gross: <strong>{money(item.totalSalesGross)}</strong></span>
                <span>Net Profit: <strong>{money(item.realizedProfitLoss)}</strong></span>
              </div>
            </div>
          ) : (
            <EmptyState icon={CircleDollarSign} title="No sales recorded" detail="Use Record Sale after you sell part of this lot." />
          )}
        </>
      )}
    </section>
  );
}

function RecordSaleModal({
  item,
  busy,
  busyLabel,
  submit,
  onClose
}: {
  item: InventoryItemDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  onClose: () => void;
}) {
  return (
    <div className="inventory-modal-backdrop" role="presentation">
      <div className="inventory-modal record-sale-modal" role="dialog" aria-modal="true" aria-label={`Record sale for ${item.itemName}`}>
        <div className="edit-card-heading">
          <div>
            <h2>Record Sale</h2>
            <span>Subtract sold quantity and log profit/loss for this product.</span>
          </div>
          <button className="icon-button" type="button" aria-label="Close record sale" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <article className="sale-product-preview">
          <InventoryImage item={item} />
          <div>
            <strong>{item.itemName}</strong>
            <span>{item.upc || item.sku || item.dpci || "No UPC/SKU saved"}</span>
            <small>{item.quantityOwned} owned - average cost {money(item.averageCost)}</small>
          </div>
        </article>
        <RecordSaleForm item={item} busy={busy} busyLabel={busyLabel} submit={submit} />
      </div>
    </div>
  );
}

function RecordSaleForm({
  item,
  busy,
  busyLabel,
  submit
}: {
  item: InventoryItemDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
}) {
  const [quantity, setQuantity] = useState(Math.min(1, Math.max(0, item.quantityOwned)));
  const [price, setPrice] = useState(item.targetSellPrice ?? item.currentMarketEstimate ?? 0);
  const [fees, setFees] = useState(0);
  const [shipping, setShipping] = useState(0);
  const gross = quantity * price;
  const net = gross - fees - shipping;
  const costBasis = item.averageCost * quantity;
  const profit = net - costBasis;
  const roi = costBasis > 0 ? (profit / costBasis) * 100 : null;
  return (
    <form
      className="record-sale-form"
      onSubmit={(event) =>
        submit(
          event,
          `Recording sale ${item.id}`,
          (form) => requestJson(`/api/radar/inventory/${item.id}/sales`, { method: "POST", body: JSON.stringify(formJson(form)) }),
          { reset: true, success: "Sale recorded" }
        )
      }
    >
      <h4>Record Sale</h4>
      <div className="form-grid compact">
        <TextInput
          name="quantitySold"
          label="Quantity sold"
          type="number"
          min="1"
          max={item.quantityOwned}
          value={String(quantity)}
          onChange={(event) => setQuantity(Math.min(item.quantityOwned, Math.max(1, Number(event.currentTarget.value) || 1)))}
          required
        />
        <TextInput
          name="soldPricePerItem"
          label="Sold price per item"
          type="number"
          min="0"
          step="0.01"
          value={String(price)}
          onChange={(event) => setPrice(Math.max(0, Number(event.currentTarget.value) || 0))}
          required
        />
        <SelectInput name="platform" label="Platform" options={salePlatforms.map(optionFromString)} />
        <TextInput
          name="fees"
          label="Fees"
          type="number"
          min="0"
          step="0.01"
          value={String(fees)}
          onChange={(event) => setFees(Math.max(0, Number(event.currentTarget.value) || 0))}
        />
        <TextInput
          name="shippingCost"
          label="Shipping"
          type="number"
          min="0"
          step="0.01"
          value={String(shipping)}
          onChange={(event) => setShipping(Math.max(0, Number(event.currentTarget.value) || 0))}
        />
        <TextInput name="soldAt" label="Sold date" type="date" defaultValue={todayDateInput()} required />
        <TextareaInput name="notes" label="Notes" wide />
      </div>
      <div className="sale-preview">
        <span>Gross {money(gross)}</span>
        <span>Net {money(net)}</span>
        <span>Cost basis {money(costBasis)}</span>
        <strong>P/L {money(profit)} ({percent(roi)})</strong>
      </div>
      <button className="mini-action solid" disabled={busy || item.quantityOwned <= 0} type="submit">
        <Save size={14} />
        {busyLabel === `Recording sale ${item.id}` ? "Saving" : "Record Sale"}
      </button>
    </form>
  );
}

type PurchaseLotRow = {
  item: InventoryItemDTO;
  lot: InventoryStockLotDTO;
};

function PurchasesLog({ items, summary }: { items: InventoryItemDTO[]; summary: DashboardDTO["inventorySummary"] }) {
  const [selectedLotId, setSelectedLotId] = useState<string>("");
  const [filters, setFilters] = useState({
    search: "",
    source: "ALL",
    fromDate: "",
    toDate: ""
  });
  const lots: PurchaseLotRow[] = items
    .flatMap((item) =>
      item.stockLots.length
        ? item.stockLots.map((lot) => ({ item, lot }))
        : [
            {
              item,
              lot: {
                id: `${item.id}-legacy`,
                inventoryItemId: item.id,
                purchasedAt: item.purchasedAt,
                source: item.source,
                quantity: item.quantity,
                costPerUnit: item.cost,
                purchaseExtraCost: item.purchaseExtraCost,
                totalCost: item.totalCost,
                remainingQuantity: item.quantityOwned,
                notes: item.notes,
                receiptNumber: item.receiptNumber,
                receiptImageUrl: item.receiptImageUrl,
                orderNumber: item.orderNumber,
                transactionId: item.transactionId,
                sourceStore: item.sourceStore,
                paymentMethod: item.paymentMethod,
                createdAt: item.createdAt
              }
            }
          ]
    )
    .sort((a, b) => new Date(b.lot.purchasedAt).getTime() - new Date(a.lot.purchasedAt).getTime());
  const sourceOptions = useMemo(
    () =>
      Array.from(new Set(lots.map(({ lot, item }) => lot.sourceStore || lot.source || item.source).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((source) => ({ value: source, label: source })),
    [lots]
  );
  const visibleLots = useMemo(
    () =>
      lots.filter(({ item, lot }) => {
        const query = filters.search.toLowerCase().trim();
        const purchasedAt = new Date(lot.purchasedAt);
        const fromDate = filters.fromDate ? new Date(`${filters.fromDate}T00:00:00`) : null;
        const toDate = filters.toDate ? new Date(`${filters.toDate}T23:59:59`) : null;
        const source = lot.sourceStore || lot.source || item.source;
        if (
          query &&
          !item.itemName.toLowerCase().includes(query) &&
          !(item.upc || "").toLowerCase().includes(query) &&
          !(item.sku || "").toLowerCase().includes(query) &&
          !(item.category || "").toLowerCase().includes(query) &&
          !source.toLowerCase().includes(query)
        ) {
          return false;
        }
        if (filters.source !== "ALL" && source !== filters.source) return false;
        if (fromDate && purchasedAt < fromDate) return false;
        if (toDate && purchasedAt > toDate) return false;
        return true;
      }),
    [filters, lots]
  );
  const selectedLotRow = visibleLots.find(({ lot }) => lot.id === selectedLotId) ?? null;
  const totalRemaining = lots.reduce((total, { lot }) => total + lot.remainingQuantity, 0);
  const averageLotCost = lots.length ? lots.reduce((total, { lot }) => total + lot.totalCost, 0) / lots.length : 0;

  function updateFilter(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = event.currentTarget;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  return (
    <section className="purchase-dashboard-panel">
      <div className="sales-header-card purchase-header-card">
        <div>
          <h2>Purchases</h2>
          <span>Track what you bought, where it came from, and what quantity remains.</span>
        </div>
        <div className="sales-header-actions">
          <a className="mini-action" href="/api/radar/inventory?format=lots-csv" target="_blank" rel="noreferrer">
            <Download size={14} />
            Export Purchases
          </a>
        </div>
      </div>

      <div className="sales-summary-grid">
        <SalesSummaryCard label="Total Spent" value={money(summary.totalSpent)} detail={`This month ${money(summary.spendingThisMonth)}`} icon={CircleDollarSign} tone="neutral" />
        <SalesSummaryCard label="Purchase Lots" value={String(lots.length)} detail={`${items.length} catalog products`} icon={PackageSearch} tone="neutral" />
        <SalesSummaryCard label="Items Remaining" value={String(totalRemaining)} detail="Unsold quantity" icon={Trophy} tone="good" />
        <SalesSummaryCard label="Avg Lot Cost" value={money(averageLotCost)} detail={`This week ${money(summary.spendingThisWeek)}`} icon={Activity} tone="watch" />
      </div>

      <div className="sales-filter-bar purchase-filter-bar">
        <TextInput name="search" label="Search purchases" value={filters.search} onChange={updateFilter} placeholder="Product, UPC, SKU, source" />
        <SelectInput
          name="source"
          label="Source"
          value={filters.source}
          onChange={updateFilter}
          options={[{ value: "ALL", label: "All Sources" }, ...sourceOptions]}
        />
        <TextInput name="fromDate" label="From" type="date" value={filters.fromDate} onChange={updateFilter} />
        <TextInput name="toDate" label="To" type="date" value={filters.toDate} onChange={updateFilter} />
      </div>

      <div className="purchase-list">
        {visibleLots.length ? (
          visibleLots.map((row) => <PurchaseCard key={row.lot.id} row={row} onViewDetails={() => setSelectedLotId(row.lot.id)} />)
        ) : lots.length ? (
          <EmptyState icon={Search} title="No purchases match these filters" detail="Clear filters or search another product/source." />
        ) : (
          <div className="sales-empty-state">
            <Trophy size={28} />
            <h3>No purchases logged yet</h3>
            <p>Add stock when you buy a product to start tracking cost basis.</p>
          </div>
        )}
      </div>
      {selectedLotRow ? <PurchaseDetailsModal row={selectedLotRow} onClose={() => setSelectedLotId("")} /> : null}
    </section>
  );
}

function purchaseIdentifier(item: InventoryItemDTO) {
  return item.upc ? `UPC ${item.upc}` : item.sku ? `SKU ${item.sku}` : item.dpci ? `DPCI ${item.dpci}` : item.asin ? `ASIN ${item.asin}` : "UPC/SKU not saved";
}

function PurchaseCard({ row, onViewDetails }: { row: PurchaseLotRow; onViewDetails: () => void }) {
  const { item, lot } = row;
  const source = lot.sourceStore || lot.source || item.source || "Unknown source";
  const remainingTone = lot.remainingQuantity > 0 ? "good" : "watch";
  return (
    <article className="purchase-card">
      <div className="sale-product-cell">
        <InventoryImage item={item} />
        <div>
          <strong>{item.itemName}</strong>
          <span>{purchaseIdentifier(item)} - {formatStatus(item.category)}</span>
          <small>
            Bought {shortDate(lot.purchasedAt)} - {source} - Qty {lot.quantity}
          </small>
        </div>
      </div>
      <div className="purchase-source-cell">
        <span className="platform-pill local">{source}</span>
        <small>{dateTime(lot.purchasedAt)}</small>
        <b>{lot.receiptNumber || lot.orderNumber || "No receipt saved"}</b>
      </div>
      <div className="sale-money-grid purchase-money-grid">
        <span>
          <small>Unit Cost</small>
          <strong>{money(lot.costPerUnit)}</strong>
        </span>
        <span>
          <small>Total Cost</small>
          <strong>{money(lot.totalCost)}</strong>
        </span>
        <span>
          <small>Remaining</small>
          <strong>{lot.remainingQuantity} / {lot.quantity}</strong>
        </span>
        <span>
          <small>Extra Cost</small>
          <strong>{money(lot.purchaseExtraCost ?? 0)}</strong>
        </span>
      </div>
      <div className="sale-status-cell">
        <span className={`sale-status-badge ${remainingTone}`}>{lot.remainingQuantity > 0 ? "In Inventory" : "Sold Through"}</span>
        <button className="mini-action" type="button" onClick={onViewDetails}>
          View Details
        </button>
      </div>
    </article>
  );
}

function PurchaseDetailsModal({ row, onClose }: { row: PurchaseLotRow; onClose: () => void }) {
  const { item, lot } = row;
  const source = lot.sourceStore || lot.source || item.source || "Unknown source";
  return (
    <div className="inventory-modal-backdrop" role="presentation">
      <div className="inventory-modal sale-details-modal purchase-details-modal" role="dialog" aria-modal="true" aria-label={`${item.itemName} purchase details`}>
        <div className="sales-detail-header">
          <InventoryImage item={item} />
          <div>
            <h2>{item.itemName}</h2>
            <span>{purchaseIdentifier(item)}</span>
          </div>
          <button className="icon-button" type="button" aria-label="Close purchase details" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="sale-detail-hero">
          <span>
            <small>Total Cost</small>
            <strong>{money(lot.totalCost)}</strong>
          </span>
          <span>
            <small>Remaining Quantity</small>
            <strong>{lot.remainingQuantity} / {lot.quantity}</strong>
          </span>
          <span className={`sale-status-badge ${lot.remainingQuantity > 0 ? "good" : "watch"}`}>{lot.remainingQuantity > 0 ? "In Inventory" : "Sold Through"}</span>
        </div>
        <div className="sale-detail-grid">
          <DetailStat label="Purchased" value={dateTime(lot.purchasedAt)} />
          <DetailStat label="Source" value={source} />
          <DetailStat label="Quantity" value={String(lot.quantity)} />
          <DetailStat label="Cost Per Unit" value={money(lot.costPerUnit)} />
          <DetailStat label="Extra Cost" value={money(lot.purchaseExtraCost ?? 0)} />
          <DetailStat label="Payment" value={lot.paymentMethod || "Not saved"} />
          <DetailStat label="Receipt" value={lot.receiptNumber || "Not saved"} />
          <DetailStat label="Order" value={lot.orderNumber || "Not saved"} />
        </div>
        <section className="inventory-detail-section">
          <h3>Notes & Proof</h3>
          <div className="detail-line-list">
            <span>{lot.notes || item.notes || "No notes saved."}</span>
            <span>{lot.transactionId ? `Transaction: ${lot.transactionId}` : "Transaction not saved"}</span>
            <span>{lot.receiptImageUrl ? `Receipt image: ${lot.receiptImageUrl}` : "Receipt image not saved"}</span>
            <span>{item.exactProductUrl ? `Product URL: ${item.exactProductUrl}` : "Product URL not saved"}</span>
          </div>
        </section>
        <div className="inventory-edit-actions">
          <button className="primary-action" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SalesLog({
  items,
  sales,
  selectedItem,
  summary,
  onRecordSale
}: {
  items: InventoryItemDTO[];
  sales: InventorySaleDTO[];
  selectedItem: InventoryItemDTO | null;
  summary: DashboardDTO["inventorySummary"];
  onRecordSale: () => void;
}) {
  const [selectedSaleId, setSelectedSaleId] = useState<string>("");
  const [filters, setFilters] = useState({
    search: "",
    platform: "ALL",
    profitStatus: "ALL",
    fromDate: "",
    toDate: ""
  });
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const platformOptions = useMemo(
    () =>
      Array.from(new Set(sales.map((sale) => sale.platform).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b))
        .map((platform) => ({ value: platform, label: formatStatus(platform) })),
    [sales]
  );
  const sorted = useMemo(
    () => [...sales].sort((a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime()),
    [sales]
  );
  const saleRows = useMemo(
    () =>
      sorted
        .map((sale) => ({ sale, item: itemById.get(sale.inventoryItemId) ?? null }))
        .filter(({ sale, item }) => {
          const query = filters.search.toLowerCase().trim();
          const soldAt = new Date(sale.soldAt);
          const fromDate = filters.fromDate ? new Date(`${filters.fromDate}T00:00:00`) : null;
          const toDate = filters.toDate ? new Date(`${filters.toDate}T23:59:59`) : null;
          const status = saleProfitStatus(sale);
          if (
            query &&
            !sale.itemName.toLowerCase().includes(query) &&
            !(item?.upc || "").toLowerCase().includes(query) &&
            !(item?.sku || "").toLowerCase().includes(query) &&
            !(item?.category || "").toLowerCase().includes(query) &&
            !sale.platform.toLowerCase().includes(query)
          ) {
            return false;
          }
          if (filters.platform !== "ALL" && sale.platform !== filters.platform) return false;
          if (filters.profitStatus !== "ALL" && status !== filters.profitStatus) return false;
          if (fromDate && soldAt < fromDate) return false;
          if (toDate && soldAt > toDate) return false;
          return true;
        }),
    [filters, itemById, sorted]
  );
  const selectedSaleRow = saleRows.find(({ sale }) => sale.id === selectedSaleId) ?? null;
  const averageSalePrice = summary.itemsSold > 0 ? summary.totalSalesGross / summary.itemsSold : 0;

  function updateFilter(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = event.currentTarget;
    setFilters((current) => ({ ...current, [name]: value }));
  }

  return (
    <section className="sales-dashboard-panel">
      <div className="sales-header-card">
        <div>
          <h2>Sales</h2>
          <span>Track sold items, revenue, and profit.</span>
        </div>
        <div className="sales-header-actions">
          <a className="mini-action" href="/api/radar/inventory?format=sales-csv" target="_blank" rel="noreferrer">
            <Download size={14} />
            Export Sales
          </a>
          <button className="mini-action solid" disabled={!selectedItem} type="button" onClick={onRecordSale}>
            <CircleDollarSign size={14} />
            Record Sale
          </button>
        </div>
      </div>

      <div className="sales-summary-grid">
        <SalesSummaryCard label="Total Sales" value={money(summary.totalSalesGross)} detail={`This month ${money(summary.salesThisMonth)}`} icon={CircleDollarSign} tone="neutral" />
        <SalesSummaryCard label="Items Sold" value={String(summary.itemsSold)} detail={`${sales.length} recorded sales`} icon={PackageSearch} tone="neutral" />
        <SalesSummaryCard
          label="Net Profit"
          value={money(summary.realizedProfitLoss)}
          detail="After cost basis"
          icon={Activity}
          tone={summary.realizedProfitLoss >= 0 ? "good" : "bad"}
        />
        <SalesSummaryCard label="Avg Sale Price" value={money(averageSalePrice)} detail="Gross per item sold" icon={Trophy} tone="watch" />
      </div>

      <div className="sales-filter-bar">
        <TextInput name="search" label="Search sold products" value={filters.search} onChange={updateFilter} placeholder="Product, UPC, SKU, platform" />
        <SelectInput
          name="platform"
          label="Platform"
          value={filters.platform}
          onChange={updateFilter}
          options={[{ value: "ALL", label: "All Platforms" }, ...platformOptions]}
        />
        <SelectInput
          name="profitStatus"
          label="Profit status"
          value={filters.profitStatus}
          onChange={updateFilter}
          options={[
            { value: "ALL", label: "All" },
            { value: "PROFIT", label: "Profit" },
            { value: "LOSS", label: "Loss" },
            { value: "BREAKEVEN", label: "Break-even" }
          ]}
        />
        <TextInput name="fromDate" label="From" type="date" value={filters.fromDate} onChange={updateFilter} />
        <TextInput name="toDate" label="To" type="date" value={filters.toDate} onChange={updateFilter} />
      </div>

      <div className="sales-list">
        {saleRows.length ? (
          saleRows.map(({ sale, item }) => (
            <SaleCard key={sale.id} item={item} sale={sale} onViewDetails={() => setSelectedSaleId(sale.id)} />
          ))
        ) : sorted.length ? (
          <EmptyState icon={Search} title="No sales match these filters" detail="Clear filters or search another product/platform." />
        ) : (
          <div className="sales-empty-state">
            <CircleDollarSign size={28} />
            <h3>No sales recorded yet</h3>
            <p>Record a sale when a product leaves your inventory.</p>
            <button className="primary-action" disabled={!selectedItem} type="button" onClick={onRecordSale}>
              <CircleDollarSign size={15} />
              Record Sale
            </button>
          </div>
        )}
      </div>
      {selectedSaleRow ? (
        <SaleDetailsModal
          item={selectedSaleRow.item}
          sale={selectedSaleRow.sale}
          onClose={() => setSelectedSaleId("")}
        />
      ) : null}
    </section>
  );
}

function saleProfitStatus(sale: InventorySaleDTO) {
  if (sale.profitLoss > 0.005) return "PROFIT";
  if (sale.profitLoss < -0.005) return "LOSS";
  return "BREAKEVEN";
}

function saleProfitStatusLabel(sale: InventorySaleDTO) {
  const status = saleProfitStatus(sale);
  if (status === "PROFIT") return "Profitable";
  if (status === "LOSS") return "Loss";
  return "Break-even";
}

function saleProfitTone(sale: InventorySaleDTO) {
  const status = saleProfitStatus(sale);
  if (status === "PROFIT") return "good";
  if (status === "LOSS") return "bad";
  return "watch";
}

function saleIdentifier(item: InventoryItemDTO | null) {
  if (!item) return "UPC/SKU not saved";
  return item.upc ? `UPC ${item.upc}` : item.sku ? `SKU ${item.sku}` : item.dpci ? `DPCI ${item.dpci}` : item.asin ? `ASIN ${item.asin}` : "UPC/SKU not saved";
}

function SaleProductThumb({ item, sale }: { item: InventoryItemDTO | null; sale: InventorySaleDTO }) {
  const imageUrl = item?.imageUrl && isRenderableImageUrl(item.imageUrl) ? item.imageUrl : null;
  const initials = (item?.brand || sale.itemName || "No image")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
  return (
    <div className={imageUrl ? "sale-product-thumb has-image" : "sale-product-thumb"}>
      {imageUrl ? (
        <Image src={imageUrl} alt={`${sale.itemName} sold item image`} width={72} height={72} loading="lazy" unoptimized />
      ) : (
        <span>{initials || "No image"}</span>
      )}
    </div>
  );
}

function SalesSummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof CircleDollarSign;
  tone: "neutral" | "good" | "watch" | "bad";
}) {
  return (
    <article className={`sales-summary-card ${tone}`}>
      <span className="sales-summary-icon">
        <Icon size={17} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </article>
  );
}

function SaleCard({
  item,
  sale,
  onViewDetails
}: {
  item: InventoryItemDTO | null;
  sale: InventorySaleDTO;
  onViewDetails: () => void;
}) {
  const tone = saleProfitTone(sale);
  const productMeta = item
    ? `${saleIdentifier(item)} - ${formatStatus(item.category)}`
    : "UPC/SKU not saved - category unknown";
  return (
    <article className="sale-card">
      <div className="sale-product-cell">
        <SaleProductThumb item={item} sale={sale} />
        <div>
          <strong>{sale.itemName}</strong>
          <span>{productMeta}</span>
          <small>
            Sold {shortDate(sale.soldAt)} - {formatStatus(sale.platform || "unknown_platform")} - Qty {sale.quantitySold}
          </small>
        </div>
      </div>
      <div className="sale-meta-cell">
        <span className={`platform-pill ${sale.platform || "other"}`}>{formatStatus(sale.platform || "unknown_platform")}</span>
        <small>{dateTime(sale.soldAt)}</small>
        <b>Qty {sale.quantitySold}</b>
      </div>
      <div className="sale-money-grid">
        <span>
          <small>Sale Price</small>
          <strong>{money(sale.grossSale)}</strong>
        </span>
        <span>
          <small>Cost</small>
          <strong>{sale.costBasis ? money(sale.costBasis) : "Cost not set"}</strong>
        </span>
        <span>
          <small>Fees / Ship</small>
          <strong>{money((sale.fees ?? 0) + (sale.shippingCost ?? 0))}</strong>
        </span>
        <span>
          <small>Net Profit</small>
          <strong className={tone === "good" ? "profit-good" : tone === "bad" ? "profit-bad" : "profit-watch"}>
            {sale.profitLoss >= 0 ? "+" : ""}
            {money(sale.profitLoss)}
          </strong>
        </span>
      </div>
      <div className="sale-status-cell">
        <span className={`sale-status-badge ${tone}`}>{saleProfitStatusLabel(sale)}</span>
        <button className="mini-action" type="button" onClick={onViewDetails}>
          View Details
        </button>
      </div>
    </article>
  );
}

function SaleDetailsModal({
  item,
  sale,
  onClose
}: {
  item: InventoryItemDTO | null;
  sale: InventorySaleDTO;
  onClose: () => void;
}) {
  const tone = saleProfitTone(sale);
  return (
    <div className="inventory-modal-backdrop" role="presentation">
      <div className="inventory-modal sale-details-modal" role="dialog" aria-modal="true" aria-label={`${sale.itemName} sale details`}>
        <div className="sales-detail-header">
          <SaleProductThumb item={item} sale={sale} />
          <div>
            <h2>{sale.itemName}</h2>
            <span>{saleIdentifier(item)}</span>
          </div>
          <button className="icon-button" type="button" aria-label="Close sale details" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="sale-detail-hero">
          <span>
            <small>Sale Price</small>
            <strong>{money(sale.grossSale)}</strong>
          </span>
          <span>
            <small>Net Profit / Loss</small>
            <strong className={tone === "good" ? "profit-good" : tone === "bad" ? "profit-bad" : "profit-watch"}>
              {sale.profitLoss >= 0 ? "+" : ""}
              {money(sale.profitLoss)}
            </strong>
          </span>
          <span className={`sale-status-badge ${tone}`}>{saleProfitStatusLabel(sale)}</span>
        </div>
        <div className="sale-detail-grid">
          <DetailStat label="Sale Date" value={dateTime(sale.soldAt)} />
          <DetailStat label="Platform" value={formatStatus(sale.platform || "Unknown platform")} />
          <DetailStat label="Quantity Sold" value={String(sale.quantitySold)} />
          <DetailStat label="Price Per Item" value={money(sale.soldPricePerItem)} />
          <DetailStat label="Cost Basis" value={sale.costBasis ? money(sale.costBasis) : "Cost not set"} />
          <DetailStat label="Fees" value={money(sale.fees)} />
          <DetailStat label="Shipping" value={money(sale.shippingCost)} />
          <DetailStat label="ROI" value={percent(sale.roiPercent)} tone={tone === "bad" ? "bad" : tone === "good" ? "good" : "neutral"} />
        </div>
        <section className="inventory-detail-section">
          <h3>Notes</h3>
          <div className="detail-line-list">
            <span>{sale.notes || "No notes saved."}</span>
            <span>{item?.category ? `Category: ${formatStatus(item.category)}` : "Category not saved"}</span>
            <span>{item?.source ? `Original source: ${item.source}` : "Original source not saved"}</span>
          </div>
        </section>
        <div className="inventory-edit-actions">
          <button className="primary-action" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function InventoryAnalyticsPanel({ dashboard }: { dashboard: DashboardDTO }) {
  const summary = dashboard.inventorySummary;
  return (
    <>
      <SectionIntro title="Analytics" detail="Inventory performance, platform profit, and market-data gaps." />
      <section className="inventory-kpi-grid">
        <InventoryKpiCard label="Total Cost" value={money(summary.totalCost)} detail={`${summary.itemsOwned} items owned`} />
        <InventoryKpiCard label="Estimated Market" value={money(summary.estimatedMarketValue)} detail="Known market estimates only" tone="good" />
        <InventoryKpiCard label="Realized Profit" value={money(summary.realizedProfitLoss)} detail={`Sold ${summary.itemsSold} items`} tone={summary.realizedProfitLoss >= 0 ? "good" : "bad"} />
        <InventoryKpiCard label="Missing Market" value={String(summary.missingMarketDataCount)} detail="Needs comps or manual estimate" tone="watch" />
      </section>
      <section className="inventory-lower-grid">
        <div className="inventory-detail-panel">
          <div className="edit-card-heading">
            <div>
              <h2>Quantity By Category</h2>
              <span>Where your inventory is concentrated.</span>
            </div>
          </div>
          <div className="recommendation-list">
            {summary.quantityByCategory.length ? (
              summary.quantityByCategory.map((item) => (
                <span key={item.category}>
                  {formatStatus(item.category)}
                  <b>{item.quantity}</b>
                </span>
              ))
            ) : (
              <span>No inventory yet <b>0</b></span>
            )}
          </div>
        </div>
        <div className="inventory-detail-panel">
          <div className="edit-card-heading">
            <div>
              <h2>Profit By Platform</h2>
              <span>Realized profit from recorded sales.</span>
            </div>
          </div>
          <div className="recommendation-list">
            {summary.profitByPlatform.length ? (
              summary.profitByPlatform.map((item) => (
                <span key={item.platform}>
                  {formatStatus(item.platform)}
                  <b className={item.profit >= 0 ? "profit-good" : "profit-bad"}>{money(item.profit)}</b>
                </span>
              ))
            ) : (
              <span>No platform sales yet <b>{money(0)}</b></span>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function MarketPanel({ dashboard, setActiveTab }: { dashboard: DashboardDTO; setActiveTab: (tab: Tab) => void }) {
  const withMarketData = dashboard.inventory.filter((item) => item.marketCompCount > 0);
  const missingMarketData = dashboard.inventory.filter((item) => item.marketCompCount === 0).slice(0, 8);
  const profitableItems = withMarketData
    .filter((item) => (item.marketProfitLoss ?? item.businessProfitLoss ?? 0) > 0)
    .sort((a, b) => (b.marketProfitLoss ?? b.businessProfitLoss ?? 0) - (a.marketProfitLoss ?? a.businessProfitLoss ?? 0))
    .slice(0, 5);

  return (
    <>
      <SectionIntro title="Market" detail="Inventory market-data status and comp coverage. Card-specific tools are hidden for rebuild." />
      <section className="inventory-kpi-grid">
        <InventoryKpiCard label="Items With Market Data" value={String(withMarketData.length)} detail="accepted comps or estimates" tone="good" />
        <InventoryKpiCard label="Missing Market Data" value={String(dashboard.inventorySummary.missingMarketDataCount)} detail="needs comps" tone={dashboard.inventorySummary.missingMarketDataCount ? "watch" : "good"} />
        <InventoryKpiCard label="Estimated Market Value" value={money(dashboard.inventorySummary.estimatedMarketValue)} detail="known values only" tone="good" />
        <InventoryKpiCard label="eBay Status" value={dashboard.ebayStatus.ready ? "Ready" : "Manual"} detail={dashboard.ebayStatus.ready ? "live comps configured" : "manual comp mode"} tone={dashboard.ebayStatus.ready ? "good" : "watch"} />
      </section>
      <section className="inventory-lower-grid">
        <div className="inventory-detail-panel">
          <div className="edit-card-heading">
            <div>
              <h2>Market Data Coverage</h2>
              <span>Items still needing comps or a manual estimate.</span>
            </div>
            <button className="mini-action" type="button" onClick={() => setActiveTab("inventory")}>Open Inventory</button>
          </div>
          <div className="recommendation-list">
            {missingMarketData.length ? (
              missingMarketData.map((item) => (
                <span key={item.id}>
                  {item.itemName}
                  <b>Missing</b>
                </span>
              ))
            ) : (
              <span>All inventory has market data <b>Ready</b></span>
            )}
          </div>
        </div>
        <div className="inventory-detail-panel">
          <div className="edit-card-heading">
            <div>
              <h2>Top Market Signals</h2>
              <span>Profit estimates only from inventory market comps.</span>
            </div>
          </div>
          <div className="recommendation-list">
            {profitableItems.length ? (
              profitableItems.map((item) => (
                <span key={item.id}>
                  {item.itemName}
                  <b className="profit-good">{money(item.marketProfitLoss ?? item.businessProfitLoss)}</b>
                </span>
              ))
            ) : (
              <span>No profitable comp signals yet <b>No comps</b></span>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function AdminAccountSettingsPanel({
  dashboard,
  busy,
  busyLabel,
  submit
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
}) {
  const currentEmail = dashboard.currentUser.email;
  return (
    <section className="form-panel admin-account-settings">
      <div className="panel-header">
        <div>
          <p className="eyeline">Admin Account Settings</p>
          <h2>Login Email And Password</h2>
        </div>
      </div>
      <div className="account-settings-grid">
        <form
          key={`email-${currentEmail}`}
          className="account-settings-card"
          onSubmit={(event) =>
            submit(
              event,
              "Updating admin login email",
              (form) =>
                requestJson("/api/auth/admin/account", {
                  method: "PATCH",
                  body: JSON.stringify(formJson(form))
                }),
              { success: "Admin login email updated." }
            )
          }
        >
          <div className="account-settings-heading">
            <Mail size={16} />
            <div>
              <strong>Change Login Email</strong>
              <span>Current login: {currentEmail}</span>
            </div>
          </div>
          <TextInput name="email" label="New login email" type="email" autoComplete="email" defaultValue={currentEmail} required />
          <TextInput name="currentPassword" label="Current password" type="password" autoComplete="current-password" required />
          <button className="primary-action" disabled={busy} type="submit">
            <Save size={16} />
            {busyLabel === "Updating admin login email" ? "Saving Email" : "Save Login Email"}
          </button>
        </form>

        <form
          className="account-settings-card"
          onSubmit={(event) =>
            submit(
              event,
              "Changing admin password",
              (form) =>
                requestJson("/api/auth/admin/password", {
                  method: "POST",
                  body: JSON.stringify(formJson(form))
                }),
              { reauth: true, success: "Password changed. Sign in again with the new password." }
            )
          }
        >
          <div className="account-settings-heading">
            <Lock size={16} />
            <div>
              <strong>Change Password</strong>
              <span>Requires your current password and signs you out after saving.</span>
            </div>
          </div>
          <TextInput name="currentPassword" label="Current password" type="password" autoComplete="current-password" required />
          <TextInput name="password" label="New password" type="password" autoComplete="new-password" required />
          <TextInput name="confirmPassword" label="Confirm new password" type="password" autoComplete="new-password" required />
          <button className="primary-action" disabled={busy} type="submit">
            <Save size={16} />
            {busyLabel === "Changing admin password" ? "Saving Password" : "Change Password"}
          </button>
        </form>
      </div>
      <p className="settings-note">
        Passwords are hashed before saving and are never shown in logs. This updates the production database admin user,
        not just seed or environment defaults.
      </p>
    </section>
  );
}

function SettingsPanel({
  dashboard,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  return (
    <>
      <SectionIntro title="Settings" detail="Private radar account and notification controls." />
      {dashboard.currentUser.role === "ADMIN" ? (
        <AdminAccountSettingsPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} />
      ) : null}
      <NotificationSettingsPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} runAction={runAction} />
      <section className="safety-strip manual-safety">
        <ShieldCheck size={16} />
        <span>Manual checkout only. Go / Buy Now opens official retailer product pages only.</span>
      </section>
    </>
  );
}

function InventoryCompForm({
  items,
  busy,
  busyLabel,
  submit
}: {
  items: InventoryItemDTO[];
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
}) {
  return (
    <section className="form-panel">
      <PanelHeader title="Manual Inventory Sold Comp" />
      <form
        className="form-grid"
        onSubmit={(event) =>
          submit(
            event,
            "Adding inventory comp",
            (form) => requestJson("/api/radar/inventory/comps", { method: "POST", body: JSON.stringify(formJson(form)) }),
            { reset: true, success: "Inventory comp added" }
          )
        }
      >
        <SelectInput
          name="inventoryItemId"
          label="Inventory item"
          options={items.map((item) => ({ value: item.id, label: item.itemName }))}
          required
        />
        <TextInput name="saleTitle" label="Sale title" required />
        <TextInput name="salePrice" label="Sold price" type="number" min="0" step="0.01" required />
        <TextInput name="soldAt" label="Sale date" type="date" required />
        <TextInput name="sourceUrl" label="Source URL" type="url" />
        <SelectInput name="sourceQuality" label="Source" options={compSourceQualities.map((value) => ({ value, label: formatSourceQuality(value) }))} />
        <TextInput name="matchScore" label="Confidence" type="number" min="0" max="100" defaultValue="100" />
        <TextareaInput name="notes" label="Notes" wide />
        <button className="primary-action" disabled={busy || !items.length} type="submit">
          <Plus size={16} />
          {busyLabel === "Adding inventory comp" ? "Saving" : "Add Comp"}
        </button>
      </form>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ProductsPanel({
  dashboard,
  isAdmin,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  dashboard: DashboardDTO;
  isAdmin: boolean;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const [filters, setFilters] = useState({
    highOnly: false,
    pokemonCenterExclusive: false,
    productType: "ALL"
  });
  const filteredProducts = useMemo(
    () =>
      dashboard.products.filter((product) => {
        if (filters.highOnly && (product.priorityScore?.score ?? 0) < 70) return false;
        if (filters.pokemonCenterExclusive && !product.pokemonCenterExclusiveVersion) return false;
        if (filters.productType !== "ALL" && product.productType !== filters.productType) return false;
        return true;
      }),
    [dashboard.products, filters]
  );

  function updateFilter(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, type, value } = event.currentTarget;
    setFilters((current) => ({
      ...current,
      [name]: type === "checkbox" ? (event.currentTarget as HTMLInputElement).checked : value
    }));
  }

  return (
    <>
      <SectionIntro
        title="Products"
        detail="Your online watchlist. Work from the cards below; setup, imports, and logs are tucked away."
        stats={[
          { label: "tracked", value: dashboard.products.length },
          { label: "shown", value: filteredProducts.length },
          { label: "ready", value: dashboard.products.filter(productReadyForAlert).length, tone: "good" }
        ]}
      />
      {isAdmin ? (
        <div className="simple-action-row">
          <button
            className="primary-action compact-action"
            disabled={busy}
            type="button"
            onClick={() =>
              runAction(
                "Running due checks",
                () =>
                  requestJson("/api/radar/monitor/run", {
                    method: "POST",
                    body: JSON.stringify({ mode: "due" })
                  }),
                { success: "Due checks finished" }
              )
            }
          >
            <Play size={15} />
            {busyLabel === "Running due checks" ? "Running" : "Run Checks"}
          </button>
          <button
            className="mini-action"
            disabled={busy}
            type="button"
            onClick={() =>
              runAction(
                "Running all checks",
                () =>
                  requestJson("/api/radar/monitor/run", {
                    method: "POST",
                    body: JSON.stringify({ mode: "all" })
                  }),
                { success: "All checks finished" }
              )
            }
          >
            <RefreshCw size={14} />
            {busyLabel === "Running all checks" ? "Running" : "Run All"}
          </button>
        </div>
      ) : null}
      <ScannerStatusPanel dashboard={dashboard} />
      <section className="form-panel">
        <div className="edit-card-heading">
          <div>
            <h2>Filters</h2>
            <span>{filteredProducts.length} products shown</span>
          </div>
        </div>
        <div className="field-filter-grid">
          <label className="checkbox-label">
            <input name="highOnly" type="checkbox" checked={filters.highOnly} onChange={updateFilter} />
            High priority only
          </label>
          <label className="checkbox-label">
            <input
              name="pokemonCenterExclusive"
              type="checkbox"
              checked={filters.pokemonCenterExclusive}
              onChange={updateFilter}
            />
            Pokemon Center exclusive
          </label>
          <SelectInput
            name="productType"
            label="Product type"
            value={filters.productType}
            onChange={updateFilter}
            options={[{ value: "ALL", label: "All Product Types" }].concat(
              productTypeOptions.map((value) => ({ value, label: value }))
            )}
          />
        </div>
      </section>
      <ProductStack products={filteredProducts} showDiagnostics={isAdmin} />
      {isAdmin ? (
        <UtilityFold title="Product Admin" detail="Add products, verify exact links, import, edit, and review monitor logs">
          <ProductQualityPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} runAction={runAction} />
          <ProductDiscoveryPanel
            dashboard={dashboard}
            busy={busy}
            busyLabel={busyLabel}
            submit={submit}
            runAction={runAction}
          />
          <ProductSetupGuidancePanel dashboard={dashboard} />
          <ProductAddWizard dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} />
          <BulkImportPanel
            title="Bulk Product Import"
            endpoint="/api/radar/products/import"
            busy={busy}
            busyLabel={busyLabel}
            submit={submit}
            sample={`retailer,name,url,imageUrl,expectedTitleKeywords,setName,productType,sku,upc,dpci,retailerProductId,retailPrice,stockStatus,priority,rating,monitorEnabled,checkFrequencyMinutes,requiredWords,ignoreWords,releaseSetName,notes\nTarget,Pokemon TCG Booster Bundle,https://www.target.com/p/example-product/-/A-12345678,https://example.com/exact-product-image.jpg,"Mega Evolution,Booster Bundle",Mega Evolution-Chaos Rising,Booster Bundle,TARGET-123,0820650123456,087-12-1234,12345678,26.99,UNAVAILABLE,HIGH,WATCH,true,60,"Pokemon,Booster","sponsored,marketplace",Mega Evolution-Chaos Rising,Manual checkout only`}
          />
          <section className="form-panel">
            <h2>Edit Products</h2>
            <div className="edit-stack">
              {dashboard.products.length ? (
                dashboard.products.map((product) => (
                  <EditableProduct
                    key={product.id}
                    product={product}
                    retailers={dashboard.retailers}
                    releases={dashboard.releases}
                    busy={busy}
                    busyLabel={busyLabel}
                    submit={submit}
                    runAction={runAction}
                  />
                ))
              ) : (
                <EmptyState icon={PackageSearch} title="No products to edit" detail="Add a product URL first." />
              )}
            </div>
          </section>
          <MonitorAccuracyPanel dashboard={dashboard} />
          <MonitorLogsPanel dashboard={dashboard} />
        </UtilityFold>
      ) : null}
    </>
  );
}

function ScannerStatusPanel({ dashboard }: { dashboard: DashboardDTO }) {
  const status = dashboard.scannerStatus;
  return (
    <section className="scanner-status-panel">
      <div className="scanner-status-header">
        <div>
          <span className="eyeline">Restock scanner</span>
          <h2>Exact products only for BUY alerts</h2>
        </div>
        <span className="chip good">
          <Activity size={12} />
          Actively scanning
        </span>
      </div>
      <div className="scanner-stat-grid">
        <div>
          <strong>{status.cronActive ? "Active" : "Quiet"}</strong>
          <span>cron status</span>
        </div>
        <div>
          <strong>{status.activeProductsScanned}</strong>
          <span>exact products</span>
        </div>
        <div>
          <strong>{status.activeDiscoverySourcesScanned}</strong>
          <span>discovery sources</span>
        </div>
        <div>
          <strong>{status.lastScanTime ? relativeTime(status.lastScanTime) : "None"}</strong>
          <span>last scan</span>
        </div>
        <div>
          <strong>{status.nextScanEstimate ? relativeTime(status.nextScanEstimate) : "None"}</strong>
          <span>next estimate</span>
        </div>
        <div>
          <strong>{status.newFindsPendingReview}</strong>
          <span>new finds</span>
        </div>
        <div>
          <strong>{status.liveRestocksDetectedToday}</strong>
          <span>restocks today</span>
        </div>
      </div>
    </section>
  );
}

function productQualityChecks(product: ProductDTO) {
  return {
    exactLink: product.verificationStatus === "VERIFIED_EXACT" && Boolean(product.verifiedFinalUrl || product.url),
    image: Boolean(product.liveImageUrl),
    livePrice: product.livePrice !== null && Boolean(product.livePriceVerifiedAt),
    stock: Boolean(product.liveStockStatus && product.liveStockVerifiedAt)
  };
}

function QualityChip({ value, label }: { value: boolean; label: string }) {
  return <span className={`chip ${value ? "good" : "watch"}`}>{value ? "Yes" : `No ${label}`}</span>;
}

function ProductQualityPanel({
  dashboard,
  busy,
  busyLabel,
  runAction
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  runAction: ActionHandler;
}) {
  const products = dashboard.products;
  const needsCleanup = products.filter((product) => {
    const checks = productQualityChecks(product);
    return !checks.exactLink || !checks.image || !checks.livePrice || !checks.stock || product.isDemoData;
  }).length;

  return (
    <section className="form-panel product-quality-panel">
      <div className="edit-card-heading">
        <div>
          <p className="eyeline">Production product QA</p>
          <h2>Real Product Data Cleanup</h2>
          <span>
            {products.length} active products - {needsCleanup} need review. Main app rows hide manual/sample prices unless live retailer data is verified.
          </span>
        </div>
        <span className={`chip ${needsCleanup ? "watch" : "good"}`}>{needsCleanup ? "Review needed" : "Clean"}</span>
      </div>
      {products.length ? (
        <div className="product-qa-list" role="table" aria-label="Product QA">
          <div className="product-qa-row product-qa-head" role="row">
            <span>Product</span>
            <span>Retailer</span>
            <span>Exact link</span>
            <span>Image</span>
            <span>Live price</span>
            <span>Stock</span>
            <span>Last success</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          {products.map((product) => {
            const checks = productQualityChecks(product);
            return (
              <div className="product-qa-row" role="row" key={product.id}>
                <div className="product-qa-product">
                  <ProductImage product={product} />
                  <div>
                    <strong>{product.name}</strong>
                    <small>{product.liveTitle || "Verified title not collected"}</small>
                  </div>
                </div>
                <span>{product.retailerName}</span>
                <QualityChip value={checks.exactLink} label="exact" />
                <QualityChip value={checks.image} label="image" />
                <QualityChip value={checks.livePrice} label="price" />
                <QualityChip value={checks.stock} label="stock" />
                <span>{product.lastSuccessfulCheckedAt ? relativeTime(product.lastSuccessfulCheckedAt) : "Not checked"}</span>
                <span className={`chip ${verificationTone(product.verificationStatus)}`}>{productLiveBadge(product)}</span>
                <div className="product-qa-actions">
                  <button
                    className="mini-action"
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      runAction(
                        `Verifying product ${product.id}`,
                        () => requestJson(`/api/radar/products/${product.id}/verify`, { method: "POST" }),
                        { success: "Product verification finished" }
                      )
                    }
                  >
                    <ShieldCheck size={14} />
                    {busyLabel === `Verifying product ${product.id}` ? "Verifying" : "Verify now"}
                  </button>
                  <button
                    className="mini-action"
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      runAction(
                        `${product.monitorEnabled ? "Pausing" : "Resuming"} product ${product.id}`,
                        () =>
                          requestJson(`/api/radar/products/${product.id}/monitor`, {
                            method: "POST",
                            body: JSON.stringify({ action: product.monitorEnabled ? "pause" : "resume" })
                          }),
                        { success: product.monitorEnabled ? "Monitor paused" : "Monitor resumed" }
                      )
                    }
                  >
                    {product.monitorEnabled ? "Pause" : "Resume"}
                  </button>
                  <a className="mini-action" href={`#edit-product-${product.id}`}>
                    Edit identifiers
                  </a>
                  <button
                    className="mini-action danger"
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      runAction(
                        `Archiving product ${product.id}`,
                        () => requestJson(`/api/radar/products/${product.id}/archive`, { method: "POST" }),
                        {
                          confirm: "Archive this product? It will stop appearing in dashboards and monitor batches.",
                          success: "Product archived"
                        }
                      )
                    }
                  >
                    Archive
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={PackageSearch} title="No active products" detail="Add exact product URLs, then verify them before enabling alerts." />
      )}
    </section>
  );
}

function ProductDiscoveryPanel({
  dashboard,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const [retailerFilter, setRetailerFilter] = useState("ALL");
  const pending = dashboard.productDiscoveryCandidates.filter((candidate) => candidate.status === "PENDING");
  const visibleCandidates = pending.filter((candidate) => retailerFilter === "ALL" || candidate.retailerId === retailerFilter);
  const sourceLabel = "Adding discovery source";

  return (
    <section className="form-panel discovery-panel">
      <div className="edit-card-heading">
        <div>
          <h2>Scanner Discovery</h2>
          <span>Search/category pages can only add review candidates. They never trigger Buy alerts.</span>
        </div>
      </div>
      <form
        className="discovery-source-form"
        onSubmit={(event) =>
          submit(
            event,
            sourceLabel,
            (form) => requestJson("/api/radar/product-discovery/sources", { method: "POST", body: JSON.stringify(formJson(form)) }),
            { success: "Discovery source added" }
          )
        }
      >
        <SelectInput name="retailerId" label="Retailer" options={dashboard.retailers.map(optionFromRetailer)} required />
        <TextInput name="name" label="Source name" placeholder="Target Pokemon search" required />
        <TextInput name="url" label="Discovery URL" type="url" placeholder="Retailer search or category URL" required />
        <TextInput name="checkFrequencyMinutes" label="Frequency minutes" type="number" min="30" max="10080" defaultValue="360" />
        <label className="checkbox-label">
          <input name="enabled" type="hidden" value="false" />
          <input name="enabled" type="checkbox" value="true" defaultChecked />
          Enabled
        </label>
        <label className="checkbox-label">
          <input name="runNow" type="checkbox" value="true" />
          Scan now
        </label>
        <TextareaInput name="notes" label="Notes" placeholder="Public locator/category notes" wide />
        <button className="primary-action" type="submit" disabled={busy}>
          <Plus size={15} />
          {busyLabel === sourceLabel ? "Adding" : "Add Discovery Source"}
        </button>
      </form>

      <div className="scanner-source-list">
        {dashboard.productDiscoverySources.length ? (
          dashboard.productDiscoverySources.slice(0, 6).map((source) => <DiscoverySourceRow key={source.id} source={source} />)
        ) : (
          <EmptyState icon={PackageSearch} title="No discovery sources" detail="Add safe public search/category pages for review-only discovery." />
        )}
      </div>

      <div className="edit-card-heading discovery-queue-heading">
        <div>
          <h2>Review New Finds</h2>
          <span>{visibleCandidates.length} pending candidate{visibleCandidates.length === 1 ? "" : "s"}</span>
        </div>
        <SelectInput
          name="retailerFilter"
          label="Retailer"
          value={retailerFilter}
          onChange={(event) => setRetailerFilter(event.currentTarget.value)}
          options={[{ value: "ALL", label: "All retailers" }].concat(dashboard.retailers.map(optionFromRetailer))}
        />
      </div>
      <div className="candidate-queue">
        {visibleCandidates.length ? (
          visibleCandidates.map((candidate) => (
            <DiscoveryCandidateRow
              key={candidate.id}
              candidate={candidate}
              busy={busy}
              busyLabel={busyLabel}
              runAction={runAction}
            />
          ))
        ) : (
          <EmptyState icon={PackageSearch} title="No pending finds" detail="Approved candidates become exact watched products." />
        )}
      </div>
    </section>
  );
}

function DiscoverySourceRow({ source }: { source: ProductDiscoverySourceDTO }) {
  return (
    <article className="scanner-source-row">
      <div>
        <strong>{source.name}</strong>
        <span>{source.retailerName} - every {source.checkFrequencyMinutes} min</span>
      </div>
      <span className={`chip ${source.enabled ? "good" : "muted"}`}>{source.enabled ? "Enabled" : "Paused"}</span>
      <span>{source.lastResult || "Not scanned yet"}</span>
    </article>
  );
}

function DiscoveryCandidateRow({
  candidate,
  busy,
  busyLabel,
  runAction
}: {
  candidate: ProductDiscoveryCandidateDTO;
  busy: boolean;
  busyLabel: string | null;
  runAction: ActionHandler;
}) {
  const approveLabel = `Approving discovery ${candidate.id}`;
  const ignoreLabel = `Ignoring discovery ${candidate.id}`;
  const price = candidate.livePrice === null ? "Price unknown" : money(candidate.livePrice);
  return (
    <article className="candidate-row">
      <div className="candidate-main">
        <strong>{candidate.productName}</strong>
        <span>
          {candidate.retailerName} - {candidate.productType || "Product"} - {price}
        </span>
        <a href={candidate.url} target="_blank" rel="noreferrer">
          Exact candidate link <ExternalLink size={12} />
        </a>
      </div>
      <div className="candidate-meta">
        <span className="chip watch">{candidate.confidenceScore}%</span>
        {candidate.retailerProductId ? <span className="chip good">ID {candidate.retailerProductId}</span> : <span className="chip muted">ID unknown</span>}
      </div>
      <div className="candidate-actions">
        <button
          className="mini-action solid"
          type="button"
          disabled={busy}
          onClick={() =>
            runAction(
              approveLabel,
              () =>
                requestJson(`/api/radar/product-discovery/candidates/${candidate.id}/review`, {
                  method: "POST",
                  body: JSON.stringify({ action: "approve", priority: "MEDIUM", rating: "WATCH", checkFrequencyMinutes: 60 })
                }),
              { success: "Added to watched products" }
            )
          }
        >
          <Check size={14} />
          {busyLabel === approveLabel ? "Approving" : "Approve"}
        </button>
        <button
          className="mini-action"
          type="button"
          disabled={busy}
          onClick={() =>
            runAction(
              ignoreLabel,
              () =>
                requestJson(`/api/radar/product-discovery/candidates/${candidate.id}/review`, {
                  method: "POST",
                  body: JSON.stringify({ action: "ignore", priority: "LOW", rating: "SKIP", checkFrequencyMinutes: 360 })
                }),
              { confirm: "Ignore this discovery candidate?", success: "Candidate ignored" }
            )
          }
        >
          <X size={14} />
          {busyLabel === ignoreLabel ? "Ignoring" : "Ignore"}
        </button>
      </div>
    </article>
  );
}

function ProductSetupGuidancePanel({ dashboard }: { dashboard: DashboardDTO }) {
  return (
    <section className="form-panel setup-guidance-panel">
      <PanelHeader title="Exact Product Setup" />
      <div className="setup-steps">
        <div>
          <strong>1. Paste exact product link</strong>
          <span>Use the retailer product page, not search results or category pages.</span>
        </div>
        <div>
          <strong>2. Add identifiers</strong>
          <span>Add UPC, SKU, DPCI, TCIN, ASIN, Walmart item ID, or retailer product ID when available.</span>
        </div>
        <div>
          <strong>3. Click Verify Exact Product</strong>
          <span>The app compares live title keywords, final URL, and stored identifiers.</span>
        </div>
        <div>
          <strong>4. Alert only when ready</strong>
          <span>Only verified exact products can send high-priority Buy alerts or enable Go / Buy Now.</span>
        </div>
      </div>
      <div className="monitor-meta">
        {dashboard.retailerTemplates.map((template) => (
          <span key={template.retailerName}>
            <strong>{template.retailerName}:</strong> {template.urlPatternLabel}. IDs: {template.identifierFields.join(", ")}
          </span>
        ))}
      </div>
    </section>
  );
}

function ProductAddWizard({
  dashboard,
  busy,
  busyLabel,
  submit
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
}) {
  const [step, setStep] = useState(1);
  const [retailerId, setRetailerId] = useState(dashboard.retailers[0]?.id ?? "");
  const template = templateForRetailer(retailerId, dashboard.retailers, dashboard.retailerTemplates);

  function updateRetailer(event: ChangeEvent<HTMLSelectElement>) {
    setRetailerId(event.currentTarget.value);
  }

  return (
    <section className="form-panel">
      <div className="edit-card-heading">
        <div>
          <h2>Add Product Wizard</h2>
          <span>Step {step} of 4: retailer, URL, details, then monitor settings.</span>
        </div>
        <div className="wizard-steps" aria-label="Product wizard steps">
          {[1, 2, 3, 4].map((item) => (
            <button
              className={step === item ? "wizard-dot active" : "wizard-dot"}
              key={item}
              type="button"
              onClick={() => setStep(item)}
              aria-label={`Step ${item}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <form
        className="wizard-form"
        noValidate
        onSubmit={(event) =>
          submit(
            event,
            "Adding product",
            (form) => requestJson("/api/radar/products", { method: "POST", body: JSON.stringify(formJson(form)) }),
            { success: "Product added" }
          )
        }
      >
        <fieldset className={step === 1 ? "wizard-step active" : "wizard-step"}>
          <SelectInput
            name="retailerId"
            label="Retailer"
            value={retailerId}
            onChange={updateRetailer}
            options={dashboard.retailers.map(optionFromRetailer)}
            required
          />
          {template ? (
            <div className="template-hint">
              <strong>{template.retailerName} template</strong>
              <span>{template.monitorNotes}</span>
              <span>Expected URL: {template.urlPatternLabel}</span>
              <span>Useful IDs: {template.identifierFields.join(", ")}</span>
            </div>
          ) : null}
        </fieldset>
        <fieldset className={step === 2 ? "wizard-step active" : "wizard-step"}>
          <TextInput name="url" label="Exact retailer product URL" type="url" placeholder="https://..." required />
          <div className="template-hint warning">
            <strong>Exact product links give better alerts than search/category links.</strong>
            <span>Use the retailer product page that contains the SKU, UPC, DPCI, TCIN, ASIN, or item ID when available.</span>
          </div>
          {template?.retailerName === "Target" ? (
            <div className="template-hint">
              <strong>Target tip</strong>
              <span>Use the product page link, not the search results page.</span>
              <span>Target exact links usually look like target.com/p/.../-/A-TCIN.</span>
            </div>
          ) : null}
          {template ? (
            <div className="template-hint">
              <strong>Public cues monitored</strong>
              <span>Sold out: {template.statusWords.soldOut.join(", ")}</span>
              <span>In stock: {template.statusWords.inStock.join(", ")}</span>
              <span>Add-to-cart: {template.statusWords.addToCart.join(", ")}</span>
              <span>Blocked/captcha: {template.statusWords.pageBlocked.concat(template.statusWords.captcha).slice(0, 4).join(", ")}</span>
            </div>
          ) : null}
        </fieldset>
        <fieldset className={step === 3 ? "wizard-step active" : "wizard-step"}>
          <div className="form-grid">
            <TextInput name="name" label="Product name" placeholder="Pokemon TCG Booster Bundle" required />
            <SelectInput name="releaseId" label="Release / set" options={releaseOptions(dashboard.releases)} />
            <SelectInput
              name="productType"
              label="Product type"
              options={productTypeOptions.map((value) => ({ value, label: value }))}
            />
            <TextInput name="setName" label="Set name" placeholder="Mega Evolution-Chaos Rising" />
            <TextInput name="imageUrl" label="Product image URL" type="url" placeholder="Auto-filled by Verify Link when possible" />
            <TextareaInput
              name="expectedTitleKeywords"
              label="Expected title keywords"
              placeholder="Mega Evolution, Chaos Rising, Booster Bundle"
              wide
            />
            <TextInput name="sku" label="SKU / ASIN / TCIN" />
            <TextInput name="upc" label="UPC" inputMode="numeric" placeholder="8 to 14 digits" />
            <TextInput name="dpci" label="DPCI" placeholder="087-12-1234" />
            <TextInput name="retailerProductId" label="Retailer product ID" placeholder="TCIN, offer ID, item ID" />
            <TextInput name="retailPrice" label="Retail price" type="number" min="0" max="100000" step="0.01" />
          </div>
        </fieldset>
        <fieldset className={step === 4 ? "wizard-step active" : "wizard-step"}>
          <div className="form-grid">
            <SelectInput name="stockStatus" label="Starting status" options={productStatuses.map(optionFromString)} />
            <SelectInput
              key={`priority-${retailerId}`}
              name="priority"
              label="Alert priority"
              defaultValue={template?.alertPriorityDefault ?? "MEDIUM"}
              options={priorities.map(optionFromString)}
            />
            <SelectInput name="rating" label="Manual override" options={productRatings.map(optionFromString)} />
            <SelectInput name="manualPriorityOverride" label="Priority override" options={productRatings.map(optionFromString)} />
            <TextInput
              name="checkFrequencyMinutes"
              label="Check frequency minutes"
              type="number"
              min="15"
              max="10080"
              defaultValue="60"
            />
            <label className="checkbox-label">
              <input name="monitorEnabled" type="hidden" value="false" />
              <input name="monitorEnabled" type="checkbox" value="true" defaultChecked />
              Monitor this product
            </label>
            <TextareaInput name="notes" label="Notes" wide />
            <TextareaInput
              name="requiredWords"
              label="Required words"
              placeholder="Pokemon, Elite Trainer Box"
              wide
            />
            <TextareaInput name="ignoreWords" label="Ignore words" placeholder="sponsored, marketplace" wide />
            <TextareaInput name="sealedResaleNotes" label="Sealed resale notes" wide />
            <TextareaInput name="scarcityNotes" label="Scarcity notes" wide />
          </div>
        </fieldset>
        <div className="form-actions">
          <button className="mini-action" type="button" disabled={busy || step === 1} onClick={() => setStep((value) => value - 1)}>
            Back
          </button>
          {step < 4 ? (
            <button className="mini-action solid" type="button" disabled={busy} onClick={() => setStep((value) => value + 1)}>
              Next
            </button>
          ) : (
            <button className="primary-action" disabled={busy} type="submit">
              <Plus size={16} />
              {busyLabel === "Adding product" ? "Adding" : "Add Product"}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function BulkImportPanel({
  title,
  endpoint,
  sample,
  busy,
  busyLabel,
  submit
}: {
  title: string;
  endpoint: string;
  sample: string;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
}) {
  const label = `Importing ${title}`;
  return (
    <section className="form-panel">
      <div className="edit-card-heading">
        <div>
          <h2>{title}</h2>
          <span>Paste CSV with headers or a JSON array using the same field names.</span>
        </div>
      </div>
      <form
        className="backup-form"
        onSubmit={(event) =>
          submit(
            event,
            label,
            async (form) => {
              const result = await requestJson<{ created: number; failed: number; errors: string[] }>(endpoint, {
                method: "POST",
                body: JSON.stringify(formJson(form))
              });
              if (result.failed > 0) {
                throw new Error(`Imported ${result.created}; ${result.failed} failed. ${result.errors.slice(0, 2).join(" ")}`);
              }
              return result;
            },
            { success: `${title} complete` }
          )
        }
      >
        <SelectInput
          name="format"
          label="Import format"
          defaultValue="csv"
          options={[
            { value: "csv", label: "CSV" },
            { value: "json", label: "JSON" }
          ]}
        />
        <label>
          Import data
          <textarea name="data" rows={7} defaultValue={sample} />
        </label>
        <button className="primary-action" disabled={busy} type="submit">
          <Upload size={16} />
          {busyLabel === label ? "Importing" : "Import"}
        </button>
      </form>
    </section>
  );
}

function EditableProduct({
  product,
  retailers,
  releases,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  product: ProductDTO;
  retailers: RetailerDTO[];
  releases: ReleaseDTO[];
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const saveLabel = `Saving product ${product.id}`;
  const goUrl = exactProductUrl(product);
  const readyForAlert = productReadyForAlert(product);
  return (
    <form
      className="edit-card"
      id={`edit-product-${product.id}`}
      onSubmit={(event) =>
        submit(
          event,
          saveLabel,
          (form) =>
            requestJson(`/api/radar/products/${product.id}`, {
              method: "PATCH",
              body: JSON.stringify(formJson(form))
            }),
          { reset: false, success: "Product saved" }
        )
      }
    >
      <div className="edit-card-heading">
        <div>
          <strong>{product.name}</strong>
          <span>
            {product.retailerName} - Score {product.priorityScore?.score ?? 0}
          </span>
        </div>
        <div className="row-actions">
          <span className={`chip ${verificationTone(product.verificationStatus)}`}>
            {productVerificationLabel(product.verificationStatus)}
          </span>
          <span className={`chip ${productLiveVerified(product) ? "good" : product.liveBlockedType ? "bad" : "watch"}`}>
            {productLiveBadge(product)}
          </span>
          {product.isDemoData ? <span className="chip muted">Demo data</span> : null}
          {readyForAlert ? <span className="chip good">Ready for Alert</span> : null}
          {goUrl ? (
            <a className="mini-action" href={goUrl} target="_blank" rel="noreferrer">
              Go <ExternalLink size={14} />
            </a>
          ) : (
            <span className="mini-action disabled">Verify exact link first</span>
          )}
        </div>
      </div>
      <div className="form-grid">
        <TextInput name="name" label="Product name" defaultValue={product.name} required />
        <SelectInput
          name="retailerId"
          label="Retailer"
          defaultValue={product.retailerId}
          options={retailers.map(optionFromRetailer)}
        />
        <SelectInput
          name="releaseId"
          label="Release / set"
          defaultValue={product.releaseId ?? ""}
          options={releaseOptions(releases)}
        />
        <SelectInput
          name="productType"
          label="Product type"
          defaultValue={product.productType ?? productTypeOptions[0]}
          options={productTypeOptions.map((value) => ({ value, label: value }))}
        />
        <TextInput name="setName" label="Set name" defaultValue={product.setName ?? ""} />
        <TextInput name="url" label="Exact product URL" type="url" defaultValue={product.url} required />
        <TextInput name="imageUrl" label="Product image URL" type="url" defaultValue={product.imageUrl ?? ""} />
        <TextareaInput
          name="expectedTitleKeywords"
          label="Expected title keywords"
          defaultValue={product.expectedTitleKeywords ?? ""}
          placeholder="Mega Evolution, Chaos Rising, Booster Bundle"
          wide
        />
        <TextInput name="sku" label="SKU / ASIN / TCIN" defaultValue={product.sku ?? ""} />
        <TextInput name="upc" label="UPC" inputMode="numeric" defaultValue={product.upc ?? ""} />
        <TextInput name="dpci" label="DPCI" defaultValue={product.dpci ?? ""} />
        <TextInput name="retailerProductId" label="Retailer product ID / TCIN / item ID" defaultValue={product.retailerProductId ?? ""} />
        <TextInput
          name="retailPrice"
          label="Retail price"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={product.retailPrice ?? ""}
        />
        <SelectInput
          name="stockStatus"
          label="Status"
          defaultValue={product.stockStatus}
          options={productStatuses.map(optionFromString)}
        />
        <SelectInput name="priority" label="Priority" defaultValue={product.priority} options={priorities.map(optionFromString)} />
        <SelectInput
          name="rating"
          label="Manual override"
          defaultValue={product.rating === "AVOID" ? "WATCH" : product.rating}
          options={productRatings.map(optionFromString)}
        />
        <SelectInput
          name="manualPriorityOverride"
          label="Priority override"
          defaultValue={product.manualPriorityOverride ?? (product.rating === "AVOID" ? "WATCH" : product.rating)}
          options={productRatings.map(optionFromString)}
        />
        <TextInput
          name="checkFrequencyMinutes"
          label="Check frequency minutes"
          type="number"
          min="15"
          max="10080"
          defaultValue={product.checkFrequencyMinutes}
        />
        <label className="checkbox-label">
          <input name="monitorEnabled" type="hidden" value="false" />
          <input name="monitorEnabled" type="checkbox" value="true" defaultChecked={product.monitorEnabled} />
          Monitor this product
        </label>
        <TextareaInput name="reason" label="Reason for alert/history" placeholder="Optional" wide />
        <TextareaInput name="notes" label="Notes" defaultValue={product.notes ?? ""} wide />
        <TextareaInput
          name="requiredWords"
          label="Required words"
          defaultValue={product.requiredWords ?? ""}
          placeholder="Pokemon, Elite Trainer Box"
          wide
        />
        <TextareaInput
          name="ignoreWords"
          label="Ignore words"
          defaultValue={product.ignoreWords ?? ""}
          placeholder="sponsored, marketplace, unrelated set"
          wide
        />
        <TextareaInput name="sealedResaleNotes" label="Sealed resale notes" defaultValue={product.sealedResaleNotes ?? ""} wide />
        <TextareaInput name="scarcityNotes" label="Scarcity notes" defaultValue={product.scarcityNotes ?? ""} wide />
      </div>
      {product.priorityScore ? <p className="reason-text">{product.priorityScore.reason}</p> : null}
      <div className="monitor-status">
        <span>Verification: {productVerificationLabel(product.verificationStatus)}</span>
        <span>Ready for alert: {readyForAlert ? "Yes" : "No"}</span>
        <span>Live retailer price: {product.livePrice !== null ? money(product.livePrice) : "Price not verified"}</span>
        <span>Stored/manual price: {product.retailPrice !== null ? money(product.retailPrice) : "Unknown"}</span>
        <span>Live stock: {product.liveStockStatus ? formatStatus(product.liveStockStatus) : "Not verified"}</span>
        <span>Live source: {product.livePriceSource || "Unknown"}</span>
        <span>Live confidence: {product.liveConfidenceScore === null ? "Unknown" : `${product.liveConfidenceScore}%`}</span>
        <span>Live title: {product.liveTitle || "Unknown"}</span>
        <span>Verified: {dateTime(product.verifiedAt)}</span>
        <span>Final URL: {product.verifiedFinalUrl || "Not verified"}</span>
        <span>Verification notes: {product.verificationNotes || "None"}</span>
        <span>Last checked: {dateTime(product.lastCheckedAt)}</span>
        <span>Last successful: {dateTime(product.lastSuccessfulCheckedAt)}</span>
        <span>Next estimate: {dateTime(product.nextCheckAt)}</span>
        <span>Last result: {product.lastMonitorResult || "Not checked by monitor yet"}</span>
        <span>Last error: {product.lastMonitorError || "None"}</span>
        <span>Alert sent: {product.lastAlertSentAt ? dateTime(product.lastAlertSentAt) : "No"}</span>
        <span>Confidence pending: {product.pendingAlertConfidence === null ? "None" : `${product.pendingAlertConfidence}%`}</span>
      </div>
      {product.pendingAlertStatus ? (
        <p className="reason-text">
          Low-confidence alert protection is waiting for a second matching {formatStatus(product.pendingAlertStatus)} check.
          Evidence: {product.pendingAlertDetectedWords || "No detected words captured"}.
        </p>
      ) : null}
      <div className="form-actions">
        <button
          className="mini-action solid"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              `Mark checked ${product.id}`,
              () =>
                requestJson(`/api/radar/products/${product.id}/checked`, {
                  method: "POST",
                  body: JSON.stringify({ note: "Marked checked today from product workflow." })
                }),
              { success: "Product marked checked today" }
            )
          }
        >
          <Check size={14} />
          {busyLabel === `Mark checked ${product.id}` ? "Saving" : "Mark Checked Today"}
        </button>
        <button
          className="mini-action solid"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              `Bought product ${product.id}`,
              () =>
                requestJson(`/api/radar/products/${product.id}/bought`, {
                  method: "POST",
                  body: JSON.stringify({
                    cost: product.retailPrice ?? 0,
                    quantity: 1,
                    source: product.retailerName,
                    expectedPlan: "Hold sealed or review card comps before resale.",
                    notes: "Logged from I bought this workflow."
                  })
                }),
              { confirm: `Log one purchase of ${product.name}?`, success: "Purchase logged to inventory" }
            )
          }
        >
          <Trophy size={14} />
          {busyLabel === `Bought product ${product.id}` ? "Logging" : "I Bought This"}
        </button>
        <button
          className="mini-action"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              `Verifying product ${product.id}`,
              () => requestJson(`/api/radar/products/${product.id}/verify`, { method: "POST" }),
              { success: "Product link verification finished" }
            )
          }
        >
          <ShieldCheck size={14} />
          {busyLabel === `Verifying product ${product.id}` ? "Verifying" : "Verify Exact Product"}
        </button>
        <button
          className="mini-action"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              `Checking product ${product.id}`,
              () => requestJson(`/api/radar/products/${product.id}/check`, { method: "POST" }),
              { success: "Product check finished" }
            )
          }
        >
          <Play size={14} />
          {busyLabel === `Checking product ${product.id}` ? "Checking" : "Run Check Now"}
        </button>
        <button
          className="mini-action"
          disabled={busy || !readyForAlert}
          type="button"
          onClick={() =>
            runAction(
              `${product.monitorEnabled ? "Pausing" : "Resuming"} product ${product.id}`,
              () =>
                requestJson(`/api/radar/products/${product.id}/monitor`, {
                  method: "POST",
                  body: JSON.stringify({ action: product.monitorEnabled ? "pause" : "resume" })
                }),
              { success: product.monitorEnabled ? "Monitor paused" : "Monitor resumed" }
            )
          }
        >
          {product.monitorEnabled ? <WifiOff size={14} /> : <Wifi size={14} />}
          {busyLabel === `${product.monitorEnabled ? "Pausing" : "Resuming"} product ${product.id}`
            ? "Saving"
            : product.monitorEnabled
              ? "Pause Monitor"
              : "Resume Monitor"}
        </button>
        <button
          className="mini-action"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              `Force alert ${product.id}`,
              () =>
                requestJson(`/api/radar/products/${product.id}/monitor`, {
                  method: "POST",
                  body: JSON.stringify({ action: "force_alert", reason: "Admin forced alert from product controls." })
                }),
              {
                confirm: `Send a manual forced alert for ${product.name}?`,
                success: "Forced alert sent"
              }
            )
          }
        >
          <Bell size={14} />
          Force Alert
        </button>
        <button
          className="mini-action"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              `False positive ${product.id}`,
              () =>
                requestJson(`/api/radar/products/${product.id}/monitor`, {
                  method: "POST",
                  body: JSON.stringify({ action: "mark_false_positive", reason: "Admin marked false positive from product controls." })
                }),
              {
                confirm: `Mark the latest monitor signal for ${product.name} as a false positive?`,
                success: "False positive logged"
              }
            )
          }
        >
          <X size={14} />
          Mark False Positive
        </button>
        <button className="mini-action solid" disabled={busy} type="submit">
          <Save size={14} />
          {busyLabel === saveLabel ? "Saving" : "Save"}
        </button>
        <button
          className="mini-action danger"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              `Deleting product ${product.id}`,
              () => requestJson(`/api/radar/products/${product.id}`, { method: "DELETE" }),
              {
                confirm: `Delete ${product.name}? This also removes its restock snapshots.`,
                success: "Product deleted"
              }
            )
          }
        >
          <Trash2 size={14} />
          Delete
        </button>
      </div>
    </form>
  );
}

function MonitorAccuracyPanel({ dashboard }: { dashboard: DashboardDTO }) {
  const stats = dashboard.monitorAccuracyStats;
  const successRate = stats.totalChecks ? Math.round((stats.successfulChecks / stats.totalChecks) * 100) : 0;
  return (
    <section className="form-panel">
      <PanelHeader title="Monitor Accuracy Stats" />
      <div className="accuracy-grid">
        <StatCard label="Total checks" value={stats.totalChecks} detail={`${successRate}% successful`} />
        <StatCard label="Successful checks" value={stats.successfulChecks} detail="Parsed public pages" />
        <StatCard label="Blocked checks" value={stats.blockedChecks} detail="No alerts sent" />
        <StatCard label="False positives" value={stats.falsePositives} detail="Admin-marked" />
        <StatCard label="Confirmed restocks" value={stats.confirmedRestocks} detail="History snapshots" />
      </div>
    </section>
  );
}

function MonitorLogsPanel({ dashboard }: { dashboard: DashboardDTO }) {
  return (
    <section className="form-panel">
      <PanelHeader title="Production Monitor Run Logs" />
      <p className="push-copy">
        Last cron signal {relativeTime(dashboard.health?.monitor.lastRunAt)}; unauthenticated cron requests must return 401.
      </p>
      <div className="table-list monitor-logs">
        {dashboard.monitorLogs.length ? (
          dashboard.monitorLogs.map((log) => {
            const parsedStockText = monitorDetail(log.detectedWords, "parsed stock text");
            const addToCartEnabled = monitorDetail(log.detectedWords, "add-to-cart enabled");
            return (
              <article className="table-row monitor-log-row" key={log.id}>
                <span className={`chip ${statusTone(log.status)}`}>{formatStatus(log.status)}</span>
                <strong>{log.productName || "Batch job"}</strong>
                <span>{log.changeSummary || log.error || log.reason || "No detail"}</span>
                <span>{dateTime(log.startedAt)}</span>
                <span>{log.alertSent ? "Alert sent" : "No alert"}</span>
                <details className="monitor-details">
                  <summary>Details</summary>
                  <div>
                    <span>Detected: {log.detectedStatus || "None"}</span>
                    <span>Parsed live price: {log.detectedPrice === null ? "Not verified" : money(log.detectedPrice)}</span>
                    <span>Parsed stock text: {parsedStockText || "Not found"}</span>
                    <span>Add-to-cart enabled: {addToCartEnabled || "Unknown"}</span>
                    <span>HTTP: {log.httpStatus ?? "N/A"}</span>
                    <span>Final URL: {log.finalUrl || "N/A"}</span>
                    <span>Response: {log.responseTimeMs === null ? "N/A" : `${log.responseTimeMs}ms`}</span>
                    <span>Confidence: {log.confidenceScore === null ? "N/A" : `${log.confidenceScore}%`}</span>
                    <span>Words: {log.detectedWords || "None"}</span>
                    <span>Reason: {log.reason || log.error || "None"}</span>
                    <span>Blocked: {log.blockedType || "No"}</span>
                  </div>
                </details>
              </article>
            );
          })
        ) : (
          <EmptyState icon={History} title="No monitor logs" detail="Run a product check to create the first log entry." />
        )}
      </div>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function StoresPanel({
  dashboard,
  isAdmin,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  dashboard: DashboardDTO;
  isAdmin: boolean;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const [filters, setFilters] = useState<StoreFilterState>({
    highOnly: false,
    todayOnly: false,
    nearMe: true,
    favoritesOnly: false,
    retailer: "ALL"
  });
  const preferredZone = dashboard.userAreaPreferences.preferredZone;
  const filteredStores = useMemo(
    () =>
      dashboard.stores
        .filter((store) => storeMatchesFilters(store, filters, preferredZone))
        .sort(
          (a, b) =>
            Number(b.isFavorite) - Number(a.isFavorite) ||
            a.distanceRank - b.distanceRank ||
            b.prediction.confidenceScore - a.prediction.confidenceScore ||
            a.storeName.localeCompare(b.storeName)
        ),
    [dashboard.stores, filters, preferredZone]
  );

  function updateFilter(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, type, value } = event.currentTarget;
    setFilters((current) => ({
      ...current,
      [name]: type === "checkbox" ? (event.currentTarget as HTMLInputElement).checked : value
    }));
  }

  return (
    <>
      <SectionIntro
        title="Stores"
        detail="Closest and favorite stores first. Use this list to decide where to go, then log what you saw."
        stats={[
          { label: "saved", value: dashboard.stores.length },
          { label: "shown", value: filteredStores.length },
          { label: "favorites", value: dashboard.stores.filter((store) => store.isFavorite).length, tone: "watch" }
        ]}
      />
      <StoreCoveragePanel dashboard={dashboard} />
      <section className="form-panel">
        <div className="edit-card-heading">
          <div>
            <h2>Filters</h2>
            <span>{filteredStores.length} stores shown</span>
          </div>
        </div>
        <div className="field-filter-grid">
          <label className="checkbox-label">
            <input name="highOnly" type="checkbox" checked={filters.highOnly} onChange={updateFilter} />
            High probability only
          </label>
          <label className="checkbox-label">
            <input name="todayOnly" type="checkbox" checked={filters.todayOnly} onChange={updateFilter} />
            Today only
          </label>
          <label className="checkbox-label">
            <input name="nearMe" type="checkbox" checked={filters.nearMe} onChange={updateFilter} />
            Nearby Hidden
          </label>
          <label className="checkbox-label">
            <input name="favoritesOnly" type="checkbox" checked={filters.favoritesOnly} onChange={updateFilter} />
            Favorites
          </label>
          <SelectInput
            name="retailer"
            label="Retailer"
            value={filters.retailer}
            onChange={updateFilter}
            options={fieldRetailerFilters.map((value) => ({ value, label: value === "ALL" ? "All retailers" : value }))}
          />
        </div>
      </section>
      <StoreStack
        stores={filteredStores}
        compact
        busy={busy}
        busyLabel={busyLabel}
        runAction={runAction}
        showPreferenceActions
      />
      <section className="form-panel">
        <h2>Quick Sighting</h2>
        <form
          className="form-grid"
          onSubmit={(event) =>
            submit(
              event,
              "Logging sighting",
              (form) => requestJson("/api/radar/sightings", { method: "POST", body: JSON.stringify(formJson(form)) }),
              { success: "Sighting logged" }
            )
          }
        >
          <StoreSelectInput name="storeId" label="Store" stores={dashboard.stores} />
          <TextInput name="productSeen" label="Product seen" placeholder="Booster Bundle" required />
          <SelectInput name="resultType" label="Result" options={storeVisitResults.map(optionFromString)} />
          <TextInput name="seenAt" label="Date/time" type="datetime-local" defaultValue={todayLocalInput()} required />
          <TextInput name="quantityEstimate" label="Quantity estimate" placeholder="6-10" required />
          <TextInput name="shelfPhotoUrl" label="Shelf photo URL" type="url" placeholder="Optional" />
          <TextareaInput name="notes" label="Notes" wide />
          <button className="primary-action" disabled={busy || dashboard.stores.length === 0} type="submit">
            <Plus size={16} />
            {busyLabel === "Logging sighting" ? "Logging" : "Log Sighting"}
          </button>
        </form>
      </section>
      <UtilityFold title="Area And Discovery" detail="Location, zones, find nearby stores, and store visit history">
        <AreaSetupPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} runAction={runAction} />
        <StoreDiscoveryPanel dashboard={dashboard} isAdmin={isAdmin} busy={busy} busyLabel={busyLabel} runAction={runAction} />
        <section className="form-panel">
          <h2>Store Visit History</h2>
          <div className="edit-stack">
            {dashboard.sightings.length ? (
              dashboard.sightings.map((sighting) => (
                <EditableSighting
                  key={sighting.id}
                  sighting={sighting}
                  stores={dashboard.stores}
                  canEdit={isAdmin || sighting.userId === dashboard.currentUser.id}
                  busy={busy}
                  busyLabel={busyLabel}
                  submit={submit}
                  runAction={runAction}
                />
              ))
            ) : (
              <EmptyState icon={MapPin} title="No sightings yet" detail="Log the first confirmed shelf sighting." />
            )}
          </div>
        </section>
      </UtilityFold>
      {isAdmin ? (
        <UtilityFold title="Store Admin" detail="Add, import, edit, and tune local store records">
          <section className="form-panel">
            <h2>Add Local Store</h2>
            <form
              className="form-grid"
              onSubmit={(event) =>
                submit(
                  event,
                  "Adding store",
                  (form) => requestJson("/api/radar/stores", { method: "POST", body: JSON.stringify(formJson(form)) }),
                  { success: "Store added" }
                )
              }
            >
              <SelectInput name="retailerId" label="Retailer" options={dashboard.retailers.map(optionFromRetailer)} />
              <TextInput name="storeName" label="Store name" required />
              <TextInput name="address" label="Address" required />
              <TextInput name="city" label="City" required />
              <TextInput name="state" label="State" maxLength={24} required />
              <SelectInput name="zone" label="Zone" defaultValue={dashboard.userAreaPreferences.preferredZone} options={dashboard.zoneOptions} />
              <TextInput name="latitude" label="Latitude" type="number" min="-90" max="90" step="0.000001" />
              <TextInput name="longitude" label="Longitude" type="number" min="-180" max="180" step="0.000001" />
              <TextInput name="typicalRestockDays" label="Restock days" placeholder="Tuesday,Friday" required />
              <TextInput name="typicalRestockTimeWindow" label="Restock window" placeholder="8:00 AM - 11:00 AM" required />
              <TextInput name="confidenceScore" label="Confidence" type="number" min="0" max="100" defaultValue="60" />
              <TextareaInput name="vendorNotes" label="Vendor notes" wide />
              <TextareaInput name="notes" label="Notes" wide />
              <button className="primary-action" disabled={busy} type="submit">
                <Plus size={16} />
                {busyLabel === "Adding store" ? "Adding" : "Add Store"}
              </button>
            </form>
          </section>
          <BulkImportPanel
            title="Bulk Store Import"
            endpoint="/api/radar/stores/import"
            busy={busy}
            busyLabel={busyLabel}
            submit={submit}
            sample={`retailer,storeName,address,city,state,zip,latitude,longitude,phone,notes\nTarget,Target Midtown Miami,3401 N Miami Ave,Miami,FL,33127,25.8072,-80.1937,+13055551212,Manual visit log only\nWalmart,Walmart Doral,8651 NW 13th Ter,Doral,FL,33126,25.7855,-80.337,+13055551213,Check card aisle and front collectibles shelf`}
          />
          <section className="form-panel">
            <h2>Edit Stores</h2>
            <div className="edit-stack">
              {dashboard.stores.length ? (
                dashboard.stores.map((store) => (
                  <EditableStore
                    key={store.id}
                    store={store}
                    retailers={dashboard.retailers}
                    zoneOptions={dashboard.zoneOptions}
                    busy={busy}
                    busyLabel={busyLabel}
                    submit={submit}
                    runAction={runAction}
                  />
                ))
              ) : (
                <EmptyState icon={Store} title="No stores to edit" detail="Add a local store first." />
              )}
            </div>
          </section>
        </UtilityFold>
      ) : null}
    </>
  );
}

function EditableStore({
  store,
  retailers,
  zoneOptions,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  store: StoreDTO;
  retailers: RetailerDTO[];
  zoneOptions: DashboardDTO["zoneOptions"];
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const saveLabel = `Saving store ${store.id}`;
  return (
    <form
      className="edit-card"
      onSubmit={(event) =>
        submit(
          event,
          saveLabel,
          (form) =>
            requestJson(`/api/radar/stores/${store.id}`, {
              method: "PATCH",
              body: JSON.stringify(formJson(form))
            }),
          { reset: false, success: "Store saved" }
        )
      }
    >
      <div className="edit-card-heading">
        <div>
          <strong>{store.storeName}</strong>
          <span>
            {store.city}, {store.state} - {store.prediction.probability}
          </span>
        </div>
        <span className={`chip ${statusTone(store.prediction.probability)}`}>{store.prediction.confidenceScore}%</span>
      </div>
      <div className="form-grid">
        <SelectInput
          name="retailerId"
          label="Retailer"
          defaultValue={store.retailerId}
          options={retailers.map(optionFromRetailer)}
        />
        <TextInput name="storeName" label="Store name" defaultValue={store.storeName} required />
        <TextInput name="address" label="Address" defaultValue={store.address} required />
        <TextInput name="city" label="City" defaultValue={store.city} required />
        <TextInput name="state" label="State" maxLength={24} defaultValue={store.state} required />
        <SelectInput name="zone" label="Zone" defaultValue={store.zone} options={zoneOptions} />
        <TextInput name="latitude" label="Latitude" type="number" min="-90" max="90" step="0.000001" defaultValue={store.latitude ?? ""} />
        <TextInput
          name="longitude"
          label="Longitude"
          type="number"
          min="-180"
          max="180"
          step="0.000001"
          defaultValue={store.longitude ?? ""}
        />
        <TextInput name="typicalRestockDays" label="Restock days" defaultValue={store.typicalRestockDays} required />
        <TextInput
          name="typicalRestockTimeWindow"
          label="Restock window"
          defaultValue={store.typicalRestockTimeWindow}
          required
        />
        <TextInput
          name="confidenceScore"
          label="Confidence"
          type="number"
          min="0"
          max="100"
          defaultValue={store.confidenceScore}
        />
        <TextareaInput name="vendorNotes" label="Vendor notes" defaultValue={store.vendorNotes ?? ""} wide />
        <TextareaInput name="notes" label="Notes" defaultValue={store.notes ?? ""} wide />
      </div>
      <div className="form-actions">
        <button className="mini-action solid" disabled={busy} type="submit">
          <Save size={14} />
          {busyLabel === saveLabel ? "Saving" : "Save"}
        </button>
        <button
          className="mini-action danger"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(`Deleting store ${store.id}`, () => requestJson(`/api/radar/stores/${store.id}`, { method: "DELETE" }), {
              confirm: `Delete ${store.storeName}? This also removes its sightings.`,
              success: "Store deleted"
            })
          }
        >
          <Trash2 size={14} />
          Delete
        </button>
      </div>
    </form>
  );
}

function EditableSighting({
  sighting,
  stores,
  canEdit,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  sighting: SightingDTO;
  stores: StoreDTO[];
  canEdit: boolean;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  if (!canEdit) {
    return (
      <article className="data-card">
        <div className="card-main">
          <div className="avatar">
            <MapPin size={16} />
          </div>
          <div>
            <h3>{sighting.productSeen}</h3>
            <p>
              {sighting.storeName} - {formatStatus(sighting.resultType)} - {dateTime(sighting.seenAt)} -{" "}
              {sighting.quantityEstimate}
            </p>
          </div>
        </div>
        <span className={`chip ${statusTone(sighting.resultType)}`}>{formatStatus(sighting.resultType)}</span>
      </article>
    );
  }

  const saveLabel = `Saving sighting ${sighting.id}`;
  return (
    <form
      className="edit-card"
      onSubmit={(event) =>
        submit(
          event,
          saveLabel,
          (form) =>
            requestJson(`/api/radar/sightings/${sighting.id}`, {
              method: "PATCH",
              body: JSON.stringify(formJson(form))
            }),
          { reset: false, success: "Sighting saved" }
        )
      }
    >
      <div className="edit-card-heading">
        <div>
          <strong>{sighting.productSeen}</strong>
          <span>
            {sighting.storeName} - {formatStatus(sighting.resultType)} - logged by {sighting.userName}
          </span>
        </div>
        <span className="chip muted">{dateTime(sighting.seenAt)}</span>
      </div>
      <div className="form-grid">
        <StoreSelectInput name="storeId" label="Store" stores={stores} defaultValue={sighting.storeId} />
        <TextInput name="productSeen" label="Product seen" defaultValue={sighting.productSeen} required />
        <SelectInput
          name="resultType"
          label="Result"
          defaultValue={sighting.resultType}
          options={storeVisitResults.map(optionFromString)}
        />
        <TextInput name="seenAt" label="Date/time" type="datetime-local" defaultValue={toDateTimeInput(sighting.seenAt)} required />
        <TextInput name="quantityEstimate" label="Quantity estimate" defaultValue={sighting.quantityEstimate} required />
        <TextInput name="shelfPhotoUrl" label="Shelf photo URL" type="url" defaultValue={sighting.shelfPhotoUrl ?? ""} />
        <TextareaInput name="notes" label="Notes" defaultValue={sighting.notes ?? ""} wide />
      </div>
      <div className="form-actions">
        <button className="mini-action solid" disabled={busy} type="submit">
          <Save size={14} />
          {busyLabel === saveLabel ? "Saving" : "Save"}
        </button>
        <button
          className="mini-action danger"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              `Deleting sighting ${sighting.id}`,
              () => requestJson(`/api/radar/sightings/${sighting.id}`, { method: "DELETE" }),
              {
                confirm: `Delete sighting for ${sighting.productSeen}?`,
                success: "Sighting deleted"
              }
            )
          }
        >
          <Trash2 size={14} />
          Delete
        </button>
      </div>
    </form>
  );
}

function releasesNextMonth(releases: ReleaseDTO[]) {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 31);
  return releases
    .filter((release) => {
      const date = calendarDate(release.officialReleaseDate);
      return Boolean(date && date >= now && date <= horizon);
    })
    .sort((a, b) => {
      const dateA = calendarDate(a.officialReleaseDate)?.getTime() ?? 0;
      const dateB = calendarDate(b.officialReleaseDate)?.getTime() ?? 0;
      return dateA - dateB;
    });
}

function ReleasesPanel({
  dashboard,
  isAdmin,
  busy,
  busyLabel,
  runAction
}: {
  dashboard: DashboardDTO;
  isAdmin: boolean;
  busy: boolean;
  busyLabel: string | null;
  runAction: ActionHandler;
}) {
  const nextMonth = useMemo(() => releasesNextMonth(dashboard.releases), [dashboard.releases]);
  const nextDrop = dashboard.releases.find((release) => release.daysUntilRelease >= 0) ?? null;
  return (
    <>
      <section className="release-hero-card">
        <div>
          <p className="eyeline">Release Radar</p>
          <h2>Yearly Release Calendar</h2>
          <span>Track upcoming Pokemon TCG set releases and product-drop news in one clean calendar.</span>
        </div>
        <div className="release-hero-actions">
          <span className="chip good">{dashboard.releases.length} tracked</span>
          <span className="chip watch">{nextMonth.length} next 31 days</span>
          {isAdmin ? (
            <button
              className="mini-action solid"
              disabled={busy}
              type="button"
              onClick={() =>
                runAction(
                  "Syncing release news",
                  () => requestJson("/api/radar/releases/sync", { method: "POST" }),
                  { success: "Release calendar checked against public sources" }
                )
              }
            >
              <RefreshCw size={14} />
              {busyLabel === "Syncing release news" ? "Checking" : "Check Release News"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="release-status-grid">
        <article>
          <small>Next Drop</small>
          <strong>{nextDrop ? nextDrop.setName : "No upcoming drop"}</strong>
          <span>{nextDrop ? `${shortDate(nextDrop.officialReleaseDate)} - ${Math.max(0, nextDrop.daysUntilRelease)} days` : "Add or sync releases to fill the calendar."}</span>
        </article>
        <article>
          <small>Next Month</small>
          <strong>{nextMonth.length}</strong>
          <span>{nextMonth.length ? "Drops inside the next 31 days" : "No known drops in the next 31 days"}</span>
        </article>
        <article>
          <small>Auto Update</small>
          <strong>Daily</strong>
          <span>Vercel cron checks public release sources every morning.</span>
        </article>
      </section>

      <ReleaseCalendar releases={dashboard.releases} />
    </>
  );
}

function ReleaseCalendar({ releases }: { releases: ReleaseDTO[] }) {
  const yearlyDrops = useMemo(() => groupReleasesByYear(releases), [releases]);

  if (!releases.length) {
    return (
      <section className="release-calendar-panel">
        <EmptyState
          icon={CalendarDays}
          title="No yearly drops tracked"
          detail="Admin can add verified release dates from Release Management."
        />
      </section>
    );
  }

  return (
    <section className="release-calendar-panel" aria-label="Pokemon TCG yearly release calendar">
      {yearlyDrops.map(({ year, months }) => (
        <div className="release-year" key={year}>
          <div className="release-year-heading">
            <div>
              <p className="eyeline">Pokemon TCG Drops</p>
              <h2>{year}</h2>
            </div>
            <span className="chip muted">{months.reduce((total, month) => total + month.releases.length, 0)} tracked drops</span>
          </div>
          <div className="release-month-grid">
            {months.map((month) => (
              <article className="release-month-card" key={`${year}-${month.month}`}>
                <h3>{month.label}</h3>
                <div className="release-day-list">
                  {month.releases.map((release) => {
                    const actionUrl = firstUrl(release.productLinks);
                    const releaseDate = calendarDateParts(release.officialReleaseDate);
                    return (
                      <div className="release-day-row" id={`release-${release.id}`} key={release.id}>
                        <div className="release-day-number">
                          <strong>{releaseDate ? releaseDate.day : "?"}</strong>
                          <span>{releaseDate ? releaseDate.weekday : "TBD"}</span>
                        </div>
                        <div className="release-day-main">
                          <strong>{release.setName}</strong>
                          <span>
                            {release.productType || release.productTypes.split(",")[0]} - Release {shortDate(release.officialReleaseDate)}
                          </span>
                          {release.preorderDate ? <small>Preorder {shortDate(release.preorderDate)}</small> : <small>Preorder TBD</small>}
                        </div>
                        <div className="release-day-actions">
                          <span className={`chip compact-chip ${statusTone(release.priority)}`}>{release.priority}</span>
                          {release.pokemonCenterExclusiveVersion ? <span className="chip compact-chip watch">PC</span> : null}
                          {actionUrl ? (
                            <a className="mini-action icon-only" href={actionUrl} target="_blank" rel="noreferrer" aria-label={`Open ${release.setName}`}>
                              <ExternalLink size={14} />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ReleaseManagementPanel({
  dashboard,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  return (
    <>
      <section className="form-panel">
        <h2>Add Release</h2>
        <form
          className="form-grid"
          onSubmit={(event) =>
            submit(
              event,
              "Adding release",
              (form) => requestJson("/api/radar/releases", { method: "POST", body: JSON.stringify(formJson(form)) }),
              { success: "Release added" }
            )
          }
        >
          <TextInput name="setName" label="Set name" required />
          <SelectInput
            name="productType"
            label="Primary product type"
            options={productTypeOptions.map((value) => ({ value, label: value }))}
          />
          <TextInput name="officialReleaseDate" label="Release date" type="date" min="2020-01-01" required />
          <TextInput name="preorderDate" label="Preorder date" type="date" min="2020-01-01" />
          <TextareaInput name="productTypes" label="Product types" placeholder="ETB, Booster Bundle" wide required />
          <SelectInput name="demandRating" label="Demand" options={priorities.map(optionFromString)} />
          <SelectInput name="estimatedDemand" label="Estimated demand" options={priorities.map(optionFromString)} />
          <SelectInput name="priority" label="Priority" options={priorities.map(optionFromString)} />
          <SelectInput name="sealedProductPriority" label="Sealed product priority" options={priorities.map(optionFromString)} />
          <label className="checkbox-label">
            <input name="pokemonCenterExclusiveVersion" type="checkbox" value="true" />
            Pokemon Center exclusive version
          </label>
          <TextareaInput name="chaseCards" label="Chase cards" wide />
          <TextareaInput name="productLinks" label="Product links" placeholder="https://..." wide />
          <TextareaInput name="notes" label="Notes" wide />
          <button className="primary-action" disabled={busy} type="submit">
            <Plus size={16} />
            {busyLabel === "Adding release" ? "Adding" : "Add Release"}
          </button>
        </form>
      </section>
      <BulkImportPanel
        title="Bulk Release Import"
        endpoint="/api/radar/releases/import"
        busy={busy}
        busyLabel={busyLabel}
        submit={submit}
        sample={`setName,productType,officialReleaseDate,preorderDate,productTypes,pokemonCenterExclusiveVersion,chaseCards,demandRating,estimatedDemand,priority,sealedProductPriority,productLinks,notes\nMega Evolution-Chaos Rising,Build & Battle Box,2026-05-22,2026-05-08,\"Build & Battle Box, Booster Bundle, ETB\",true,Verify final chase card list,HIGH,HIGH,HIGH,HIGH,https://www.pokemon.com/uk/pokemon-news/get-a-pokemon-tcg-mega-evolution-chaos-rising-build-battle-box-early,Verify dates by region`}
      />
      <section className="form-panel">
        <h2>Edit Releases</h2>
        <div className="edit-stack">
          {dashboard.releases.length ? (
            dashboard.releases.map((release) => (
              <EditableRelease
                key={release.id}
                release={release}
                busy={busy}
                busyLabel={busyLabel}
                submit={submit}
                runAction={runAction}
              />
            ))
          ) : (
            <EmptyState icon={CalendarDays} title="No releases to edit" detail="Add a release first." />
          )}
        </div>
      </section>
    </>
  );
}

function EditableRelease({
  release,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  release: ReleaseDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const saveLabel = `Saving release ${release.id}`;
  return (
    <form
      className="edit-card"
      onSubmit={(event) =>
        submit(
          event,
          saveLabel,
          (form) =>
            requestJson(`/api/radar/releases/${release.id}`, {
              method: "PATCH",
              body: JSON.stringify(formJson(form))
            }),
          { reset: false, success: "Release saved" }
        )
      }
    >
      <div className="edit-card-heading">
        <div>
          <strong>{release.setName}</strong>
          <span>
            {shortDate(release.officialReleaseDate)} - {Math.max(0, release.daysUntilRelease)} days
          </span>
        </div>
        <span className={`chip ${statusTone(release.priority)}`}>{release.priority}</span>
      </div>
      <div className="form-grid">
        <TextInput name="setName" label="Set name" defaultValue={release.setName} required />
        <SelectInput
          name="productType"
          label="Primary product type"
          defaultValue={release.productType ?? productTypeOptions[0]}
          options={productTypeOptions.map((value) => ({ value, label: value }))}
        />
        <TextInput
          name="officialReleaseDate"
          label="Release date"
          type="date"
          min="2020-01-01"
          defaultValue={toDateInput(release.officialReleaseDate)}
          required
        />
        <TextInput
          name="preorderDate"
          label="Preorder date"
          type="date"
          min="2020-01-01"
          defaultValue={toDateInput(release.preorderDate)}
        />
        <TextareaInput name="productTypes" label="Product types" defaultValue={release.productTypes} wide required />
        <SelectInput name="demandRating" label="Demand" defaultValue={release.demandRating} options={priorities.map(optionFromString)} />
        <SelectInput
          name="estimatedDemand"
          label="Estimated demand"
          defaultValue={release.estimatedDemand}
          options={priorities.map(optionFromString)}
        />
        <SelectInput name="priority" label="Priority" defaultValue={release.priority} options={priorities.map(optionFromString)} />
        <SelectInput
          name="sealedProductPriority"
          label="Sealed product priority"
          defaultValue={release.sealedProductPriority}
          options={priorities.map(optionFromString)}
        />
        <label className="checkbox-label">
          <input
            name="pokemonCenterExclusiveVersion"
            type="checkbox"
            value="true"
            defaultChecked={release.pokemonCenterExclusiveVersion}
          />
          Pokemon Center exclusive version
        </label>
        <TextareaInput name="chaseCards" label="Chase cards" defaultValue={release.chaseCards ?? ""} wide />
        <TextareaInput name="productLinks" label="Product links" defaultValue={release.productLinks ?? ""} wide />
        <TextareaInput name="notes" label="Notes" defaultValue={release.notes ?? ""} wide />
      </div>
      <div className="form-actions">
        <button className="mini-action solid" disabled={busy} type="submit">
          <Save size={14} />
          {busyLabel === saveLabel ? "Saving" : "Save"}
        </button>
        <button
          className="mini-action danger"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              `Deleting release ${release.id}`,
              () => requestJson(`/api/radar/releases/${release.id}`, { method: "DELETE" }),
              {
                confirm: `Delete ${release.setName}?`,
                success: "Release deleted"
              }
            )
          }
        >
          <Trash2 size={14} />
          Delete
        </button>
      </div>
    </form>
  );
}

function EbaySetupPanel({
  dashboard,
  busy,
  busyLabel,
  runAction
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  runAction: ActionHandler;
}) {
  const status = dashboard.ebayStatus;
  return (
    <section className="form-panel ebay-setup-panel">
      <div className="edit-card-heading">
        <div>
          <p className="eyeline">Admin Setup</p>
          <h2>eBay API Status</h2>
          <span>{status.message}</span>
        </div>
        <span className={`chip ${status.ready ? "good" : "watch"}`}>
          {status.ready ? "API configured" : "Manual comp mode"}
        </span>
      </div>
      <div className="ebay-status-grid">
        {status.variables.map((variable) => (
          <div className="status-tile compact-status-tile" key={variable.name}>
            <span className="chip muted">{variable.name}</span>
            <strong>{variable.configured ? "Configured" : "Missing"}</strong>
            <small>{variable.masked}</small>
          </div>
        ))}
      </div>
      <div className="monitor-meta">
        <span>Mode {status.mode === "api" ? "eBay API" : "Manual"}</span>
        <span>Environment {status.environment}</span>
        <span>Marketplace {status.marketplaceId}</span>
      </div>
      <div className="form-actions">
        <button
          className="mini-action solid"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction("Testing eBay connection", () => requestJson("/api/radar/ebay/test", { method: "POST" }), {
              success: "eBay connection test finished"
            })
          }
        >
          <Wifi size={14} />
          {busyLabel === "Testing eBay connection" ? "Testing" : "Test eBay Connection"}
        </button>
      </div>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CardsPanel({
  dashboard,
  isAdmin,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  dashboard: DashboardDTO;
  isAdmin: boolean;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const [filters, setFilters] = useState({
    setName: "",
    character: "",
    rawMin: "",
    rawMax: "",
    psa9Only: false,
    psa10Upside: false,
    era: "ALL" as "ALL" | Era,
    lowNumbered: false
  });

  const filteredCards = useMemo(() => {
    const setQuery = filters.setName.trim().toLowerCase();
    const characterQuery = filters.character.trim().toLowerCase();
    const minRaw = filters.rawMin ? Number(filters.rawMin) : null;
    const maxRaw = filters.rawMax ? Number(filters.rawMax) : null;
    return dashboard.cards.filter((card) => {
      if (setQuery && !card.setName.toLowerCase().includes(setQuery)) return false;
      if (
        characterQuery &&
        !`${card.characterName ?? ""} ${card.cardName}`.toLowerCase().includes(characterQuery)
      ) {
        return false;
      }
      if (minRaw !== null && card.rawAveragePrice < minRaw) return false;
      if (maxRaw !== null && card.rawAveragePrice > maxRaw) return false;
      if (filters.psa9Only && card.psa9EstimatedProfit < dashboard.investmentSettings.minimumProfitTarget) return false;
      if (filters.psa10Upside && card.psa10EstimatedProfit < dashboard.investmentSettings.minimumProfitTarget) return false;
      if (filters.era !== "ALL" && card.era !== filters.era) return false;
      if (filters.lowNumbered && !card.lowNumberedSerialized) return false;
      return true;
    });
  }, [dashboard.cards, dashboard.investmentSettings.minimumProfitTarget, filters]);

  function updateFilter(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, type, value } = event.currentTarget;
    setFilters((current) => ({
      ...current,
      [name]: type === "checkbox" ? (event.currentTarget as HTMLInputElement).checked : value
    }));
  }

  return (
    <>
      <SectionIntro
        title="Cards"
        detail="Raw-to-grade opportunities first. Reports, comp review, API setup, and manual data tools stay tucked away."
        stats={[
          { label: "cards", value: dashboard.cards.length },
          { label: "shown", value: filteredCards.length },
          { label: dashboard.ebayStatus.ready ? "eBay live" : "manual comps", value: dashboard.ebayStatus.ready ? "On" : "Mode", tone: dashboard.ebayStatus.ready ? "good" : "watch" }
        ]}
      />
      <Top10Poster cards={dashboard.top10Watchlist} generatedAt={dashboard.investmentReports[0]?.generatedAt ?? null} />
      <section className="form-panel">
        <div className="edit-card-heading">
          <div>
            <h2>Card Filters</h2>
            <span>{filteredCards.length} cards matching current filters</span>
          </div>
          <button
            className="mini-action"
            type="button"
            onClick={() =>
              setFilters({
                setName: "",
                character: "",
                rawMin: "",
                rawMax: "",
                psa9Only: false,
                psa10Upside: false,
                era: "ALL",
                lowNumbered: false
              })
            }
          >
            <X size={14} />
            Clear
          </button>
        </div>
        <div className="form-grid">
          <TextInput name="setName" label="Set" value={filters.setName} onChange={updateFilter} />
          <TextInput name="character" label="Character" value={filters.character} onChange={updateFilter} />
          <TextInput
            name="rawMin"
            label="Raw min"
            type="number"
            min="0"
            step="0.01"
            value={filters.rawMin}
            onChange={updateFilter}
          />
          <TextInput
            name="rawMax"
            label="Raw max"
            type="number"
            min="0"
            step="0.01"
            value={filters.rawMax}
            onChange={updateFilter}
          />
          <SelectInput
            name="era"
            label="Era"
            value={filters.era}
            options={eras.map((era) => ({ value: era, label: era === "ALL" ? "All Eras" : formatStatus(era) }))}
            onChange={updateFilter}
          />
          <label className="checkbox-label">
            <input name="psa9Only" type="checkbox" checked={filters.psa9Only} onChange={updateFilter} />
            PSA 9 profitable only
          </label>
          <label className="checkbox-label">
            <input name="psa10Upside" type="checkbox" checked={filters.psa10Upside} onChange={updateFilter} />
            PSA 10 upside
          </label>
          <label className="checkbox-label">
            <input name="lowNumbered" type="checkbox" checked={filters.lowNumbered} onChange={updateFilter} />
            Low-numbered / serialized
          </label>
        </div>
      </section>
      {isAdmin ? (
        <div className="simple-action-row">
          <button
            className="mini-action solid"
            disabled={busy}
            type="button"
            onClick={() =>
              runAction("Refreshing all comps", () => requestJson("/api/radar/cards/refresh-comps", { method: "POST" }), {
                success: "All comp refreshes finished"
              })
            }
          >
            <RefreshCw size={14} />
            {busyLabel === "Refreshing all comps" ? "Refreshing" : "Refresh All Cards"}
          </button>
        </div>
      ) : null}
      <CardStack
        cards={filteredCards}
        busy={busy}
        busyLabel={busyLabel}
        runAction={runAction}
        allowRefresh={isAdmin || dashboard.currentUser.canAddComps}
      />
      <UtilityFold title="Card Reports And Comps" detail="Weekly reports, exact sold comps, and accepted/rejected comp review">
        <WeeklyReportPanel dashboard={dashboard} isAdmin={isAdmin} busy={busy} busyLabel={busyLabel} runAction={runAction} />
        <RecentCompsTable comps={dashboard.cardCompSales} busy={busy} runAction={runAction} canReview={isAdmin || dashboard.currentUser.canAddComps} />
      </UtilityFold>
      {isAdmin ? (
        <UtilityFold title="Card Admin" detail="eBay setup, comp entry, card data, and investment settings">
          <EbaySetupPanel dashboard={dashboard} busy={busy} busyLabel={busyLabel} runAction={runAction} />
          <InvestmentSettingsForm dashboard={dashboard} busy={busy} busyLabel={busyLabel} submit={submit} />
          <ManualCompForm busy={busy} busyLabel={busyLabel} submit={submit} />
        <section className="form-panel">
          <h2>Add Manual Card Data</h2>
          <form
            className="form-grid"
            onSubmit={(event) =>
              submit(
                event,
                "Adding card",
                (form) => requestJson("/api/radar/cards", { method: "POST", body: JSON.stringify(formJson(form)) }),
                { success: "Card data added" }
              )
            }
          >
            <TextInput name="cardName" label="Card name" required />
            <SelectInput name="releaseId" label="Release / set" options={releaseOptions(dashboard.releases)} />
            <TextInput name="setName" label="Set" required />
            <TextInput name="cardNumber" label="Card number" placeholder="025/198" required />
            <TextInput name="rarity" label="Rarity" required />
            <TextInput name="characterName" label="Character" />
            <TextInput name="rawAveragePrice" label="Raw avg" type="number" min="0" max="100000" step="0.01" required />
            <TextInput
              name="psa9AverageSalePrice"
              label="PSA 9 avg"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              required
            />
            <TextInput
              name="psa10AverageSalePrice"
              label="PSA 10 avg"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              required
            />
            <TextInput
              name="bgs95AverageSalePrice"
              label="BGS 9.5 avg"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              defaultValue="0"
            />
            <TextInput
              name="bgs10AverageSalePrice"
              label="BGS 10 avg"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              defaultValue="0"
            />
            <TextInput
              name="bgsBlackLabelAverageSalePrice"
              label="BGS Black Label avg"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              defaultValue="0"
            />
            <TextInput
              name="estimatedEbayFee"
              label="eBay fee rate"
              type="number"
              min="0"
              max="0.5"
              step="0.001"
              defaultValue="0.1325"
            />
            <TextInput
              name="estimatedGradingCost"
              label="Grading cost"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              defaultValue="20"
            />
            <TextInput
              name="estimatedShippingCost"
              label="Shipping cost"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              defaultValue="5"
            />
            <TextInput
              name="minimumProfitTarget"
              label="Minimum profit target"
              type="number"
              min="0"
              max="100000"
              step="0.01"
              defaultValue="20"
            />
            <SelectInput name="era" label="Era" options={eras.filter((era) => era !== "ALL").map(optionFromString)} />
            <TextInput name="dataSource" label="Data source" defaultValue="Manual eBay sold comps" wide />
            <TextInput name="lastRefreshed" label="Data collected date" type="date" min="2020-01-01" required />
            <label className="checkbox-label">
              <input name="lowPop" type="checkbox" value="true" />
              Low pop
            </label>
            <label className="checkbox-label">
              <input name="newRelease" type="checkbox" value="true" />
              New release
            </label>
            <label className="checkbox-label">
              <input name="strongCharacterDemand" type="checkbox" value="true" />
              Strong character demand
            </label>
            <label className="checkbox-label">
              <input name="lowNumberedSerialized" type="checkbox" value="true" />
              Low-numbered / serialized
            </label>
            <CardSearchTuningFields />
            <TextareaInput name="notes" label="Notes" wide />
            <button className="primary-action" disabled={busy} type="submit">
              <Plus size={16} />
              {busyLabel === "Adding card" ? "Adding" : "Add Card"}
            </button>
          </form>
        </section>
        <section className="form-panel">
          <h2>Edit Cards</h2>
          <div className="edit-stack">
            {dashboard.cards.length ? (
              dashboard.cards.map((card) => (
                <EditableCard
                  key={card.id}
                  card={card}
                  releases={dashboard.releases}
                  busy={busy}
                  busyLabel={busyLabel}
                  submit={submit}
                  runAction={runAction}
                />
              ))
            ) : (
              <EmptyState icon={CircleDollarSign} title="No cards to edit" detail="Add manual card data first." />
            )}
          </div>
        </section>
        </UtilityFold>
      ) : null}
    </>
  );
}

function InvestmentSettingsForm({
  dashboard,
  busy,
  busyLabel,
  submit
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
}) {
  const settings = dashboard.investmentSettings;
  return (
    <section className="form-panel">
      <h2>Investment Settings</h2>
      <form
        className="form-grid"
        onSubmit={(event) =>
          submit(
            event,
            "Saving investment settings",
            (form) =>
              requestJson("/api/radar/investment-settings", {
                method: "PATCH",
                body: JSON.stringify(formJson(form))
              }),
            { reset: false, success: "Investment settings saved" }
          )
        }
      >
        <TextInput
          name="gradingCost"
          label="Grading cost"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={settings.gradingCost}
        />
        <TextInput
          name="ebaySellingFee"
          label="eBay selling fee"
          type="number"
          min="0"
          max="0.5"
          step="0.001"
          defaultValue={settings.ebaySellingFee}
        />
        <TextInput
          name="shippingCost"
          label="Shipping cost"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={settings.shippingCost}
        />
        <TextInput
          name="minimumProfitTarget"
          label="Minimum profit target"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={settings.minimumProfitTarget}
        />
        <button className="primary-action" disabled={busy} type="submit">
          <Save size={16} />
          {busyLabel === "Saving investment settings" ? "Saving" : "Save Settings"}
        </button>
      </form>
    </section>
  );
}

function CardSearchTuningFields({ card }: { card?: CardDTO }) {
  return (
    <>
      <div className="form-step wide-field">
        <span>eBay QA</span>
        <strong>Search tuning and wrong-comp protection</strong>
      </div>
      <TextareaInput
        name="ebayIncludeWords"
        label="Include words"
        defaultValue={card?.ebayIncludeWords ?? ""}
        placeholder="Optional words that must appear, one per line or comma separated"
        wide
      />
      <TextareaInput
        name="ebayExcludeWords"
        label="Exclude words"
        defaultValue={card?.ebayExcludeWords ?? ""}
        placeholder="lot, proxy, digital, jumbo"
        wide
      />
      <TextInput
        name="ebayRawKeywords"
        label="Raw-only keywords"
        defaultValue={card?.ebayRawKeywords ?? "raw, ungraded"}
        placeholder="raw, ungraded"
      />
      <TextInput
        name="ebayPsa9Keywords"
        label="PSA 9 keywords"
        defaultValue={card?.ebayPsa9Keywords ?? "PSA 9, PSA Mint 9"}
        placeholder="PSA 9, PSA Mint 9"
      />
      <TextInput
        name="ebayPsa10Keywords"
        label="PSA 10 keywords"
        defaultValue={card?.ebayPsa10Keywords ?? "PSA 10, PSA Gem Mint 10"}
        placeholder="PSA 10, PSA Gem Mint 10"
      />
      <label className="checkbox-label">
        <input name="ebayExactSetName" type="hidden" value="false" />
        <input name="ebayExactSetName" type="checkbox" value="true" defaultChecked={card?.ebayExactSetName ?? true} />
        Require exact set name
      </label>
      <label className="checkbox-label">
        <input name="ebayCardNumberRequired" type="hidden" value="false" />
        <input
          name="ebayCardNumberRequired"
          type="checkbox"
          value="true"
          defaultChecked={card?.ebayCardNumberRequired ?? true}
        />
        Require card number
      </label>
      <label className="checkbox-label">
        <input name="ebayAllowNonEnglish" type="hidden" value="false" />
        <input name="ebayAllowNonEnglish" type="checkbox" value="true" defaultChecked={card?.ebayAllowNonEnglish ?? false} />
        Allow non-English comps
      </label>
    </>
  );
}

function ManualCompForm({ busy, busyLabel, submit }: { busy: boolean; busyLabel: string | null; submit: SubmitHandler }) {
  const [selectedGrade, setSelectedGrade] = useState<GradeType>("RAW");
  return (
    <section className="form-panel">
      <div className="edit-card-heading">
        <div>
          <h2>Guided Card Comp Entry</h2>
          <span>Add one verified sold comp at a time, then let the app recalculate averages and report rankings.</span>
        </div>
        <span className="chip muted">Manual assisted workflow</span>
      </div>
      <div className="comp-quick-grid" aria-label="Quick comp grade buttons">
        {gradeTypes.map((gradeType) => (
          <button
            className={selectedGrade === gradeType ? "mini-action solid" : "mini-action"}
            key={gradeType}
            type="button"
            onClick={() => setSelectedGrade(gradeType)}
          >
            {formatGradeType(gradeType)}
          </button>
        ))}
      </div>
      <form
        className="form-grid"
        onSubmit={(event) =>
          submit(
            event,
            "Adding comp",
            (form) => requestJson("/api/radar/cards/comps", { method: "POST", body: JSON.stringify(formJson(form)) }),
            { success: "Comp saved" }
          )
        }
      >
        <div className="form-step wide-field">
          <span>Step 1</span>
          <strong>Identify the card</strong>
        </div>
        <TextInput name="cardName" label="Card name" required />
        <TextInput name="setName" label="Set" required />
        <TextInput name="cardNumber" label="Card number" placeholder="025/198" required />
        <div className="form-step wide-field">
          <span>Step 2</span>
          <strong>Enter the sold comp</strong>
        </div>
        <SelectInput
          name="gradeType"
          label="Grade type"
          value={selectedGrade}
          onChange={(event) => setSelectedGrade(event.currentTarget.value as GradeType)}
          options={gradeTypes.map((gradeType) => ({ value: gradeType, label: formatGradeType(gradeType) }))}
        />
        <SelectInput
          name="sourceQuality"
          label="Source quality"
          defaultValue="EBAY_SOLD"
          options={compSourceQualities.map((sourceQuality) => ({
            value: sourceQuality,
            label: formatSourceQuality(sourceQuality)
          }))}
        />
        <TextInput name="salePrice" label="Sale price" type="number" min="0" max="100000" step="0.01" required />
        <TextInput name="soldAt" label="Sale date" type="date" min="2020-01-01" required />
        <TextInput name="sourceUrl" label="Source URL" type="url" placeholder="https://www.ebay.com/itm/..." />
        <TextInput name="saleTitle" label="Sale title" placeholder="Paste the completed listing title" />
        <TextInput name="matchScore" label="Match confidence" type="number" min="0" max="100" defaultValue="100" />
        <div className="form-step wide-field">
          <span>Step 3</span>
          <strong>Quality flags for ranking</strong>
        </div>
        <TextInput name="characterName" label="Character" />
        <SelectInput name="era" label="Era" options={eras.filter((era) => era !== "ALL").map(optionFromString)} />
        <label className="checkbox-label">
          <input name="lowPop" type="checkbox" value="true" />
          Low pop
        </label>
        <label className="checkbox-label">
          <input name="newRelease" type="checkbox" value="true" />
          New release
        </label>
        <label className="checkbox-label">
          <input name="strongCharacterDemand" type="checkbox" value="true" />
          Strong character demand
        </label>
        <label className="checkbox-label">
          <input name="lowNumberedSerialized" type="checkbox" value="true" />
          Low-numbered / serialized
        </label>
        <TextareaInput name="conditionNotes" label="Condition notes" wide />
        <button className="primary-action" disabled={busy} type="submit">
          <Plus size={16} />
          {busyLabel === "Adding comp" ? "Adding" : "Add Comp"}
        </button>
      </form>
    </section>
  );
}

function RecentCompsTable({
  comps,
  busy,
  runAction,
  canReview
}: {
  comps: CardCompSaleDTO[];
  busy: boolean;
  runAction: ActionHandler;
  canReview: boolean;
}) {
  return (
    <section className="form-panel">
      <PanelHeader title="Recent Comp Sales" />
      <div className="table-list comp-table">
        {comps.length ? (
          comps.slice(0, 12).map((comp) => (
            <div className="table-row" key={comp.id}>
              <span className="chip muted">{formatGradeType(comp.gradeType)}</span>
              <span className="chip muted">{formatSourceQuality(comp.sourceQuality)}</span>
              <span className={`chip ${comp.reviewStatus === "REJECTED" ? "bad" : "good"}`}>
                {comp.reviewStatus === "REJECTED" ? "Rejected" : "Accepted"}
              </span>
              <strong>{comp.cardName}</strong>
              <span>
                {comp.setName} #{comp.cardNumber}
              </span>
              <span>{money(comp.salePrice)}</span>
              <div className="row-actions">
                <span>{shortDate(comp.soldAt)}</span>
                <span className="chip muted">Match {comp.matchScore}%</span>
                {comp.sourceUrl ? (
                  <a className="mini-action" href={comp.sourceUrl} target="_blank" rel="noreferrer">
                    Source <ExternalLink size={14} />
                  </a>
                ) : null}
                {canReview ? <CompReviewButtons comp={comp} busy={busy} runAction={runAction} /> : null}
              </div>
              {comp.saleTitle ? <span className="monitor-details">{comp.saleTitle}</span> : null}
            </div>
          ))
        ) : (
          <EmptyState icon={FileText} title="No comp sales" detail="Add manual sold comps to calculate averages." />
        )}
      </div>
    </section>
  );
}

function Top10Poster({ cards, generatedAt }: { cards: CardDTO[]; generatedAt: string | null }) {
  return (
    <section className="poster-panel" id="top10-poster">
      <div className="poster-header">
        <div>
          <p className="eyeline">Weekly Top 10</p>
          <h2>Raw-to-Grade Watchlist</h2>
          <span>{generatedAt ? `Last report generated ${shortDate(generatedAt)}` : "Live manual data - report not generated yet"}</span>
        </div>
        <button className="mini-action solid print-control" type="button" onClick={() => window.print()}>
          <Printer size={14} />
          Print Poster
        </button>
      </div>
      {cards.length ? (
        <div className="top10-table" role="table" aria-label="Top 10 raw-to-grade cards">
          <div className="top10-row top10-head" role="row">
            <span>Card</span>
            <span>Raw</span>
            <span>PSA 9</span>
            <span>PSA 10</span>
            <span>Limit</span>
            <span>Rating</span>
          </div>
          {cards.map((card, index) => (
            <article className="top10-row" key={card.id} role="row">
              <div className="top10-card-cell" role="cell">
                <span className="top10-rank">{index + 1}</span>
                <div>
                  <strong>{card.cardName}</strong>
                  <small>
                    {card.setName} #{card.cardNumber} - {dataSourceLabel(card.dataSource)} - {cardFreshnessLabel(card)}
                  </small>
                </div>
              </div>
              <span className="top10-metric" role="cell" data-label="Raw">{money(card.rawAveragePrice)}</span>
              <span className="top10-metric" role="cell" data-label="PSA 9">
                {money(card.psa9AverageSalePrice)}
                <small>{money(card.psa9EstimatedProfit)} profit</small>
              </span>
              <span className="top10-metric" role="cell" data-label="PSA 10">
                {money(card.psa10AverageSalePrice)}
                <small>{money(card.psa10EstimatedProfit)} upside</small>
              </span>
              <span className="top10-metric" role="cell" data-label="Limit">{money(card.maxRawBuyPrice)}</span>
              <span className={`chip compact-chip ${statusTone(card.rating)}`} role="cell">{card.rating}</span>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState icon={Trophy} title="No Top 10 yet" detail="Add raw and graded comps to generate the watchlist." />
      )}
    </section>
  );
}

function WeeklyReportPanel({
  dashboard,
  isAdmin,
  busy,
  busyLabel,
  runAction
}: {
  dashboard: DashboardDTO;
  isAdmin: boolean;
  busy: boolean;
  busyLabel: string | null;
  runAction: ActionHandler;
}) {
  const latestReport = dashboard.investmentReports[0] ?? null;
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const selectedReport =
    dashboard.investmentReports.find((report) => report.id === selectedReportId) ?? latestReport;
  return (
    <>
      <section className="form-panel">
        <div className="edit-card-heading">
          <div>
            <h2>Weekly Investment Report Archive</h2>
            <span>
              {dashboard.investmentReports.length
                ? `${dashboard.investmentReports.length} saved report${dashboard.investmentReports.length === 1 ? "" : "s"}`
                : "No weekly reports generated yet"}
            </span>
          </div>
          {isAdmin ? (
            <button
              className="mini-action solid"
              disabled={busy}
              type="button"
              onClick={() =>
                runAction(
                  "Generating weekly investment report",
                  () =>
                    requestJson("/api/radar/cards/reports", {
                      method: "POST",
                      body: JSON.stringify({ notes: "Generated from current manual comp data." })
                    }),
                  { success: "Weekly investment report generated" }
                )
              }
            >
              <Trophy size={14} />
              {busyLabel === "Generating weekly investment report" ? "Generating" : "Generate Weekly Report Now"}
            </button>
          ) : null}
        </div>
        {latestReport ? (
          <div className="report-archive-list">
            {dashboard.investmentReports.slice(0, 6).map((report) => (
              <button
                className={selectedReport?.id === report.id ? "report-archive-row active" : "report-archive-row"}
                key={report.id}
                type="button"
                onClick={() => setSelectedReportId(report.id)}
              >
                <div>
                  <strong>{report.title}</strong>
                  <span>
                    Generated {dateTime(report.generatedAt)} - {report.top10RawToGrade.length} Top 10 cards
                  </span>
                </div>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Trophy}
            title="No weekly investment reports"
            detail="Generate a report after entering raw and graded sold comps."
          />
        )}
      </section>
      {selectedReport ? <InvestmentReportPoster report={selectedReport} /> : null}
    </>
  );
}

function InvestmentReportPoster({ report }: { report: InvestmentReportDTO }) {
  return (
    <section className="poster-panel investment-report-poster" id={`investment-report-${report.id}`}>
      <div className="poster-header">
        <div>
          <p className="eyeline">Weekly Investment Report</p>
          <h2>{report.title}</h2>
          <span>
            {shortDate(report.periodStart)} to {shortDate(report.periodEnd)}
          </span>
        </div>
        <button className="mini-action solid print-control" type="button" onClick={() => window.print()}>
          <Printer size={14} />
          Print Report
        </button>
      </div>
      <div className="report-note-grid">
        <ReportHighlight label="Best buy" item={report.bestBuy} />
        <ReportHighlight label="Riskiest buy" item={report.riskiestBuy} />
        <ReportHighlight label="Best under $25 raw" item={report.bestUnder25Raw} />
        <ReportHighlight label="Best premium card" item={report.bestPremiumCard} />
      </div>
      {report.notes ? <p className="reason-text">{report.notes}</p> : null}
      <div className="report-category-grid">
        <ReportCategory title="Top 10 raw-to-grade" items={report.top10RawToGrade} />
        <ReportCategory title="Top 5 safest PSA 9 flips" items={report.safestPsa9Flips} />
        <ReportCategory title="Top 5 highest PSA 10 upside" items={report.highestPsa10Upside} />
        <ReportCategory title="Top 5 Beckett candidates" items={report.beckettCandidates} />
        <ReportCategory title="Top 5 avoid / overpriced" items={report.avoidOverpriced} />
      </div>
    </section>
  );
}

function ReportHighlight({ label, item }: { label: string; item: InvestmentReportItemDTO | null }) {
  return (
    <div className="report-highlight">
      <span>{label}</span>
      {item ? (
        <>
          <strong>{item.cardName}</strong>
          <small>
            {item.setName} #{item.cardNumber} - Raw {money(item.rawAveragePrice)}
          </small>
        </>
      ) : (
        <small>Not enough comp data</small>
      )}
    </div>
  );
}

function ReportCategory({ title, items }: { title: string; items: InvestmentReportItemDTO[] }) {
  return (
    <div className="report-category">
      <h3>{title}</h3>
      {items.length ? (
        <div className="poster-grid">
          {items.map((item, index) => (
            <ReportCardLine item={item} key={`${title}-${item.cardId}`} rank={index + 1} />
          ))}
        </div>
      ) : (
        <EmptyState icon={FileText} title="No qualifying cards" detail="Add more recent comps for this report section." />
      )}
    </div>
  );
}

function ReportCardLine({ item, rank }: { item: InvestmentReportItemDTO; rank: number }) {
  return (
    <article className="top10-row report-row">
      <div className="top10-card-cell">
        <span className="top10-rank">{rank}</span>
        <div>
          <strong>{item.cardName}</strong>
          <small>
            {item.setName} #{item.cardNumber} - Confidence {item.compConfidenceScore}%
          </small>
        </div>
      </div>
      <span className="top10-metric" data-label="Raw">{money(item.rawAveragePrice)}</span>
      <span className="top10-metric" data-label="PSA 9">{money(item.psa9EstimatedProfit)}</span>
      <span className="top10-metric" data-label="PSA 10">{money(item.psa10EstimatedProfit)}</span>
      <span className="top10-metric" data-label="Limit">{money(item.maxRawBuyPrice)}</span>
      <span className={`chip compact-chip ${statusTone(item.rating)}`}>{item.rating}</span>
      <p className="reason-text">{item.reason}</p>
    </article>
  );
}

function EditableCard({
  card,
  releases,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  card: CardDTO;
  releases: ReleaseDTO[];
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const saveLabel = `Saving card ${card.id}`;
  return (
    <form
      className="edit-card"
      onSubmit={(event) =>
        submit(
          event,
          saveLabel,
          (form) =>
            requestJson(`/api/radar/cards/${card.id}`, {
              method: "PATCH",
              body: JSON.stringify(formJson(form))
            }),
          { reset: false, success: "Card saved" }
        )
      }
    >
      <div className="edit-card-heading">
        <div>
          <strong>{card.cardName}</strong>
          <span>
            {card.setName} #{card.cardNumber} - Score {card.top10Score} - PSA 10 profit {money(card.psa10EstimatedProfit)}
          </span>
        </div>
        <span className={`chip ${statusTone(card.rating)}`}>{card.rating}</span>
      </div>
      <div className="form-grid">
        <TextInput name="cardName" label="Card name" defaultValue={card.cardName} required />
        <SelectInput
          name="releaseId"
          label="Release / set"
          defaultValue={card.releaseId ?? ""}
          options={releaseOptions(releases)}
        />
        <TextInput name="setName" label="Set" defaultValue={card.setName} required />
        <TextInput name="cardNumber" label="Card number" defaultValue={card.cardNumber} required />
        <TextInput name="rarity" label="Rarity" defaultValue={card.rarity} required />
        <TextInput name="characterName" label="Character" defaultValue={card.characterName ?? ""} />
        <TextInput
          name="rawAveragePrice"
          label="Raw avg"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={card.rawAveragePrice}
          required
        />
        <TextInput
          name="psa9AverageSalePrice"
          label="PSA 9 avg"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={card.psa9AverageSalePrice}
          required
        />
        <TextInput
          name="psa10AverageSalePrice"
          label="PSA 10 avg"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={card.psa10AverageSalePrice}
          required
        />
        <TextInput
          name="bgs95AverageSalePrice"
          label="BGS 9.5 avg"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={card.bgs95AverageSalePrice}
        />
        <TextInput
          name="bgs10AverageSalePrice"
          label="BGS 10 avg"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={card.bgs10AverageSalePrice}
        />
        <TextInput
          name="bgsBlackLabelAverageSalePrice"
          label="BGS Black Label avg"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={card.bgsBlackLabelAverageSalePrice}
        />
        <TextInput
          name="estimatedEbayFee"
          label="eBay fee rate"
          type="number"
          min="0"
          max="0.5"
          step="0.001"
          defaultValue={card.estimatedEbayFee}
        />
        <TextInput
          name="estimatedGradingCost"
          label="Grading cost"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={card.estimatedGradingCost}
        />
        <TextInput
          name="estimatedShippingCost"
          label="Shipping cost"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={card.estimatedShippingCost}
        />
        <TextInput
          name="minimumProfitTarget"
          label="Minimum profit target"
          type="number"
          min="0"
          max="100000"
          step="0.01"
          defaultValue={card.minimumProfitTarget}
        />
        <SelectInput name="era" label="Era" defaultValue={card.era} options={eras.filter((era) => era !== "ALL").map(optionFromString)} />
        <SelectInput name="rating" label="Rating" defaultValue={card.rating} options={cardRatings.map(optionFromString)} />
        <TextInput name="lastRefreshed" label="Data collected date" type="date" min="2020-01-01" defaultValue={toDateInput(card.lastRefreshed)} required />
        <TextInput name="dataSource" label="Data source" defaultValue={card.dataSource} wide required />
        <label className="checkbox-label">
          <input name="lowPop" type="checkbox" value="true" defaultChecked={card.lowPop} />
          Low pop
        </label>
        <label className="checkbox-label">
          <input name="newRelease" type="checkbox" value="true" defaultChecked={card.newRelease} />
          New release
        </label>
        <label className="checkbox-label">
          <input name="strongCharacterDemand" type="checkbox" value="true" defaultChecked={card.strongCharacterDemand} />
          Strong character demand
        </label>
        <label className="checkbox-label">
          <input name="lowNumberedSerialized" type="checkbox" value="true" defaultChecked={card.lowNumberedSerialized} />
          Low-numbered / serialized
        </label>
        <CardSearchTuningFields card={card} />
        <TextareaInput name="notes" label="Notes" defaultValue={card.notes ?? ""} wide />
      </div>
      <div className="form-actions">
        <button className="mini-action solid" disabled={busy} type="submit">
          <Save size={14} />
          {busyLabel === saveLabel ? "Saving" : "Save"}
        </button>
        <button
          className="mini-action danger"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(`Deleting card ${card.id}`, () => requestJson(`/api/radar/cards/${card.id}`, { method: "DELETE" }), {
              confirm: `Delete ${card.cardName}? This also removes price snapshots and comp sales.`,
              success: "Card deleted"
            })
          }
        >
          <Trash2 size={14} />
          Delete
        </button>
      </div>
    </form>
  );
}

function AlertsPanel({
  dashboard,
  busy,
  busyLabel,
  submit,
  runAction,
  setActiveTab
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
  setActiveTab: (tab: Tab) => void;
}) {
  const visibleAlerts = dashboard.alerts.filter((alert) => !isDeprecatedLocalStoreAlert(alert));
  const deprecatedCount = dashboard.alerts.length - visibleAlerts.length;
  return (
    <section className="alerts-page">
      <section className="inventory-page-header inventory-ops-header alerts-page-header">
        <div>
          <h2>Alerts</h2>
          <p>Restock, inventory, order, and system notifications.</p>
          <span className="sr-only">Alert History Analytics</span>
        </div>
      </section>
      <section className="inventory-kpi-grid alerts-kpi-grid">
        <InventoryKpiCard label="All Alerts" value={String(dashboard.alertAnalytics.totalAlerts)} detail="All history" />
        <InventoryKpiCard label="Unread" value={String(dashboard.alertAnalytics.unreadAlerts)} detail="Need review" tone={dashboard.alertAnalytics.unreadAlerts ? "watch" : "neutral"} />
        <InventoryKpiCard label="Urgent" value={String(dashboard.alertAnalytics.highPriorityAlerts)} detail="High priority" tone={dashboard.alertAnalytics.highPriorityAlerts ? "bad" : "neutral"} />
        <InventoryKpiCard label="False Positives" value={String(dashboard.alertAnalytics.falsePositiveAlerts)} detail="Feedback loop" tone={dashboard.alertAnalytics.falsePositiveAlerts ? "watch" : "neutral"} />
        <InventoryKpiCard label="Avg Priority" value={String(dashboard.alertAnalytics.averageScore)} detail="0-100 score" />
      </section>
      {deprecatedCount ? (
        <section className="safety-strip archived-local-alerts">
          <ArchiveIcon />
          <span>{deprecatedCount} deprecated local store alert{deprecatedCount === 1 ? "" : "s"} hidden by default. Historical data is preserved for the future tracker rebuild.</span>
        </section>
      ) : null}
      <AlertCalibrationPanel dashboard={dashboard} setActiveTab={setActiveTab} />
      <PanelHeader title="Alert History" />
      <div className="table-list alerts-table">
        {visibleAlerts.length ? (
          visibleAlerts.map((alert) => {
            const saveLabel = `Reading alert ${alert.id}`;
            return (
              <form
                className={alert.read ? "table-row read" : "table-row"}
                key={alert.id}
                onSubmit={(event) =>
                  submit(
                    event,
                    saveLabel,
                    () =>
                      requestJson("/api/radar/alerts", {
                        method: "PATCH",
                        body: JSON.stringify({ alertId: alert.id })
                      }),
                    { reset: false }
                  )
                }
              >
                <span className={`chip ${statusTone(alert.priority)}`}>{alert.priority}</span>
                <strong>{alert.title}</strong>
                <span>
                  {alert.reason}
                  {alert.explanation ? ` Why: ${alert.explanation}` : ""}
                </span>
                <span>{dateTime(alert.timestamp)}</span>
                <div className="row-actions">
                  <span className={`chip ${alert.score >= 75 ? "good" : alert.score >= 45 ? "watch" : "muted"}`}>
                    Score {alert.score}
                  </span>
                  {alert.suppressedAt ? <span className="chip muted">Suppressed</span> : null}
                  {alert.falsePositiveAt ? <span className="chip bad">False positive</span> : null}
                  {alert.actionUrl ? (
                    <a className="mini-action" href={alert.actionUrl} target="_blank" rel="noreferrer">
                      Go <ExternalLink size={14} />
                    </a>
                  ) : null}
                  {!alert.falsePositiveAt ? (
                    <button
                      className="mini-action"
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        runAction(
                          `False positive alert ${alert.id}`,
                          () =>
                            requestJson("/api/radar/alerts", {
                              method: "PATCH",
                              body: JSON.stringify({ alertId: alert.id, action: "false_positive" })
                            }),
                          { confirm: `Mark ${alert.title} as a false positive?`, success: "False-positive feedback saved" }
                        )
                      }
                    >
                      <X size={14} />
                      False Positive
                    </button>
                  ) : null}
                  {!alert.read ? (
                    <button className="icon-button compact" disabled={busy} aria-label="Mark alert read" type="submit">
                      {busyLabel === saveLabel ? <RefreshCw className="spin-slow" size={15} /> : <Check size={15} />}
                    </button>
                  ) : (
                    <span className="chip muted">Read</span>
                  )}
                </div>
              </form>
            );
          })
        ) : (
          <EmptyState icon={Bell} title="No active alerts yet" detail="Inventory, order, release, and market alerts will appear here." />
        )}
      </div>
    </section>
  );
}

function configuredText(value: boolean) {
  return value ? "Configured" : "Missing";
}

function activeText(value: boolean) {
  return value ? "Active" : "Inactive";
}

function HealthCard({
  icon: Icon,
  title,
  value,
  tone,
  detail
}: {
  icon: typeof Radar;
  title: string;
  value: string;
  tone: string;
  detail: string;
}) {
  return (
    <article className="health-card">
      <div className="card-main">
        <div className="avatar">
          <Icon size={16} />
        </div>
        <div>
          <h3>{title}</h3>
          <p>{detail}</p>
        </div>
      </div>
      <span className={`chip ${statusTone(tone)}`}>{value}</span>
    </article>
  );
}

function AdminHealthPanel({ health }: { health: AppHealthDTO }) {
  const authWarningCount =
    Number(!health.auth.authReady) + Number(health.auth.adminUserCount === 0) + Number(!health.auth.configuredAdminEmailExists);
  const warningCount = health.environment.coreMissing.length + health.environment.warnings.length + authWarningCount;
  const systemChecklist = [
    {
      label: "Postgres database",
      detail: health.database.ok
        ? `${health.database.provider} is responding${health.database.productionSafe ? "" : " but is not production-safe"}`
        : health.database.error || "Database check failed",
      status: health.database.ok && health.database.productionSafe ? "Ready" : "Check",
      tone: health.database.ok && health.database.productionSafe ? "OK" : "ERROR"
    },
    {
      label: "Auth and session cookies",
      detail: `${health.auth.sessionCookieName} uses ${health.auth.secureCookie ? "secure" : "local"} ${health.auth.sameSite} cookies`,
      status: health.auth.authReady && health.auth.currentSessionValid ? "Ready" : "Check",
      tone: health.auth.authReady && health.auth.currentSessionValid ? "OK" : "ERROR"
    },
    {
      label: "Admin login",
      detail: `${health.auth.adminUserCount} admin user${health.auth.adminUserCount === 1 ? "" : "s"}; configured email ${
        health.auth.configuredAdminEmailExists ? "matches" : "needs review"
      }`,
      status: health.auth.adminUserCount > 0 && health.auth.configuredAdminEmailExists ? "Ready" : "Check",
      tone: health.auth.adminUserCount > 0 && health.auth.configuredAdminEmailExists ? "OK" : "ERROR"
    },
    {
      label: "Monitor cron protection",
      detail: `Job secret ${configuredText(health.monitor.monitorJobSecretConfigured).toLowerCase()}; Vercel bearer ${configuredText(
        health.monitor.vercelCronSecretConfigured
      ).toLowerCase()}`,
      status: health.monitor.monitorJobSecretConfigured && health.monitor.vercelCronSecretConfigured ? "Ready" : "Check",
      tone: health.monitor.monitorJobSecretConfigured && health.monitor.vercelCronSecretConfigured ? "OK" : "ERROR"
    },
    {
      label: "Monitor run history",
      detail: health.monitor.lastRunAt
        ? `Last run ${relativeTime(health.monitor.lastRunAt)} with ${health.monitor.lastStatus || "unknown"} result`
        : "No production monitor run logged yet",
      status: health.monitor.lastRunAt ? "Ready" : "Review",
      tone: health.monitor.lastRunAt ? "OK" : "WARN"
    },
    {
      label: "Push configuration",
      detail: `Public key ${configuredText(health.providers.push.publicKeyConfigured).toLowerCase()}; private key ${configuredText(
        health.providers.push.privateKeyConfigured
      ).toLowerCase()}`,
      status: health.providers.push.configured ? "Ready" : "Optional",
      tone: health.providers.push.configured ? "OK" : "WARN"
    },
    {
      label: "Backup and restore path",
      detail: "JSON export is available; production restore should be dry-run reviewed before import",
      status: "Ready",
      tone: "OK"
    },
    {
      label: "Manual checkout safety",
      detail: "Go / Buy Now opens official retailer pages only",
      status: "Ready",
      tone: "OK"
    }
  ];

  return (
    <section className="admin-tools deployment-health">
      <div className="panel-header">
        <div>
          <p className="eyeline">Production readiness</p>
          <h2>App Health</h2>
        </div>
        <span className={`chip ${statusTone(health.status)}`}>{health.status}</span>
      </div>
      <div className="health-grid">
        <HealthCard
          icon={Lock}
          title="Auth Session"
          value={health.auth.currentSessionValid ? "Active" : "Missing"}
          tone={health.auth.currentSessionValid && health.auth.authReady ? "OK" : "ERROR"}
          detail={`${health.auth.currentSessionRole || "No role"} - ${health.auth.secureCookie ? "secure" : "local"} ${health.auth.sameSite} cookie`}
        />
        <HealthCard
          icon={ShieldCheck}
          title="Auth Secret"
          value={health.auth.authSecretStrong ? "Strong" : health.auth.authSecretConfigured ? "Weak" : "Missing"}
          tone={health.auth.authReady ? "OK" : "ERROR"}
          detail={`${health.auth.sessionCookieName} - ${health.auth.sessionDays} day session`}
        />
        <HealthCard
          icon={Lock}
          title="Admin Access"
          value={health.auth.configuredAdminEmailExists ? "Ready" : "Check Env"}
          tone={health.auth.configuredAdminEmailExists && health.auth.adminUserCount > 0 ? "OK" : "ERROR"}
          detail={`${health.auth.adminUserCount} admin user${health.auth.adminUserCount === 1 ? "" : "s"} - last login ${relativeTime(
            health.auth.lastAdminLoginAt
          )}`}
        />
        <HealthCard
          icon={Activity}
          title="Database"
          value={health.database.ok ? "Online" : "Error"}
          tone={health.database.ok ? "OK" : "ERROR"}
          detail={`${health.database.provider} - ${
            health.database.provider === "postgres" ? "production safe" : "dev-only local database"
          }`}
        />
        <HealthCard
          icon={Radar}
          title="Monitor Cron"
          value={health.monitor.monitorJobSecretConfigured ? "Protected" : "Secret Missing"}
          tone={health.monitor.monitorJobSecretConfigured ? "OK" : "ERROR"}
          detail={`Last run ${relativeTime(health.monitor.lastRunAt)} - ${health.monitor.dueProductCount} due`}
        />
        <HealthCard
          icon={Bell}
          title="Last Alert"
          value={health.alerts.lastAlertPriority || "None"}
          tone={health.alerts.lastAlertPriority || "no_visit"}
          detail={health.alerts.lastAlertTitle ? `${health.alerts.lastAlertTitle} - ${relativeTime(health.alerts.lastAlertAt)}` : "No alerts sent yet"}
        />
        <HealthCard
          icon={Wifi}
          title="Browser Push"
          value={configuredText(health.providers.push.configured)}
          tone={health.providers.push.configured ? "OK" : "WARN"}
          detail={`Public ${configuredText(health.providers.push.publicKeyConfigured).toLowerCase()}, private ${configuredText(
            health.providers.push.privateKeyConfigured
          ).toLowerCase()}`}
        />
        <HealthCard
          icon={Mail}
          title="Email Alerts"
          value={configuredText(health.providers.email.configured)}
          tone={health.providers.email.configured ? "OK" : "WARN"}
          detail={`SMTP host ${configuredText(health.providers.email.smtpHostConfigured).toLowerCase()}, from ${configuredText(
            health.providers.email.smtpFromConfigured
          ).toLowerCase()}`}
        />
        <HealthCard
          icon={Smartphone}
          title="SMS Alerts"
          value={configuredText(health.providers.sms.configured)}
          tone={health.providers.sms.configured ? "OK" : "WARN"}
          detail={`Twilio SID ${configuredText(health.providers.sms.accountSidConfigured).toLowerCase()}, from ${configuredText(
            health.providers.sms.fromNumberConfigured
          ).toLowerCase()}`}
        />
        <HealthCard
          icon={PackageSearch}
          title="UPC Lookup"
          value={health.providers.upc.searchFallbackConfigured ? "Search Ready" : "UPC Only"}
          tone={health.providers.upc.searchFallbackConfigured ? "OK" : "WARN"}
          detail={`Public UPC ${configuredText(health.providers.upc.publicUpcProvider).toLowerCase()}, search ${
            health.providers.upc.searchProvider || "provider missing"
          } ${configuredText(
            health.providers.upc.searchFallbackConfigured
          ).toLowerCase()}`}
        />
      </div>
      <div className="monitor-status">
        <span>Checked {dateTime(health.checkedAt)}</span>
        <span>Env {health.environment.nodeEnv}</span>
        <span>App URL {health.environment.appUrl || "missing"}</span>
        <span>Vercel Cron bearer {configuredText(health.monitor.vercelCronSecretConfigured)}</span>
        <span>Password reset email {configuredText(health.auth.passwordResetEmailConfigured)}</span>
        <span>Delay {health.monitor.requestDelayMs}ms</span>
      </div>
      <div className="system-checklist" aria-label="System Status Checklist">
        <div className="panel-header">
          <div>
            <p className="eyeline">Owner QA</p>
            <h2>System Status Checklist</h2>
          </div>
        </div>
        <div className="checklist-grid">
          {systemChecklist.map((item) => (
            <article className="system-check-row" key={item.label}>
              <div className="avatar">
                <Check size={15} />
              </div>
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
              <span className={`chip ${statusTone(item.tone)}`}>{item.status}</span>
            </article>
          ))}
        </div>
      </div>
      {warningCount > 0 ? (
        <div className="health-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>Admin deployment warning</strong>
            <ul>
              {health.environment.coreMissing.length ? (
                <li>Missing required env vars: {health.environment.coreMissing.join(", ")}</li>
              ) : null}
              {health.environment.featureMissing.length ? (
                <li>Missing push env vars: {health.environment.featureMissing.join(", ")}</li>
              ) : null}
              {health.environment.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
              {!health.auth.authReady ? <li>AUTH_SECRET must be configured with a strong production value.</li> : null}
              {health.auth.adminUserCount === 0 ? <li>No admin users exist in the database.</li> : null}
              {!health.auth.configuredAdminEmailExists ? (
                <li>ADMIN_EMAIL seed/default does not match a database Admin user. Login uses the database Admin email.</li>
              ) : null}
              {health.monitor.lastError ? <li>Last monitor error: {health.monitor.lastError}</li> : null}
              {health.database.error ? <li>Database error: {health.database.error}</li> : null}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function NotificationSettingsPanel({
  dashboard,
  busy,
  busyLabel,
  submit,
  runAction
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  const settings = dashboard.notificationSettings;
  const [pushPermission, setPushPermission] = useState<NotificationPermission | "unsupported">(() =>
    pushSupported() ? Notification.permission : "unsupported"
  );
  const [hasPushSubscription, setHasPushSubscription] = useState(false);
  const pushReady = pushPermission === "granted" && hasPushSubscription;
  const health = dashboard.health;
  const browserPushActive = Boolean(health?.providers.push.configured && settings.browserPush && pushReady);
  const emailActive = Boolean(health?.providers.email.configured && settings.email && settings.emailTo);
  const smsActive = Boolean(health?.providers.sms.configured && settings.sms && settings.phone);

  useEffect(() => {
    let mounted = true;
    if (!pushSupported()) return;
    ensureServiceWorkerRegistration()
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (mounted) setHasPushSubscription(Boolean(subscription));
      })
      .catch(() => {
        if (mounted) setHasPushSubscription(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function enableBrowserPush() {
    if (!pushSupported()) throw new Error("This browser does not support browser push notifications.");
    const permission = await Notification.requestPermission();
    setPushPermission(permission);
    if (permission !== "granted") throw new Error("Browser push permission was not granted.");

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
    if (!publicKey) throw new Error("Add NEXT_PUBLIC_VAPID_PUBLIC_KEY before creating a push subscription.");

    const registration = await ensureServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }

    await requestJson("/api/radar/push/subscription", {
      method: "POST",
      body: JSON.stringify(subscription.toJSON())
    });
    setHasPushSubscription(true);
  }

  async function disableBrowserPush() {
    if (!pushSupported()) throw new Error("This browser does not support browser push notifications.");
    const registration = await ensureServiceWorkerRegistration();
    const subscription = await registration.pushManager.getSubscription();
    const endpoint = subscription?.endpoint;
    if (subscription) await subscription.unsubscribe();
    await requestJson("/api/radar/push/subscription", {
      method: "DELETE",
      body: JSON.stringify({ endpoint })
    });
    setHasPushSubscription(false);
  }

  async function showBrowserNotificationFallback(response: {
    notification?: {
      title: string;
      body: string;
      icon?: string;
      badge?: string;
      tag?: string;
      data?: { url?: string };
    };
  }) {
    if (!response.notification || !pushSupported()) return;
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    setPushPermission(permission);
    if (permission !== "granted") return;
    const registration = await ensureServiceWorkerRegistration();
    await registration.showNotification(response.notification.title, {
      body: response.notification.body,
      icon: response.notification.icon,
      badge: response.notification.badge,
      tag: response.notification.tag,
      data: response.notification.data
    });
  }

  return (
    <section className="admin-tools">
      <PanelHeader title="Notification Settings" />
      <div className="alert-setup-grid" aria-label="Alert provider setup status">
        <HealthCard
          icon={Wifi}
          title="Browser Push Setup"
          value={activeText(browserPushActive)}
          tone={browserPushActive ? "OK" : health?.providers.push.configured ? "WARN" : "ERROR"}
          detail={`VAPID ${configuredText(Boolean(health?.providers.push.configured)).toLowerCase()}, user ${
            settings.browserPush ? "enabled" : "disabled"
          }, permission ${pushPermission}, subscription ${hasPushSubscription ? "saved" : "missing"}`}
        />
        <HealthCard
          icon={Mail}
          title="Email Setup"
          value={activeText(emailActive)}
          tone={emailActive ? "OK" : health?.providers.email.configured ? "WARN" : "ERROR"}
          detail={`SMTP ${configuredText(Boolean(health?.providers.email.configured)).toLowerCase()}, user ${
            settings.email ? "enabled" : "disabled"
          }, destination ${settings.emailTo || "missing"}`}
        />
        <HealthCard
          icon={Smartphone}
          title="SMS Setup"
          value={activeText(smsActive)}
          tone={smsActive ? "OK" : health?.providers.sms.configured ? "WARN" : "ERROR"}
          detail={`Twilio ${configuredText(Boolean(health?.providers.sms.configured)).toLowerCase()}, user ${
            settings.sms ? "enabled" : "disabled"
          }, phone ${settings.phone || "missing"}`}
        />
      </div>
      <form
        className="form-grid"
        onSubmit={(event) =>
          submit(
            event,
            "Saving notifications",
            (form) =>
              requestJson("/api/radar/notifications", {
                method: "PATCH",
                body: JSON.stringify(formJson(form))
              }),
            { reset: false, success: "Notification settings saved" }
          )
        }
      >
        <label className="checkbox-label">
          <input name="inApp" type="hidden" value="false" />
          <input name="inApp" type="checkbox" value="true" defaultChecked={settings.inApp} />
          In-app alerts
        </label>
        <label className="checkbox-label">
          <input name="email" type="hidden" value="false" />
          <input name="email" type="checkbox" value="true" defaultChecked={settings.email} />
          Email alerts
        </label>
        <label className="checkbox-label">
          <input name="sms" type="hidden" value="false" />
          <input name="sms" type="checkbox" value="true" defaultChecked={settings.sms} />
          SMS alerts
        </label>
        <label className="checkbox-label">
          <input name="browserPush" type="hidden" value="false" />
          <input name="browserPush" type="checkbox" value="true" defaultChecked={settings.browserPush} />
          Browser push
        </label>
        <TextInput name="emailTo" label="Email destination" type="email" defaultValue={settings.emailTo ?? ""} />
        <TextInput name="phone" label="SMS phone" placeholder="+14075551212" defaultValue={settings.phone ?? ""} />
        <SelectInput
          name="minimumPriority"
          label="Minimum priority"
          defaultValue={settings.minimumPriority}
          options={priorities.map(optionFromString)}
        />
        <label className="checkbox-label">
          <input name="alertDigestMode" type="hidden" value="false" />
          <input name="alertDigestMode" type="checkbox" value="true" defaultChecked={settings.alertDigestMode} />
          Alert digest mode
        </label>
        <label className="checkbox-label">
          <input name="urgentOnlyMode" type="hidden" value="false" />
          <input name="urgentOnlyMode" type="checkbox" value="true" defaultChecked={settings.urgentOnlyMode} />
          Urgent-only mode
        </label>
        <label className="checkbox-label">
          <input name="highPriorityOverride" type="hidden" value="false" />
          <input name="highPriorityOverride" type="checkbox" value="true" defaultChecked={settings.highPriorityOverride} />
          High-priority override
        </label>
        <TextInput
          name="alertCooldownMinutes"
          label="Cooldown minutes"
          type="number"
          min="0"
          max="1440"
          defaultValue={settings.alertCooldownMinutes}
        />
        <TextareaInput
          name="watchedRetailers"
          label="Watch only retailers"
          defaultValue={settings.watchedRetailers ?? ""}
          placeholder="Target, Pokemon Center"
          wide
        />
        <TextareaInput
          name="watchedProducts"
          label="Watch only products"
          defaultValue={settings.watchedProducts ?? ""}
          placeholder="ETB, Booster Bundle, Pokemon Center"
          wide
        />
        <TextInput name="quietHoursStart" label="Quiet start" type="time" defaultValue={settings.quietHoursStart ?? ""} />
        <TextInput name="quietHoursEnd" label="Quiet end" type="time" defaultValue={settings.quietHoursEnd ?? ""} />
        <button className="primary-action" disabled={busy} type="submit">
          <Save size={16} />
          {busyLabel === "Saving notifications" ? "Saving" : "Save Notifications"}
        </button>
      </form>
      <div className="push-panel">
        <div className="push-status-grid">
          <div>
            <strong>Browser Push</strong>
            <span>
              Permission {pushPermission}; subscription {hasPushSubscription ? "saved" : "not saved"}.
            </span>
          </div>
          <span className={`chip ${pushReady ? "good" : pushPermission === "denied" ? "bad" : "watch"}`}>
            {pushReady ? "Ready" : pushPermission === "unsupported" ? "Unsupported" : "Setup needed"}
          </span>
        </div>
        <p className="push-copy">
          Push alerts can open Inventory, Orders, Alerts, Releases, or the storefront. Products, Stores, and Cards modules are currently hidden for rebuild.
        </p>
        <div className="admin-actions">
          <button
            className="mini-action solid"
            disabled={busy}
            type="button"
            onClick={() =>
              runAction("Enabling browser push", enableBrowserPush, { success: "Browser push enabled" })
            }
          >
            <Wifi size={14} />
            {busyLabel === "Enabling browser push" ? "Enabling" : "Enable Browser Push"}
          </button>
          <button
            className="mini-action"
            disabled={busy || !hasPushSubscription}
            type="button"
            onClick={() =>
              runAction("Disabling browser push", disableBrowserPush, { success: "Browser push disabled" })
            }
          >
            <WifiOff size={14} />
            {busyLabel === "Disabling browser push" ? "Disabling" : "Disable Browser Push"}
          </button>
        </div>
      </div>
      <div className="admin-actions">
        <button
          className="mini-action solid"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              "Testing all alerts",
              () => requestJson("/api/radar/notifications/test-all", { method: "POST" }),
              { success: "All-alert test completed" }
            )
          }
        >
          <Bell size={14} />
          {busyLabel === "Testing all alerts" ? "Testing" : "Test All Alerts"}
        </button>
        <button
          className="mini-action"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              "Testing in-app alert",
              () =>
                requestJson("/api/radar/notifications/test", {
                  method: "POST",
                  body: JSON.stringify({ channel: "inApp" })
                }),
              { success: "In-app test created" }
            )
          }
        >
          <Bell size={14} />
          {busyLabel === "Testing in-app alert" ? "Testing" : "Test In-App"}
        </button>
        <button
          className="mini-action"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              "Testing email alert",
              () =>
                requestJson("/api/radar/notifications/test", {
                  method: "POST",
                  body: JSON.stringify({ channel: "email" })
                }),
              { success: "Email test sent" }
            )
          }
        >
          <Mail size={14} />
          {busyLabel === "Testing email alert" ? "Testing" : "Test Email"}
        </button>
        <button
          className="mini-action"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              "Testing SMS alert",
              () =>
                requestJson("/api/radar/notifications/test", {
                  method: "POST",
                  body: JSON.stringify({ channel: "sms" })
                }),
              { success: "SMS test sent" }
            )
          }
        >
          <Smartphone size={14} />
          {busyLabel === "Testing SMS alert" ? "Testing" : "Test SMS"}
        </button>
        <button
          className="mini-action"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction(
              "Testing browser push",
              async () => {
                const response = await requestJson<{
                  ok: boolean;
                  fallback?: boolean;
                  result?: string;
                  notification?: {
                    title: string;
                    body: string;
                    icon?: string;
                    badge?: string;
                    tag?: string;
                    data?: { url?: string };
                  };
                }>("/api/radar/push/test", { method: "POST" });
                await showBrowserNotificationFallback(response);
              },
              { success: "Browser push test handled" }
            )
          }
        >
          <Wifi size={14} />
          {busyLabel === "Testing browser push" ? "Testing" : "Test Browser Push"}
        </button>
      </div>
    </section>
  );
}

function AccessManagementPanel({
  dashboard,
  busy,
  busyLabel,
  runAction
}: {
  dashboard: DashboardDTO;
  busy: boolean;
  busyLabel: string | null;
  runAction: ActionHandler;
}) {
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  function inviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    runAction(
      "Creating friend invite",
      async () => {
        const result = await requestJson<{ invite: { inviteUrl?: string } }>("/api/radar/invites", {
          method: "POST",
          body: JSON.stringify(formJson(form))
        });
        setLastInviteUrl(result.invite.inviteUrl ?? null);
        form.reset();
      },
      { success: "Friend invite created" }
    );
  }

  function userAccessSubmit(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    runAction(
      "Saving user access",
      () =>
        requestJson(`/api/radar/users/${userId}`, {
          method: "PATCH",
          body: JSON.stringify(formJson(form))
        }),
      { success: "User access saved" }
    );
  }

  return (
    <section className="admin-tools access-panel">
      <div className="panel-header">
        <div>
          <p className="eyeline">Invite-only access</p>
          <h2>User Management</h2>
        </div>
        <span className="chip good">No public signup</span>
      </div>
      <form className="form-grid" onSubmit={inviteSubmit}>
        <TextInput name="email" label="Friend email" type="email" autoComplete="email" required />
        <TextInput name="name" label="Friend name" autoComplete="name" />
        <label className="checkbox-label">
          <input name="canAddSightings" type="hidden" value="false" />
          <input name="canAddSightings" type="checkbox" value="true" defaultChecked />
          Add sightings
        </label>
        <label className="checkbox-label">
          <input name="canAddComps" type="hidden" value="false" />
          <input name="canAddComps" type="checkbox" value="true" />
          Add comps
        </label>
        <label className="checkbox-label">
          <input name="canRunChecks" type="hidden" value="false" />
          <input name="canRunChecks" type="checkbox" value="true" />
          Run checks
        </label>
        <label className="checkbox-label">
          <input name="canReceivePushAlerts" type="hidden" value="false" />
          <input name="canReceivePushAlerts" type="checkbox" value="true" defaultChecked />
          Push alerts
        </label>
        <button className="primary-action" disabled={busy} type="submit">
          <Plus size={16} />
          {busyLabel === "Creating friend invite" ? "Creating" : "Create Invite"}
        </button>
      </form>
      {lastInviteUrl ? (
        <div className="invite-url-box">
          <div>
            <strong>Single-use invite link</strong>
            <span>Expires in 7 days. Share only with the invited friend.</span>
          </div>
          <input value={lastInviteUrl} readOnly />
          <button
            className="mini-action solid"
            type="button"
            onClick={() => navigator.clipboard?.writeText(lastInviteUrl)}
          >
            <FileText size={14} />
            Copy Link
          </button>
        </div>
      ) : null}
      <div className="access-grid">
        {dashboard.users.map((friend) => {
          const isSelf = friend.id === dashboard.currentUser.id;
          return (
            <article className="data-card" key={friend.id}>
              <div className="card-main">
                <div className="avatar">
                  <ShieldCheck size={16} />
                </div>
                <div>
                  <h3>{friend.name}</h3>
                  <p>
                    {friend.email} - {friend.role} - {friend.disabledAt ? "disabled" : "active"} - last login{" "}
                    {relativeTime(friend.lastLoginAt)}
                  </p>
                </div>
              </div>
              <form className="access-form" onSubmit={(event) => userAccessSubmit(event, friend.id)}>
                <SelectInput
                  name="role"
                  label="Role"
                  defaultValue={friend.role}
                  options={[
                    { value: "ADMIN", label: "Admin" },
                    { value: "FRIEND", label: "Friend" }
                  ]}
                  disabled={isSelf}
                />
                <label className="checkbox-label">
                  <input name="canAddSightings" type="hidden" value="false" />
                  <input name="canAddSightings" type="checkbox" value="true" defaultChecked={friend.canAddSightings} />
                  Add sightings
                </label>
                <label className="checkbox-label">
                  <input name="canAddComps" type="hidden" value="false" />
                  <input name="canAddComps" type="checkbox" value="true" defaultChecked={friend.canAddComps} />
                  Add comps
                </label>
                <label className="checkbox-label">
                  <input name="canRunChecks" type="hidden" value="false" />
                  <input name="canRunChecks" type="checkbox" value="true" defaultChecked={friend.canRunChecks} />
                  Run checks
                </label>
                <label className="checkbox-label">
                  <input name="canReceivePushAlerts" type="hidden" value="false" />
                  <input
                    name="canReceivePushAlerts"
                    type="checkbox"
                    value="true"
                    defaultChecked={friend.canReceivePushAlerts}
                  />
                  Push alerts
                </label>
                <label className="checkbox-label">
                  <input name="disabled" type="hidden" value="false" />
                  <input name="disabled" type="checkbox" value="true" defaultChecked={Boolean(friend.disabledAt)} disabled={isSelf} />
                  Disabled
                </label>
                <button className="mini-action solid" disabled={busy} type="submit">
                  <Save size={14} />
                  {busyLabel === "Saving user access" ? "Saving" : "Save Access"}
                </button>
              </form>
            </article>
          );
        })}
      </div>
      <div className="split-grid">
        <section className="push-panel">
          <h3>Pending Invites</h3>
          {dashboard.friendInvites.length ? (
            dashboard.friendInvites.slice(0, 8).map((invite) => (
              <div className="access-row" key={invite.id}>
                <div>
                  <strong>{invite.email}</strong>
                  <span>
                    {invite.acceptedAt ? "accepted" : invite.revokedAt ? "revoked" : "pending"} - expires{" "}
                    {relativeTime(invite.expiresAt)}
                  </span>
                </div>
                {!invite.acceptedAt && !invite.revokedAt ? (
                  <button
                    className="mini-action"
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      runAction(
                        "Revoking invite",
                        () => requestJson(`/api/radar/invites/${invite.id}`, { method: "DELETE" }),
                        { confirm: `Revoke invite for ${invite.email}?`, success: "Invite revoked" }
                      )
                    }
                  >
                    <X size={14} />
                    Revoke
                  </button>
                ) : null}
              </div>
            ))
          ) : (
            <EmptyState icon={Lock} title="No invites yet" detail="Create a single-use invite when a friend needs access." />
          )}
        </section>
        <section className="push-panel">
          <h3>Audit Log</h3>
          {dashboard.auditLogs.length ? (
            dashboard.auditLogs.slice(0, 10).map((log) => (
              <div className="access-row" key={log.id}>
                <div>
                  <strong>{log.action}</strong>
                  <span>
                    {log.summary} - {relativeTime(log.createdAt)}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              icon={History}
              title="No audit events"
              detail="Invites, logins, sightings, comps, checks, reports, and settings changes will appear here."
            />
          )}
        </section>
      </div>
    </section>
  );
}

function AdminTools({
  busy,
  busyLabel,
  submit,
  runAction
}: {
  busy: boolean;
  busyLabel: string | null;
  submit: SubmitHandler;
  runAction: ActionHandler;
}) {
  async function exportBackup() {
    const payload = await requestJson<unknown>("/api/radar/backup");
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `poke-restock-radar-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="admin-tools">
      <PanelHeader title="Admin Settings" />
      <div className="safety-strip manual-safety">
        <ShieldCheck size={16} />
        <span>
          This private radar tracks public pages and manual sightings only. Every checkout action stays manual on the
          official retailer site.
        </span>
      </div>
      <div className="admin-actions">
        <button
          className="mini-action"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction("Exporting backup", exportBackup, { reload: false, success: "Backup exported" })
          }
        >
          <Download size={14} />
          {busyLabel === "Exporting backup" ? "Exporting" : "Export JSON Backup"}
        </button>
        <button
          className="mini-action danger"
          disabled={busy}
          type="button"
          onClick={() =>
            runAction("Resetting demo data", () => requestJson("/api/radar/admin/reset", { method: "POST" }), {
              confirm: "Reset demo data? This clears current products, stores, sightings, releases, cards, and alerts.",
              success: "Demo data reset"
            })
          }
        >
          <RotateCcw size={14} />
          {busyLabel === "Resetting demo data" ? "Resetting" : "Reset Demo Data"}
        </button>
      </div>
      <form
        className="backup-form"
        onSubmit={(event) =>
          submit(
            event,
            "Importing backup",
            (form) => {
              const raw = String(new FormData(form).get("backupJson") || "").trim();
              if (!raw) throw new Error("Paste a JSON backup before importing.");
              let payload: unknown;
              try {
                payload = JSON.parse(raw);
              } catch {
                throw new Error("Backup JSON is invalid.");
              }
              return requestJson("/api/radar/backup", { method: "POST", body: JSON.stringify(payload) });
            },
            { success: "Backup imported" }
          )
        }
      >
        <label className="wide-field">
          Import JSON backup
          <textarea name="backupJson" rows={5} placeholder="{ &quot;version&quot;: 1, &quot;tables&quot;: { ... } }" />
        </label>
        <button className="primary-action" disabled={busy} type="submit">
          <Upload size={16} />
          {busyLabel === "Importing backup" ? "Importing" : "Import Backup"}
        </button>
        <p>
          Import replaces all app data with the backup payload. Use export first if you need a point-in-time restore.
        </p>
      </form>
    </section>
  );
}

function TextInput({
  name,
  label,
  wide,
  ...props
}: {
  name: string;
  label: string;
  wide?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={wide ? "wide-field" : undefined}>
      {label}
      <input name={name} {...props} />
    </label>
  );
}

function TextareaInput({
  name,
  label,
  wide,
  ...props
}: {
  name: string;
  label: string;
  wide?: boolean;
} & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className={wide ? "wide-field" : undefined}>
      {label}
      <textarea name={name} rows={3} {...props} />
    </label>
  );
}

function SelectInput({
  name,
  label,
  options,
  defaultValue,
  ...props
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
} & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={defaultValue} {...props}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StoreSelectInput({
  name,
  label,
  stores,
  defaultValue
}: {
  name: string;
  label: string;
  stores: StoreDTO[];
  defaultValue?: string;
}) {
  const [query, setQuery] = useState("");
  const sortedStores = useMemo(() => sortedStoreOptions(stores), [stores]);
  const filteredStores = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return sortedStores;
    return sortedStores.filter((store) => storeSearchText(store).includes(normalized));
  }, [query, sortedStores]);
  const selectedStore = defaultValue ? sortedStores.find((store) => store.id === defaultValue) : null;
  const visibleStores =
    selectedStore && !filteredStores.some((store) => store.id === selectedStore.id)
      ? [selectedStore].concat(filteredStores)
      : filteredStores;

  return (
    <label className="store-select-field">
      {label}
      <input
        aria-label={`${label} search`}
        placeholder="Search saved stores by name, city, retailer, or distance"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <select name={name} defaultValue={defaultValue}>
        {visibleStores.map((store) => (
          <option key={store.id} value={store.id}>
            {storeOptionLabel(store)}
          </option>
        ))}
      </select>
      <small>{visibleStores.length} saved store{visibleStores.length === 1 ? "" : "s"} shown, favorites and closest first.</small>
    </label>
  );
}

function optionFromRetailer(retailer: RetailerDTO) {
  return { value: retailer.id, label: retailer.name };
}

function templateForRetailer(
  retailerId: string,
  retailers: RetailerDTO[],
  templates: RetailerTemplateDTO[]
) {
  const retailer = retailers.find((item) => item.id === retailerId);
  return templates.find((template) => template.retailerName === retailer?.name) ?? null;
}

function releaseOptions(releases: ReleaseDTO[]) {
  return [{ value: "", label: "No Release Link" }].concat(
    releases.map((release) => ({ value: release.id, label: release.setName }))
  );
}

function optionFromString(value: string) {
  return { value, label: formatStatus(value) };
}

const inventoryHiddenUiRegistry = [
  [
    "Add Existing Product Purchase",
    "Inventory Details",
    "Market Data",
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
    "What should I sell today?",
    "Best hold",
    "Avoid buying more",
    "Missing Market Data",
    "Attach watched product",
    "Manual Inventory Sold Comp",
    "Market not collected yet"
  ],
  inventoryRecommendations,
  inventoryRecommendationTone,
  inventoryMarketBadges,
  inventoryMarketTableValue,
  inventoryMarketTone,
  InventoryMarketDecisionPanels,
  InventoryMarketHero,
  InventoryInlineCompForm,
  AttachWatchedProductForm,
  StockLotsPanel,
  SelectedSalesPanel,
  InventoryCompForm
] as const;
