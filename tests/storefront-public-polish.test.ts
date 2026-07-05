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
  assert.match(productCard, /aria-label=\{`View \$\{productTitle\}`\}/);
  assert.match(productCard, /aria-label=\{`\$\{actionText\} \$\{productTitle\}`\}/);
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
  assert.match(storefrontFooter, /className="gdg-footer-legal"/);
  assert.match(storefrontFooter, /GAMEDAYGRABS_FOOTER_RETAILER_DISCLOSURE/);
  assert.match(storefrontFooter, /GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE/);
  assert.match(css, /\.gdg-footer nav a\s*\{[\s\S]*?white-space: nowrap;/);
  assert.doesNotMatch(css, /\.gdg-footer a,\s*\r?\n\s*\.gdg-footer small,\s*\r?\n\s*\.gdg-login-card-heading h2/);
});

test("mobile storefront polish prevents common narrow-viewport overflow", () => {
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.gdg-brand\s*\{[\s\S]*?max-width: calc\(100% - 132px\);/);
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.gdg-shop-toolbar label,\s*\r?\n\s*\.gdg-shop-toolbar select\s*\{[\s\S]*?width: 100%;/);
  assert.match(css, /@media \(max-width: 820px\)\s*\{[\s\S]*?\.gdg-cart-line-price\s*\{[\s\S]*?justify-items: start;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-card-actions > \*,\s*\r?\n\s*\.gdg-hero-actions > \*,\s*\r?\n\s*\.gdg-result-actions > \*\s*\{[\s\S]*?width: 100%;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-product-card \.gdg-card-actions\s*\{[\s\S]*?flex-direction: column;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-usps-quote-controls\s*\{[\s\S]*?grid-template-columns: 1fr;/);
  assert.match(css, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.gdg-login-pill-row\s*\{[\s\S]*?grid-template-columns: 1fr;/);
});

test("public trust copy remains careful and does not imply official authorization", () => {
  const publicCopy = [productCard, productDetail, cartClient, storefrontFooter].join("\n");

  assert.match(publicCopy, /Genuine products/);
  assert.match(publicCopy, /Independent reseller/);
  assert.match(publicCopy, /GAMEDAYGRABS_INDEPENDENT_RETAILER_DISCLOSURE/);
  assert.doesNotMatch(publicCopy, /100% Authentic|guaranteed authentic|official Pok.mon retailer|authorized Pok.mon seller|direct from Pok.mon|replica/i);
  assert.doesNotMatch(client, /cardNumber|card_number|cvv|payment_method_details|raw Stripe object/i);
});
