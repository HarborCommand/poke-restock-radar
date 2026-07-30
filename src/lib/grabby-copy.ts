export type GrabbyVariant =
  | "welcome"
  | "empty-cart"
  | "rewards"
  | "order-status"
  | "shipping"
  | "support"
  | "shop-guide"
  | "category-guide"
  | "product-helper"
  | "policies-support"
  | "contact-support"
  | "error";

export type GrabbyCopy = {
  title: string;
  message: string;
  ctaLabel?: string;
};

export const GRABBY_NAME = "Grabby";
export const GRABBY_TAGLINE = "Your collection sidekick";
export const GRABBY_ALT_TEXT = "Grabby, the GameDayGrabs collection sidekick";

export const grabbyCopy: Record<GrabbyVariant, GrabbyCopy> = {
  welcome: {
    title: "Meet Grabby",
    message: "Your collection sidekick is here to help you track orders, rewards, and new drops."
  },
  "empty-cart": {
    title: "Your cart is waiting for a new pull.",
    message: "Grabby can help you find sealed products, tins, blisters, and fresh drops.",
    ctaLabel: "Shop New Arrivals"
  },
  rewards: {
    title: "Rewards are being prepared.",
    message: "Reward earning is currently paused. Your account is ready for future rewards and redemption is coming soon."
  },
  "order-status": {
    title: "Tracking your order?",
    message: "Grabby can help you check shipping, pickup, or refund status with your order number and email."
  },
  shipping: {
    title: "Packed with care.",
    message: "Orders are packed carefully and shipped with USPS calculated rates when available."
  },
  support: {
    title: "Need help?",
    message: "Grabby can point you to order status, policies, and support."
  },
  "shop-guide": {
    title: "Need help finding your next drop?",
    message: "Use filters to browse booster bundles, tins, blisters, and premium collections.",
    ctaLabel: "View New Arrivals"
  },
  "category-guide": {
    title: "Grabby's tip",
    message: "Start with active listings, then jump to related collections when you want to compare product types."
  },
  "product-helper": {
    title: "Grabby says",
    message: "Checkout is secure, shipping is calculated by ZIP, and guest checkout is always available."
  },
  "policies-support": {
    title: "Questions about an order?",
    message: "Grabby can point you to order status, policies, and support.",
    ctaLabel: "Check order status"
  },
  "contact-support": {
    title: "Need help?",
    message: "Send us your order number and we will help with shipping, pickup, or product questions."
  },
  error: {
    title: "Grabby could not find that page.",
    message: "The page may have moved, but you can keep shopping."
  }
};
