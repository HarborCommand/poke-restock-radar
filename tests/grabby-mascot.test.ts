import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { grabbyCopy, type GrabbyVariant } from "../src/lib/grabby-copy";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const variants: GrabbyVariant[] = [
  "welcome",
  "empty-cart",
  "rewards",
  "order-status",
  "shipping",
  "support",
  "shop-guide",
  "category-guide",
  "product-helper",
  "policies-support",
  "contact-support",
  "error"
];

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
  assert.match(grabbyCopy["shop-guide"].message, /booster bundles, tins, blisters, and premium collections/);
  assert.match(grabbyCopy["category-guide"].title, /Grabby's tip/);
  assert.match(grabbyCopy["product-helper"].message, /guest checkout is always available/);
  assert.match(grabbyCopy["policies-support"].ctaLabel ?? "", /Check order status/);
  assert.match(grabbyCopy["contact-support"].message, /shipping, pickup, or product questions/);
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
  assert.match(css, /\.grabby-helper-strip/);
  assert.match(css, /\.grabby-mascot\.shop-guide \.grabby-prop/);
  assert.match(css, /\.grabby-mascot\.policies-support \.grabby-prop/);

  const grabbySources = [mascot, card, copy].join("\n");
  assert.doesNotMatch(grabbySources, /Pok[e\u00e9]mon|Pok[e\u00e9]\s*Ball|Ash|Pikachu|Charizard|Nintendo|The Pok[e\u00e9]mon Company|trainer/i);
  assert.doesNotMatch(grabbySources, /redeem points|apply points|coupon|points discount|reward discount/i);
  assert.doesNotMatch(grabbySources, /passwordHash|resetToken|magicLinkToken|payment_method|cardNumber|cvc|raw Stripe|webhook body|adminNotes|costBasis|supplier|private lot/i);
});

test("Grabby is integrated into the first useful storefront and account surfaces", () => {
  const storefront = readProjectFile("src/components/StorefrontClient.tsx");
  const account = readProjectFile("src/components/CustomerAccountPages.tsx");
  const orderStatus = readProjectFile("src/components/OrderStatusLookupClient.tsx");
  const notFound = readProjectFile("src/app/not-found.tsx");

  assert.match(storefront, /GrabbyCard/);
  assert.match(storefront, /function HomepageGrabbyTip/);
  assert.match(storefront, /variant="shop-guide"/);
  assert.match(storefront, /Shop all products/);
  assert.match(storefront, /className="grabby-helper-strip gdg-shop-grabby-strip"/);
  assert.match(storefront, /variant="category-guide"/);
  assert.match(storefront, /collectionGrabbyMessage\(collection\)/);
  assert.match(storefront, /variant="product-helper"/);
  assert.match(storefront, /className="grabby-helper-strip gdg-product-grabby-card"/);
  assert.match(storefront, /className="gdg-cart-grabby-tip"/);
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

test("Grabby expansion stays out of product cards and unsafe surfaces", () => {
  const storefront = readProjectFile("src/components/StorefrontClient.tsx");
  const productFeed = readProjectFile("src/lib/storefront-product-feed.ts");
  const seo = readProjectFile("src/lib/storefront-seo.ts");
  const policies = readProjectFile("src/app/policies/page.tsx");
  const contact = readProjectFile("src/app/contact/page.tsx");

  const productCardStart = storefront.indexOf("function ProductCard");
  const productCardEnd = storefront.indexOf("function HomepageProductSection");
  const productCard = storefront.slice(productCardStart, productCardEnd);

  assert.doesNotMatch(productCard, /GrabbyCard|grabby-card|grabby-helper/i);
  assert.match(policies, /variant="policies-support"/);
  assert.match(policies, /ctaHref="\/order-status"/);
  assert.match(contact, /variant="contact-support"/);
  assert.doesNotMatch(productFeed + seo, /GrabbyCard|grabby-card|Grabby's tip|collection sidekick/i);

  const policyGrabbySnippet = policies.match(/<GrabbyCard[\s\S]*?\/>/)?.[0] ?? "";
  const contactGrabbySnippet = contact.match(/<GrabbyCard[\s\S]*?\/>/)?.[0] ?? "";
  const grabbyExpansionSources = [
    readProjectFile("src/lib/grabby-copy.ts"),
    readProjectFile("src/components/brand/GrabbyMascot.tsx"),
    readProjectFile("src/components/brand/GrabbyCard.tsx"),
    policyGrabbySnippet,
    contactGrabbySnippet,
    storefront.match(/function HomepageGrabbyTip[\s\S]*?export function ProductGrid/)?.[0] ?? "",
    storefront.match(/function collectionGrabbyMessage[\s\S]*?export function ProductGrid/)?.[0] ?? ""
  ].join("\n");

  assert.doesNotMatch(grabbyExpansionSources, /Pok[e\u00e9]mon|Pok[e\u00e9]\s*Ball|Ash|Pikachu|Charizard|Nintendo|The Pok[e\u00e9]mon Company|trainer/i);
  assert.doesNotMatch(grabbyExpansionSources, /redeem points|apply points|coupon|points discount|reward discount/i);
  assert.doesNotMatch(grabbyExpansionSources, /passwordHash|resetToken|magicLinkToken|payment_method|cardNumber|cvc|raw Stripe|webhook body|adminNotes|costBasis|supplier|private lot/i);
});
