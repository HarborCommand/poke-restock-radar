export type GrabbyVariant =
  | "welcome"
  | "empty-cart"
  | "rewards"
  | "order-status"
  | "shipping"
  | "support"
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
    title: "Keep earning with Grabby.",
    message: "Earn points on eligible purchases. Rewards redemption is coming soon."
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
  error: {
    title: "Grabby could not find that page.",
    message: "The page may have moved, but you can keep shopping."
  }
};
