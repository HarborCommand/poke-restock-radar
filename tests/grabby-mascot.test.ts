import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { grabbyCopy, type GrabbyVariant } from "../src/lib/grabby-copy";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const variants: GrabbyVariant[] = ["welcome", "empty-cart", "rewards", "order-status", "shipping", "support", "error"];

test("Grabby mascot copy covers every safe reusable variant", () => {
  for (const variant of variants) {
    assert.ok(grabbyCopy[variant], `missing ${variant} copy`);
    assert.ok(grabbyCopy[variant].title.length > 4, `missing ${variant} title`);
    assert.ok(grabbyCopy[variant].message.length > 16, `missing ${variant} message`);
  }

  assert.match(grabbyCopy.welcome.title, /Meet Grabby/);
  assert.match(grabbyCopy.welcome.message, /collection sidekick/);
  assert.match(grabbyCopy["empty-cart"].title, /waiting for a new pull/);
  assert.match(grabbyCopy["empty-cart"].ctaLabel ?? "", /Shop New Arrivals/);
  assert.match(grabbyCopy.rewards.message, /Rewards redemption is coming soon/);
  assert.match(grabbyCopy["order-status"].message, /order number and email/);
  assert.match(grabbyCopy.shipping.message, /USPS calculated rates/);
  assert.match(grabbyCopy.support.message, /order status, policies, and support/);
  assert.match(grabbyCopy.error.title, /Grabby could not find that page/);
});

test("Grabby components render consistent original brand-safe mascot structure", () => {
  const mascot = readProjectFile("src/components/brand/GrabbyMascot.tsx");
  const card = readProjectFile("src/components/brand/GrabbyCard.tsx");
  const copy = readProjectFile("src/lib/grabby-copy.ts");
  const css = readProjectFile("src/app/globals.css");

  assert.match(mascot, /GRABBY_ALT_TEXT/);
  assert.match(mascot, /grabby-cap-crown/);
  assert.match(mascot, />G</);
  assert.match(mascot, /grabby-face/);
  assert.match(mascot, /grabby-body/);
  assert.match(mascot, /grabby-prop/);
  assert.match(card, /GrabbyMascot/);
  assert.match(card, /grabby-card/);
  assert.match(card, /ctaHref/);
  assert.match(css, /\.grabby-card/);
  assert.match(css, /\.grabby-mascot/);
  assert.match(css, /\.grabby-mascot\.rewards \.grabby-prop/);
  assert.match(css, /\.grabby-mascot\.shipping \.grabby-prop/);

  const grabbySources = [mascot, card, copy].join("\n");
  assert.doesNotMatch(grabbySources, /Pok[eé]mon|Pok[eé]\s*Ball|Ash|Pikachu|Charizard|Nintendo|The Pok[eé]mon Company|trainer/i);
  assert.doesNotMatch(grabbySources, /redeem points|apply points|coupon|points discount|reward discount/i);
  assert.doesNotMatch(grabbySources, /passwordHash|resetToken|magicLinkToken|payment_method|cardNumber|cvc|raw Stripe|webhook body|adminNotes|costBasis|supplier|private lot/i);
});

test("Grabby is integrated into the first useful storefront and account surfaces", () => {
  const storefront = readProjectFile("src/components/StorefrontClient.tsx");
  const account = readProjectFile("src/components/CustomerAccountPages.tsx");
  const orderStatus = readProjectFile("src/components/OrderStatusLookupClient.tsx");
  const notFound = readProjectFile("src/app/not-found.tsx");

  assert.match(storefront, /GrabbyCard/);
  assert.match(storefront, /variant="empty-cart"/);
  assert.match(storefront, /Shop New Arrivals/);
  assert.match(storefront, /Guest checkout stays available when you are ready to buy/);

  assert.match(account, /variant="support"/);
  assert.match(account, /className="gdg-account-grabby-card"/);
  assert.match(account, /variant="rewards"/);
  assert.match(account, /Rewards redemption coming soon/);
  assert.doesNotMatch(account, /redeem points|apply points|points discount|reward discount|coupon/i);

  assert.match(orderStatus, /variant="order-status"/);
  assert.match(orderStatus, /Enter your order number and the email used at checkout/);
  assert.match(notFound, /variant="error"/);
  assert.match(notFound, /Keep shopping/);
});
