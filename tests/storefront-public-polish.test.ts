import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function sourceSlice(source: string, startNeedle: string, endNeedle?: string) {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing source start: ${startNeedle}`);
  if (!endNeedle) return source.slice(start);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing source end: ${endNeedle}`);
  return source.slice(start, end);
}

const client = readProjectFile("src/components/StorefrontClient.tsx");
const css = readProjectFile("src/app/globals.css");
const productCard = sourceSlice(client, "function ProductCard", "function HomepageProductSection");
const productDetail = sourceSlice(client, "export function ProductDetail", "function cartStockState");
const cartClient = sourceSlice(client, "export function CartClient", "export function CheckoutSuccessClient");
const storefrontHeader = sourceSlice(client, "export function StorefrontHeader", "export function StorefrontFooter");
const storefrontFooter = sourceSlice(client, "export function StorefrontFooter", "export function StorefrontContactForm");

test("storefront logo images preserve the asset aspect ratio", () => {
  assert.match(client, /const storefrontLogoWidth = 256;/);
  assert.match(client, /const storefrontLogoHeight = 50;/);
  assert.doesNotMatch(storefrontHeader, /width=\{220\}\s*\r?\n\s*height=\{56\}/);
  assert.doesNotMatch(storefrontFooter, /width=\{180\}\s*height=\{44\}/);
  assert.match(storefrontHeader, /width=\{storefrontLogoWidth\}\s*\r?\n\s*height=\{storefrontLogoHeight\}/);
  assert.match(storefrontFooter, /width=\{storefrontLogoWidth\} height=\{storefrontLogoHeight\}/);
  assert.match(css, /\.gdg-brand-logo\s*\{[\s\S]*?height: auto;/);
  assert.match(css, /\.gdg-footer-brand-logo\s*\{[\s\S]*?height: auto;/);
});

test("storefront product actions have product-specific accessible labels", () => {
  assert.match(productCard, /const compactActionText = actionDisabled \? actionText : settings\.checkoutConfigured \? "Add" : "Request"/);
  assert.match(productCard, /className="gdg-secondary-button gdg-product-card-action"/);
  assert.match(productCard, /className="gdg-primary-button compact gdg-product-card-action"/);
  assert.match(productCard, /aria-label=\{`View \$\{productTitle\}`\}/);
  assert.match(productCard, /aria-label=\{`\$\{actionText\} \$\{productTitle\}`\}/);
  assert.match(productCard, /<span className="gdg-product-action-label-full">View Product<\/span>/);
  assert.match(productCard, /<span className="gdg-product-action-label-short" aria-hidden="true">View<\/span>/);
  assert.match(productCard, /<span className="gdg-product-action-label-full">\{actionText\}<\/span>/);
  assert.match(productCard, /<span className="gdg-product-action-label-short" aria-hidden="true">\{compactActionText\}<\/span>/);
  assert.match(productCard, /href=\{`\/product\/\$\{product\.slug\}`\}/);
  assert.match(productCard, /onClick=\{\(\) => \{\s*\r?\n\s*addToCart\(product\);/);
  assert.match(productDetail, /aria-label=\{`Decrease \$\{productTitle\} quantity`\}/);
  assert.match(productDetail, /aria-label=\{`Increase \$\{productTitle\} quantity`\}/);
  assert.match(productDetail, /aria-label=\{`\$\{soldOutActionLabel\} \$\{productTitle\}`\}/);
  assert.match(productDetail, /aria-label=\{`\$\{soldOutSecondaryLabel\} \$\{productTitle\}`\}/);
});

test("public storefront polish keeps product, cart, footer, and login layouts contained", () => {
  assert.match(css, /Public storefront polish: customer-facing layout containment only/);
  assert.match(css, /\.shop-shell\s*\{\s*\r?\n\s*overflow-x: clip;/);
  assert.match(css, /\.gdg-nav\s*\{[\s\S]*?flex-wrap: wrap;/);
  assert.match(css, /\.gdg-product-card\s*\{[\s\S]*?grid-template-rows: auto minmax\(96px, 1fr\) auto;/);
  assert.match(css, /\.gdg-product-card \.gdg-card-actions > \*\s*\{[\s\S]*?min-width: 0;/);
  assert.match(css, /\.gdg-gallery-main\s*\{[\s\S]*?min-height: clamp\(320px, 44vw, 540px\);/);
  assert.match(css, /\.gdg-cart-line-price\s*\{[\s\S]*?min-width: 88px;/);
  assert.match(css, /\.gdg-footer nav\s*\{[\s\S]*?align-items: center;/);
  assert.match(css, /\.gdg-login-page\s*\{[\s\S]*?width: 100%;/);
  assert.match(css, /\.gdg-login-input input\s*\{[\s\S]*?width: 100%;/);
});

test("storefront footer keeps essential links without clutter-only navigation", () => {
  for (const href of ["/shop", "/about", "/contact", "/policies/shipping", "/policies/returns", "/privacy", "/terms"]) {
    assert.match(storefrontFooter, new RegExp(`href="${href.replace(/\//g, "\\/")}"`));
  }

  assert.doesNotMatch(storefrontFooter, /href=\{homeHref\}>Home/);
  assert.doesNotMatch(storefrontFooter, /pokemon-sealed-products|Sports Cards|new-arrivals|accountHref|My Account|Order Status/);
  assert.match(storefrontFooter, /className="gdg-footer-brand-column"/);
  assert.match(storefrontFooter, /className="gdg-footer-legal" aria-label="Store legal and trademark disclosure"/);
  assert.match(storefrontFooter, /GAMEDAYGRABS_FOOTER_RETAILER_DISCLOSURE/);
  assert.match(storefrontFooter, /GAMEDAYGRABS_FOOTER_AFFILIATION_DISCLOSURE/);
  assert.match(storefrontFooter, /<strong>Store name:<\/strong> GameDayGrabs/);
  assert.match(storefrontFooter, /<strong>Legal business:<\/strong> GameDayGrabs LLC/);
  assert.match(css, /\.gdg-footer nav a\s*\{[\s\S]*?white-space: nowrap;/);
  assert.doesNotMatch(css, /\.gdg-footer a,\s*\r?\n\s*\.gdg-footer small,\s*\r?\n\s*\.gdg-login-card-heading h2/);
  assert.doesNotMatch(storefrontFooter, /authenticityProof|authenticityNotes|Proof Missing|Partial Proof|Proof Ready/);
});

test("storefront footer remains compact while preserving trust disclosures", () => {
  assert.match(css, /\.gdg-footer\s*\{[\s\S]*?grid-template-columns: minmax\(250px, 0\.9fr\) minmax\(210px, 0\.54fr\) minmax\(360px, 1\.18fr\);/);
  assert.match(css, /\.gdg-footer\s*\{[\s\S]*?padding: clamp\(16px, 2\.4vw, 24px\);/);
  assert.match(css, /\.gdg-footer-brand-column,\s*\r?\n\s*\.gdg-footer-legal\s*\{[\s\S]*?gap: 5px;/);
  assert.match(css, /\.gdg-footer-brand-logo\s*\{[\s\S]*?width: clamp\(128px, 14vw, 154px\);[\s\S]*?max-height: 30px;/);
  assert.match(css, /\.gdg-footer nav\s*\{[\s\S]*?gap: 7px 18px;/);
  assert.match(css, /@media \(max-width: 860px\)\s*\{[\s\S]*?\.gdg-footer\s*\{[\s\S]*?padding: 16px;[\s\S]*?border-radius: 20px 20px 0 0;/);
});

test("mobile storefront polish prevents common narrow-viewport overflow", () => {
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.gdg-brand\s*\{[\s\S]*?max-width: calc\(100% - 132px\);/);
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.gdg-shop-toolbar label,\s*\r?\n\s*\.gdg-shop-toolbar select\s*\{[\s\S]*?width: 100%;/);
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.gdg-cart-line-price\s*\{[\s\S]*?justify-items: start;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-card-actions > \*,\s*\r?\n\s*\.gdg-hero-actions > \*,\s*\r?\n\s*\.gdg-result-actions > \*\s*\{[\s\S]*?width: 100%;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-product-card \.gdg-card-actions\s*\{[\s\S]*?grid-template-columns: minmax\(0, 0\.82fr\) minmax\(0, 1\.18fr\);/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-product-card \.gdg-card-actions > \*\s*\{[\s\S]*?min-height: 44px;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-product-card \.gdg-primary-button\.compact\.gdg-product-card-action,\s*\r?\n\s*\.gdg-product-card \.gdg-secondary-button\.gdg-product-card-action\s*\{[\s\S]*?min-height: 44px;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-product-action-label-full\s*\{[\s\S]*?display: none;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-product-action-label-short\s*\{[\s\S]*?display: inline;/);
  assert.doesNotMatch(css, /\.gdg-product-card \.gdg-card-actions\s*\{[\s\S]{0,120}?flex-direction: column;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-usps-quote-controls\s*\{[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-login-pill-row\s*\{[\s\S]*?grid-template-columns: 1fr;/);
});

test("mobile detail, cart, and rewards surfaces use compact safe layouts", () => {
  assert.match(css, /Mobile detail\/cart\/account\/admin polish: layout-only refinements/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-gallery-thumbs\s*\{[\s\S]*?flex-wrap: nowrap;[\s\S]*?overflow-x: auto;/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-gallery-thumbs button\s*\{[\s\S]*?width: 58px;[\s\S]*?height: 58px;/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-detail-actions\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-detail-actions \.gdg-primary-button,[\s\S]*?\.gdg-detail-actions \.gdg-secondary-button\s*\{[\s\S]*?min-height: 46px;/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-cart-line\s*\{[\s\S]*?grid-template-columns: 64px minmax\(0, 1fr\);/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-checkout-button\s*\{[\s\S]*?min-height: 52px;/);
  assert.match(css, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.gdg-rewards-summary-grid\s*\{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 640px\)\s*\{[\s\S]*?\.gdg-reward-activity-list article\s*\{[\s\S]*?grid-template-columns: 38px minmax\(0, 1fr\);/);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.gdg-rewards-summary-grid\s*\{[\s\S]*?grid-template-columns: 1fr;/);
});

test("public trust copy remains careful and does not imply official authorization", () => {
  const publicCopy = [productCard, productDetail, cartClient, storefrontFooter].join("\n");

  assert.match(publicCopy, /Genuine products/);
  assert.match(publicCopy, /Independent reseller/);
  assert.match(publicCopy, /GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE/);
  assert.doesNotMatch(publicCopy, /100% Authentic|guaranteed authentic|official Pok.mon retailer|authorized Pok.mon seller|direct from Pok.mon|replica/i);
  assert.doesNotMatch(client, /cardNumber|card_number|cvv|payment_method_details|raw Stripe object/i);
});
