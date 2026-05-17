import type { Priority } from "@/types/radar";

export type RetailerTemplate = {
  retailerName: string;
  urlPattern: string;
  urlPatternLabel: string;
  statusWords: {
    inStock: string[];
    soldOut: string[];
    preorder: string[];
    addToCart: string[];
    unavailable: string[];
    pageBlocked: string[];
    captcha: string[];
    pageChanged: string[];
    price: string[];
  };
  safeSelectors: string[];
  identifierFields: string[];
  alertPriorityDefault: Priority;
  monitorNotes: string;
};

export const retailerTemplates: RetailerTemplate[] = [
  {
    retailerName: "Pokemon Center",
    urlPattern: "^https://(?:www\\.)?pokemoncenter\\.com/",
    urlPatternLabel: "pokemoncenter.com product URL",
    statusWords: {
      inStock: ["in stock", "available now"],
      soldOut: ["sold out", "unavailable", "out of stock"],
      preorder: ["preorder", "pre-order"],
      addToCart: ["add to cart", "add to bag"],
      unavailable: ["unavailable", "not available", "temporarily unavailable"],
      pageBlocked: ["access denied", "queue-it", "waiting room", "temporarily blocked"],
      captcha: ["captcha", "verify you are human", "robot check"],
      pageChanged: ["product details", "notify me", "coming soon"],
      price: ["price", "$"]
    },
    safeSelectors: ["script[type='application/ld+json']", "[itemprop='availability']", "button, [role='button']"],
    identifierFields: ["SKU", "UPC"],
    alertPriorityDefault: "HIGH",
    monitorNotes: "Public product pages only. Respect Pokemon Center queues, captcha, account checks, and purchase limits."
  },
  {
    retailerName: "Target",
    urlPattern: "^https://(?:www\\.)?target\\.com/(?:p/|s(?:/|\\?))",
    urlPatternLabel: "target.com /p/ product URL or /s search URL",
    statusWords: {
      inStock: ["in stock", "available to ship", "available at"],
      soldOut: ["sold out", "out of stock", "not available"],
      preorder: ["preorder", "pre-order"],
      addToCart: ["add to cart", "add for shipping", "ship it"],
      unavailable: ["not available", "currently unavailable", "out of stock"],
      pageBlocked: ["access denied", "request blocked", "security check", "akamai"],
      captcha: ["captcha", "robot", "verify you are human"],
      pageChanged: ["shipping", "pickup", "returns", "highlights"],
      price: ["current_retail", "price", "$"]
    },
    safeSelectors: ["script[type='application/ld+json']", "[data-test*='fulfillment']", "button, [role='button']"],
    identifierFields: ["DPCI", "UPC", "TCIN", "SKU"],
    alertPriorityDefault: "HIGH",
    monitorNotes: "Use official product/search pages only. DPCI is useful for store matching and manual shelf checks."
  },
  {
    retailerName: "Walmart",
    urlPattern: "^https://(?:www\\.)?walmart\\.com/(?:ip|search)",
    urlPatternLabel: "walmart.com /ip/ or search URL",
    statusWords: {
      inStock: ["in stock", "available", "pickup", "delivery"],
      soldOut: ["out of stock", "sold out", "currently unavailable"],
      preorder: ["preorder", "pre-order"],
      addToCart: ["add to cart"],
      unavailable: ["currently unavailable", "not available", "out of stock"],
      pageBlocked: ["blocked", "access denied", "press and hold", "validate your request"],
      captcha: ["captcha", "robot or human", "verify your identity"],
      pageChanged: ["seller", "shipping", "pickup", "delivery"],
      price: ["price", "$"]
    },
    safeSelectors: ["script[type='application/ld+json']", "[data-testid*='add-to-cart']", "button, [role='button']"],
    identifierFields: ["SKU", "UPC", "Walmart item ID"],
    alertPriorityDefault: "MEDIUM",
    monitorNotes: "Walmart pages can vary by location. Treat page checks as advisory and complete all checkout manually."
  },
  {
    retailerName: "Best Buy",
    urlPattern: "^https://(?:www\\.)?bestbuy\\.com/site/",
    urlPatternLabel: "bestbuy.com /site/ product URL",
    statusWords: {
      inStock: ["add to cart", "available", "ready for pickup"],
      soldOut: ["sold out", "unavailable", "coming soon"],
      preorder: ["pre-order", "preorder"],
      addToCart: ["add to cart"],
      unavailable: ["unavailable nearby", "not available", "coming soon"],
      pageBlocked: ["access denied", "request blocked", "temporarily unavailable"],
      captcha: ["captcha", "verify you are human", "robot"],
      pageChanged: ["pickup", "shipping", "customer reviews"],
      price: ["price", "$"]
    },
    safeSelectors: ["script[type='application/ld+json']", ".add-to-cart-button", "button, [role='button']"],
    identifierFields: ["SKU", "UPC"],
    alertPriorityDefault: "MEDIUM",
    monitorNotes: "Best Buy inventory can be local. Monitor public product pages and manually verify pickup/shipping."
  },
  {
    retailerName: "GameStop",
    urlPattern: "^https://(?:www\\.)?gamestop\\.com/",
    urlPatternLabel: "gamestop.com product URL",
    statusWords: {
      inStock: ["add to cart", "available", "ship to home"],
      soldOut: ["not available", "out of stock", "unavailable"],
      preorder: ["pre-order", "preorder"],
      addToCart: ["add to cart"],
      unavailable: ["not available", "unavailable", "out of stock"],
      pageBlocked: ["access denied", "blocked", "queue", "waiting room"],
      captcha: ["captcha", "robot", "verify you are human"],
      pageChanged: ["ship to home", "pick up", "pro"],
      price: ["price", "$"]
    },
    safeSelectors: ["script[type='application/ld+json']", "button, [role='button']", "[data-availability]"],
    identifierFields: ["SKU", "UPC"],
    alertPriorityDefault: "HIGH",
    monitorNotes: "Use public product pages only. Do not automate account, cart, Pro-only, queue, or checkout actions."
  },
  {
    retailerName: "Amazon",
    urlPattern: "^https://(?:www\\.)?amazon\\.com/(?:dp|gp/product|[^?]+/dp)/",
    urlPatternLabel: "amazon.com /dp/ or /gp/product/ URL",
    statusWords: {
      inStock: ["in stock", "available from", "ships from"],
      soldOut: ["currently unavailable", "temporarily out of stock", "unavailable"],
      preorder: ["pre-order", "preorder"],
      addToCart: ["add to cart", "buy now"],
      unavailable: ["currently unavailable", "temporarily out of stock", "not available"],
      pageBlocked: ["sorry, we just need to make sure", "automated access", "access denied"],
      captcha: ["enter the characters you see below", "captcha", "robot check"],
      pageChanged: ["ships from", "sold by", "buy box", "other sellers"],
      price: ["priceblock", "$"]
    },
    safeSelectors: ["#availability", "#priceblock_ourprice", "#corePrice_feature_div", "script[type='application/ld+json']"],
    identifierFields: ["ASIN", "UPC"],
    alertPriorityDefault: "MEDIUM",
    monitorNotes: "Amazon pages change heavily by seller/location. Use alerts as a manual prompt; never automate buying."
  }
];

export function templateForRetailerName(retailerName: string | null | undefined) {
  if (!retailerName) return null;
  return retailerTemplates.find((template) => template.retailerName.toLowerCase() === retailerName.toLowerCase()) ?? null;
}

export function validateRetailerUrl(retailerName: string, url: string) {
  const template = templateForRetailerName(retailerName);
  if (!template) return;
  if (!new RegExp(template.urlPattern, "i").test(url)) {
    throw new Error(`${retailerName} URL must match ${template.urlPatternLabel}.`);
  }
}
