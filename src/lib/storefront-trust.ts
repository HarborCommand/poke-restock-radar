import { GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL } from "@/lib/storefront-routing";

export const GAMEDAYGRABS_LEGAL_NAME = "GameDayGrabs LLC";
export const GAMEDAYGRABS_STORE_NAME = "GameDayGrabs";
export const GAMEDAYGRABS_SUPPORT_EMAIL = GAMEDAYGRABS_PUBLIC_CONTACT_EMAIL;
export const GAMEDAYGRABS_SUPPORT_HOURS = "Online email support. Messages are reviewed on business days.";
export const GAMEDAYGRABS_RESPONSE_TIME = "Target response time: 1-2 business days.";
export const GAMEDAYGRABS_SERVICE_AREA = "U.S. online shipping where checkout shipping is available.";
export const GAMEDAYGRABS_LOCAL_PICKUP_SUMMARY =
  "Local pickup is available by appointment only when it appears at checkout. Pickup details are shared after purchase.";
export const GAMEDAYGRABS_NO_STOREFRONT_HOURS =
  "GameDayGrabs does not publish public walk-in storefront hours. Contact support before planning any pickup.";

export const storefrontPolicyLinks = [
  { href: "/policies/shipping", label: "Shipping Policy" },
  { href: "/policies/returns", label: "Return & Refund Policy" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/terms", label: "Terms of Service" }
] as const;

export const storefrontTrustLinks = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  ...storefrontPolicyLinks
] as const;

export const shippingPolicySections = [
  {
    title: "Where We Ship",
    body: [
      "GameDayGrabs accepts U.S. online orders when shipping is available for the items in the cart.",
      "Checkout blocks shipping when an item or destination cannot be safely fulfilled. International shipping is not offered through the public checkout unless the checkout page clearly shows it."
    ]
  },
  {
    title: "Carriers and Services",
    body: [
      "Shipping is primarily quoted with USPS services when calculated shipping is enabled.",
      "The service name shown in the cart or checkout is the customer-facing shipping service for that order. GameDayGrabs may use an equivalent carrier service when needed to fulfill the order safely."
    ]
  },
  {
    title: "Processing Time",
    body: [
      "Orders are normally prepared after payment is confirmed and inventory is verified.",
      "Most orders are prepared within 1-2 business days. High-volume drops, address issues, weather, carrier delays, or fraud checks can add time."
    ]
  },
  {
    title: "Shipping Costs",
    body: [
      "Shipping costs are shown before payment. When USPS calculated shipping is available, customers enter a ZIP code in the cart to see the shipping amount before continuing to Stripe Checkout.",
      "Shipping is calculated using packed product weight, package size, destination ZIP code, and store shipping rules. GameDayGrabs does not add hidden fees after payment."
    ]
  },
  {
    title: "Local Pickup",
    body: [
      GAMEDAYGRABS_LOCAL_PICKUP_SUMMARY,
      "Local pickup is separate from shipping and is not available for every item or every order."
    ]
  },
  {
    title: "Tracking",
    body: [
      "Tracking is added to the order when a shipment is created and tracking is available from the carrier.",
      "Customers can use the order status page or contact support with their order number for shipment help."
    ]
  },
  {
    title: "Lost or Delayed Packages",
    body: [
      "Carrier scans and delivery estimates can change after shipment. If tracking stops updating or a package appears lost, contact support with the order number.",
      "GameDayGrabs will review the carrier tracking, delivery address, and shipment details before deciding whether a replacement, refund, carrier claim, or other resolution is appropriate."
    ]
  }
] as const;

