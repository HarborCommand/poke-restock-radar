import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { storefrontProductCardSubtitle } from "../src/lib/storefront-card-copy";

const client = fs.readFileSync(new URL("../src/components/StorefrontClient.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const productCardStart = client.indexOf("function ProductCard");
const productCardEnd = client.indexOf("function HomepageProductSection");
assert.notEqual(productCardStart, -1, "ProductCard component should exist");
assert.notEqual(productCardEnd, -1, "HomepageProductSection should follow ProductCard");
const productCard = client.slice(productCardStart, productCardEnd);

test("product-card subtitle uses only reliable set and category metadata", () => {
  assert.equal(
    storefrontProductCardSubtitle({
      title: "Pokémon Trading Card Game: Mega Evolution Chaos Rising Booster Bundle",
      setName: "Mega Evolution",
      category: "Booster Bundles"
    }),
    "Mega Evolution — Booster Bundles"
  );
  assert.equal(storefrontProductCardSubtitle({ title: "Pokémon Accessories Binder", category: "Accessories" }), "Accessories");
  assert.equal(storefrontProductCardSubtitle({ title: "Pokemon Sealed", category: "Pokemon Sealed" }), null);
  assert.equal(storefrontProductCardSubtitle({ title: "Mega Evolution", setName: "Mega Evolution" }), null);
  assert.equal(storefrontProductCardSubtitle({ title: "Short title" }), null);
});

test("product cards keep full product identity accessible while visible text can clamp", () => {
  assert.match(productCard, /const productSubtitle = storefrontProductCardSubtitle/);
  assert.match(productCard, /<Link href=\{`\/product\/\$\{product\.slug\}`\} aria-label=\{productTitle\}>/);
  assert.match(productCard, /className="gdg-product-card-subtitle"/);
  assert.match(productCard, /aria-label=\{`View \$\{productTitle\}`\}/);
  assert.match(productCard, /aria-label=\{`\$\{actionText\} \$\{productTitle\}`\}/);
  assert.doesNotMatch(productCard, /title=\{productTitle\}/);
});

test("desktop product cards allow multi-line names without narrow clipping or stretched images", () => {
  assert.match(css, /\.gdg-product-body h3\s*\{[\s\S]*?min-height: 3\.84em;[\s\S]*?-webkit-line-clamp: 3;/);
  assert.match(css, /\.gdg-product-card-subtitle\s*\{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap;/);
  assert.match(css, /\.gdg-product-card\s*\{[\s\S]*?grid-template-rows: auto minmax\(128px, 1fr\) auto;/);
  assert.match(css, /\.gdg-product-image-card\s*\{[\s\S]*?min-height: 0;/);
  assert.doesNotMatch(css, /\.gdg-product-media img\s*\{[\s\S]*?height:\s*auto[\s\S]*?width:\s*100%[\s\S]*?height:\s*100%/);
});

test("mobile product cards use single-column safe clamps and keep actions reachable", () => {
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-product-card\s*\{[\s\S]*?grid-template-rows: auto minmax\(112px, 1fr\) auto;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-product-body h3\s*\{[\s\S]*?-webkit-line-clamp: 4;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-product-card \.gdg-card-actions\s*\{[\s\S]*?grid-template-columns: minmax\(0, 0\.82fr\) minmax\(0, 1\.18fr\);/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-product-card \.gdg-card-actions > \*\s*\{[\s\S]*?min-height: 44px;/);
});

test("card metadata, sold-out state, rewards, fulfillment, and focus behavior remain intact", () => {
  assert.match(productCard, /const actionText = actionDisabled \? "Sold Out" : actionLabel/);
  assert.match(productCard, /className=\{isSoldOut \? "gdg-stock out" : "gdg-stock in"\}/);
  assert.match(productCard, /storefrontRewardEstimateLabel\(product, settings\)/);
  assert.match(productCard, /storefrontFulfillmentBadges\(product\)/);
  assert.match(productCard, /className="gdg-product-card-meta" aria-label=\{`Purchase details for \$\{productTitle\}`\}/);
  assert.match(css, /\.gdg-product-card:focus-within/);
  assert.match(css, /\.gdg-product-card,\s*\r?\n\.gdg-product-card footer,\s*\r?\n\.gdg-product-card h3,/);
});
