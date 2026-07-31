import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function sourceSlice(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `Missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

const emptyCartBranch = sourceSlice(
  client,
  '<section className="gdg-cart-empty-hero"',
  "</section>"
);

const nonEmptyCartBranch = sourceSlice(
  client,
  '<div className="gdg-cart-grid">',
  '<section className="gdg-cart-empty-hero"'
);

const emptyCartCss = sourceSlice(
  css,
  ".gdg-cart-empty-hero {",
  ".gdg-result-card {"
);

test("empty cart renders a focused Grabby shopping hero", () => {
  assert.match(client, /const isEmptyCart = !cartIsLoading && products\.length === 0/);
  assert.match(client, /<h1>Your cart is empty<\/h1>/);
  assert.match(client, /Grabby can help you find your next pull\./);
  assert.match(emptyCartBranch, /Ready for your next pull\?/);
  assert.match(emptyCartBranch, /Explore fresh Pok&eacute;mon drops, sealed products, tins, blisters, and collector favorites\./);
  assert.match(emptyCartBranch, /GRABBY &mdash; YOUR COLLECTION SIDEKICK/);
  assert.match(emptyCartBranch, /GrabbyMascot variant="empty-cart" size="large"/);
});

test("empty cart offers exactly two distinct shopping links", () => {
  const linkCount = (emptyCartBranch.match(/<Link href=\{storefrontCollectionPath\(/g) ?? []).length;
  assert.equal(linkCount, 2);
  assert.match(emptyCartBranch, /storefrontCollectionPath\("new-arrivals"\)/);
  assert.match(emptyCartBranch, /Shop New Arrivals/);
  assert.match(emptyCartBranch, /storefrontCollectionPath\("pokemon-sealed-products"\)/);
  assert.match(emptyCartBranch, /Shop All Pok&eacute;mon/);
  assert.doesNotMatch(emptyCartBranch, /View New Arrivals|Shop Pok&eacute;mon/);
});

test("empty cart removes checkout-only and duplicate copy", () => {
  assert.match(client, /!\s*isEmptyCart \? \(\s*<Link href="\/shop" className="gdg-secondary-button">\s*Continue Shopping/);
  assert.doesNotMatch(emptyCartBranch, /Continue Shopping/);
  assert.match(client, /!\s*isEmptyCart \? \(\s*<div className="gdg-checkout-hero">/);
  assert.doesNotMatch(emptyCartBranch, /gdg-checkout-trust-row|Secure Checkout|Fast Shipping|Sealed products/);
  assert.doesNotMatch(client, /Guest checkout stays available when you are ready to buy/);
  assert.match(emptyCartBranch, /Secure checkout &bull; Guest checkout available &bull; Carefully packed/);
});

test("non-empty cart keeps the existing checkout presentation", () => {
  assert.match(nonEmptyCartBranch, /gdg-cart-grid/);
  assert.match(client, /<h1>Review your cart <Sparkles size=\{28\} aria-hidden="true" \/><\/h1>/);
  assert.match(client, /Confirm your items, choose shipping or pickup, then continue to secure checkout\./);
  assert.match(client, /<Link href="\/shop" className="gdg-secondary-button">\s*Continue Shopping/);
  assert.match(client, /gdg-checkout-trust-row/);
  assert.match(client, /Proceed to Secure Checkout/);
});

test("empty cart CSS is compact and mobile safe", () => {
  assert.doesNotMatch(emptyCartCss, /min-height:\s*430px/);
  assert.match(emptyCartCss, /width:\s*min\(800px,\s*calc\(100vw - 32px\)\)/);
  assert.match(emptyCartCss, /min-height:\s*250px/);
  assert.match(emptyCartCss, /grid-template-columns:\s*172px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*\.gdg-cart-empty-hero \{[\s\S]*width:\s*calc\(100vw - 24px\)/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*\.gdg-cart-empty-actions \{[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*\.gdg-cart-empty-actions \.gdg-primary-button,[\s\S]*width:\s*100%/);
});