export const returnPolicySections = [
  {
    title: "Return Window",
    body: [
      "Sealed trading card products are generally final sale and are not eligible for buyer-remorse returns or exchanges.",
      "Order issue claims for damaged, incorrect, missing, or materially different items must be sent within 3 calendar days of delivery."
    ]
  },
  {
    title: "Condition Requirements",
    body: [
      "Approved returns must be returned in the condition received, with original packaging and contents included.",
      "Opened, searched, resealed, tampered-with, or incomplete trading card products are not eligible for return unless GameDayGrabs determines there was a verified fulfillment or shipping issue."
    ]
  },
  {
    title: "Sealed Product Policy",
    body: [
      "All sealed trading card products, including Pokemon TCG products, sports cards, booster packs, booster bundles, tins, blisters, decks, premium collections, and similar products, are final sale.",
      "This policy exists because sealed trading card products can be opened, searched, resealed, tampered with, or affected by market value changes after delivery."
    ]
  },
  {
    title: "Damaged, Incorrect, or Missing Items",
    body: [
      "Contact support with the order number, photos of the package, photos of the product condition, photos of the shipping label, and a short explanation of the issue.",
      "GameDayGrabs will review the claim and may offer a replacement, refund, partial refund, carrier claim, or another reasonable resolution after review."
    ]
  },
  {
    title: "Refund Timing",
    body: [
      "Approved refunds are processed back to the original payment method when possible.",
      "Refunds typically appear within 3-10 business days after approval, depending on the bank, card issuer, payment provider, and payment method."
    ]
  },
  {
    title: "Return Shipping",
    body: [
      "If GameDayGrabs approves a return because of a verified fulfillment error or shipping issue, return instructions will be provided.",
      "If a return is approved for another reason, the customer may be responsible for return shipping unless GameDayGrabs states otherwise in writing."
    ]
  },
  {
    title: "Cancellations",
    body: [
      "Paid orders may be canceled before shipment when eligible. Orders that have already shipped must follow the order issue process.",
      "Orders suspected of fraud, payment risk, address issues, or inventory errors may be canceled and refunded."
    ]
  }
] as const;

export const privacyPolicySections = [
  {
    title: "Information We Collect",
    body: [
      "GameDayGrabs collects the information needed to process orders and support requests, including name, email, phone number when provided, shipping address, billing details handled by payment providers, cart contents, order history, and messages sent through contact forms.",
      "Payment card numbers and CVC codes are handled by Stripe when Stripe Checkout is used. GameDayGrabs does not store raw card numbers or CVC codes."
    ]
  },
  {
    title: "How Information Is Used",
    body: [
      "Customer information is used to process checkout, calculate shipping, fulfill orders, provide order support, prevent fraud, maintain customer accounts when enabled, and send order-related messages.",
      "GameDayGrabs may also use aggregate store and order information to improve inventory planning, fulfillment, and customer support."
    ]
  },
  {
    title: "Service Providers",
    body: [
      "GameDayGrabs uses service providers for checkout, payment processing, shipping, email, hosting, analytics, fraud prevention, and order operations.",
      "Those providers receive only the information needed to provide their services."
    ]
  },
  {
    title: "Customer Choices",
    body: [
      "Customers can contact support to ask about an order, request help with account information, or ask privacy questions.",
      "Guest checkout remains available when customer accounts are enabled."
    ]
  },
  {
    title: "Data Protection",
    body: [
      "GameDayGrabs uses HTTPS and keeps customer-facing order information focused on checkout, fulfillment, pickup, and support needs.",
      "No website can guarantee perfect security, but GameDayGrabs limits access to customer information and avoids storing raw payment card details."
    ]
  }
] as const;

export const termsSections = [
  {
    title: "Store Use",
    body: [
      "By using GameDayGrabs, customers agree to provide accurate contact, shipping, billing, and order information.",
      "GameDayGrabs may refuse, cancel, or refund orders when information is inaccurate, payment cannot be verified, inventory is unavailable, shipping is not available, or fraud/risk checks require cancellation."
    ]
  },
  {
    title: "Product Listings",
    body: [
      "Product listings show current customer-facing availability, condition, images, purchase limits, and prices when published.",
      "Availability can change before checkout is completed. Items are reserved only when checkout begins and payment is completed within the checkout hold window."
    ]
  },
  {
    title: "Pricing, Taxes, and Shipping",
    body: [
      "Product prices are shown in U.S. dollars. Shipping is shown before payment when checkout shipping is available.",
      "Taxes, shipping, discounts, and totals are calculated through checkout or order processing. GameDayGrabs does not rely on browser-provided totals for final order handling."
    ]
  },
  {
    title: "Payments",
    body: [
      "Stripe securely handles card checkout when Stripe Checkout is available. GameDayGrabs does not store raw card numbers or CVC codes.",
      "Manual invoice or local pickup flows may be offered only when clearly shown."
    ]
  },
  {
    title: "Returns and Order Issues",
    body: [
      "Returns, refunds, cancellations, damaged packages, missing items, and incorrect-item claims are handled under the Return & Refund Policy.",
      "Customers should contact support before sending any product back."
    ]
  },
  {
    title: "Trademarks",
    body: [
      "GameDayGrabs is not affiliated with The Pokemon Company International, Nintendo, Creatures Inc., GAME FREAK inc., sports leagues, teams, card manufacturers, or other trademark owners unless a page states otherwise with proof.",
      "All trademarks are property of their respective owners."
    ]
  }
] as const;
