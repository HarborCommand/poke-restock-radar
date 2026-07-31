import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function sourceSlice(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `${start} should exist`);
  assert.notEqual(endIndex, -1, `${end} should follow ${start}`);
  return source.slice(startIndex, endIndex);
}

const client = readProjectFile("src/components/StorefrontClient.tsx");
const css = readProjectFile("src/app/globals.css");
const addToCartSource = sourceSlice(client, "function addToCart", "function StorefrontCartConfirmation");
const confirmationSource = sourceSlice(client, "function StorefrontCartConfirmation", "function categoryPreviewCards");
const payloadTypeSource = sourceSlice(client, "type CartConfirmationDetail", "type AddToCartResult");
const payloadFunctionSource = sourceSlice(client, "function cartConfirmationPayload", "function dispatchCartConfirmation");

test("shared add-to-cart emits one safe Grabby confirmation after successful cart writes", () => {
  assert.match(client, /const cartConfirmationEventName = "gdg-cart-confirmation"/);
  assert.match(client, /const cartConfirmationDismissMs = 3800/);
  assert.match(addToCartSource, /writeCart\(next\);\s*\r?\n\s*trackStorefrontEvent\("product_added_to_cart"/);
  assert.equal((addToCartSource.match(/trackStorefrontEvent\("product_added_to_cart"/g) ?? []).length, 1);
  assert.match(addToCartSource, /const success = cartConfirmationPayload\(product, "success", quantityAdded, nextQuantity\);\s*\r?\n\s*dispatchCartConfirmation\(success\);\s*\r?\n\s*return success;/);
  assert.match(confirmationSource, /role="status"/);
  assert.match(confirmationSource, /aria-live="polite"/);
  assert.match(confirmationSource, /aria-atomic="true"/);
});

test("confirmation copy covers first add, multiple units, updated cart quantity, and View Cart", () => {
  assert.match(confirmationSource, /Grabby got it!/);
  assert.match(confirmationSource, /\$\{confirmation\.productName\} was added to your cart\./);
  assert.match(confirmationSource, /\$\{confirmation\.quantityAdded\.toLocaleString\(\)\} items were added to your cart\./);
  assert.match(confirmationSource, /Cart quantity: \{confirmation\.resultingProductQuantity\.toLocaleString\(\)\}/);
  assert.match(confirmationSource, /<Link href="\/cart" className="gdg-secondary-button compact">\s*\r?\n\s*View Cart/);
  assert.match(confirmationSource, /productImageUrl && !imageFailed/);
  assert.match(confirmationSource, /onError=\{\(\) => setImageFailed\(true\)\}/);
});

test("repeated adds replace the active confirmation and reset dismissal timing", () => {
  assert.match(confirmationSource, /setConfirmation\(\{/);
  assert.doesNotMatch(confirmationSource, /setConfirmation\(\(current\)|\[\.\.\.current|confirmations\.map/);
  assert.match(confirmationSource, /id: Date\.now\(\)/);
  assert.match(confirmationSource, /window\.setTimeout\(\(\) => setConfirmation\(null\), cartConfirmationDismissMs\)/);
  assert.match(confirmationSource, /\}, \[confirmation, paused\]\);/);
  assert.match(confirmationSource, /onMouseEnter=\{\(\) => setPaused\(true\)\}/);
  assert.match(confirmationSource, /onFocus=\{\(\) => setPaused\(true\)\}/);
});

test("manual and keyboard dismissal remain accessible without stealing focus", () => {
  assert.match(confirmationSource, /aria-label="Dismiss cart confirmation"/);
  assert.match(confirmationSource, /onClick=\{\(\) => setConfirmation\(null\)\}/);
  assert.match(confirmationSource, /event\.key === "Escape"/);
  assert.doesNotMatch(confirmationSource, /\.focus\(|autoFocus|tabIndex=\{-1\}|role="dialog"|aria-modal/);
  assert.match(css, /\.gdg-cart-confirmation-actions \.gdg-icon-button/);
});

test("purchase-limit no-op uses truthful non-success messaging and skips analytics", () => {
  assert.match(addToCartSource, /currentQuantity >= effectiveMaxQuantity/);
  assert.match(addToCartSource, /cartConfirmationPayload\(product, "limit", 0, currentQuantity\)/);
  assert.match(addToCartSource, /dispatchCartConfirmation\(limit\);\s*\r?\n\s*return limit;/);
  const beforeWrite = addToCartSource.slice(0, addToCartSource.indexOf("writeCart(next);"));
  assert.doesNotMatch(beforeWrite, /trackStorefrontEvent\("product_added_to_cart"/);
  assert.match(confirmationSource, /Cart limit reached/);
  assert.match(confirmationSource, /You already have the maximum available quantity\./);
});

test("confirmation event payload contains only public presentation data", () => {
  for (const field of ["productName", "productSlug", "productImageUrl", "quantityAdded", "resultingProductQuantity", "state"]) {
    assert.match(payloadTypeSource, new RegExp(field));
  }
  assert.match(payloadFunctionSource, /productImageUrl\(product\)/);
  assert.match(confirmationSource, /isStorefrontDisplayImageUrl\(detail\.productImageUrl\)/);
  assert.doesNotMatch(payloadTypeSource + payloadFunctionSource, /customer|email|account|internal|availableQuantity|publicMaxQuantity|cost|supplier|token|checkout|payment|stripe|tax|reward|inventory/i);
});

test("localStorage cart format and successful analytics payload remain stable", () => {
  assert.match(client, /type CartItem = \{ id: string; quantity: number \}/);
  assert.match(client, /const cartKey = "poke-radar-cart"/);
  assert.match(client, /const raw = JSON\.stringify\(items\)/);
  assert.match(client, /window\.localStorage\.setItem\(cartKey, raw\)/);
  assert.match(addToCartSource, /quantity: quantityAdded/);
  assert.doesNotMatch(addToCartSource, /customerEmail|accountId|checkoutUrl|payment|tax|reward|cost|supplier|availableQuantity/i);
});

test("responsive and reduced-motion styles keep the confirmation contained", () => {
  assert.match(css, /\.gdg-cart-confirmation\s*\{[\s\S]*?position: fixed;[\s\S]*?right: max\(22px, env\(safe-area-inset-right\)\);[\s\S]*?bottom: calc\(22px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(css, /\.gdg-cart-confirmation\s*\{[\s\S]*?width: min\(424px, calc\(100vw - 32px\)\);/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-cart-confirmation\s*\{[\s\S]*?left: max\(12px, env\(safe-area-inset-left\)\);[\s\S]*?bottom: calc\(88px \+ env\(safe-area-inset-bottom\)\);[\s\S]*?width: auto;/);
  assert.match(css, /@media \(max-width: 430px\)\s*\{[\s\S]*?\.gdg-cart-confirmation\s*\{[\s\S]*?bottom: calc\(82px \+ env\(safe-area-inset-bottom\)\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.gdg-cart-confirmation,[\s\S]*?\.gdg-cart-confirmation-grabby \.grabby-mascot\.small\s*\{[\s\S]*?animation: none !important;[\s\S]*?transform: none !important;/);
});
