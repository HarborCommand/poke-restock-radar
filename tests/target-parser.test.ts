import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRetailerProductUrl, productReadyForBuyAlerts } from "../src/lib/product-identity";
import { detectRetailerAvailability, detectRetailerPrice, detectTargetAvailability } from "../src/lib/retailer-page-signals";

const targetOutOfStockEtbPage = `
<!doctype html>
<html>
  <head>
    <title>Pokemon Trading Card Game: Mega Evolution Chaos Rising Elite Trainer Box : Target</title>
    <meta property="og:title" content="Pokemon Trading Card Game: Mega Evolution Chaos Rising Elite Trainer Box" />
    <script id="__NEXT_DATA__" type="application/json">
      {
        "props": {
          "pageProps": {
            "product": {
              "title": "Pokemon Trading Card Game: Mega Evolution Chaos Rising Elite Trainer Box",
              "price": {
                "current_retail": 59.99,
                "formatted_current_price": "$59.99"
              },
              "tcin": "123456789",
              "availability_status": "OUT_OF_STOCK",
              "isOutOfStock": true
            }
          }
        }
      }
    </script>
  </head>
  <body>
    <main>
      <h1>Pokemon Trading Card Game: Mega Evolution Chaos Rising Elite Trainer Box</h1>
      <div data-test="product-price">$59.99</div>
      <div data-test="fulfillment-cell">Out of stock</div>
      <button data-test="shippingButton" aria-disabled="true" disabled>Add to cart</button>
    </main>
  </body>
</html>`;

test("Target parser treats disabled add-to-cart and out-of-stock as not buyable", () => {
  const availability = detectTargetAvailability(targetOutOfStockEtbPage);

  assert.equal(detectRetailerPrice(targetOutOfStockEtbPage, "Target"), 59.99);
  assert.equal(availability.status, "SOLD_OUT");
  assert.equal(availability.stockText, "Out of stock");
  assert.equal(availability.addToCartEnabled, false);
  assert.ok(availability.confidenceScore >= 90);
  assert.match(availability.reason, /out of stock/i);
  assert.match(availability.reason, /disabled/i);
});

test("Target parser does not infer availability from page text without an enabled cart button", () => {
  const pageWithLooseCartText = `
    <html>
      <head><title>Pokemon TCG Product : Target</title></head>
      <body>
        <h1>Pokemon TCG Product</h1>
        <p>Shipping, pickup, returns, highlights, add to cart instructions.</p>
      </body>
    </html>
  `;
  const availability = detectTargetAvailability(pageWithLooseCartText);

  assert.equal(availability.status, "UNAVAILABLE");
  assert.equal(availability.addToCartEnabled, null);
  assert.match(availability.reason, /could not prove an enabled Add to cart button/i);
});

test("generic retailer parser requires actionable purchase proof", () => {
  const bestBuySoldOut = `
    <html>
      <head><title>Pokemon TCG Product - Best Buy</title></head>
      <body>
        <h1>Pokemon TCG Product</h1>
        <button class="add-to-cart-button" disabled>Add to Cart</button>
        <p>Sold out</p>
      </body>
    </html>
  `;
  const unavailable = detectRetailerAvailability(bestBuySoldOut, "Best Buy");
  assert.equal(unavailable.status, "SOLD_OUT");
  assert.equal(unavailable.addToCartEnabled, false);

  const amazonCaptcha = `
    <html><body><h1>Sorry, we just need to make sure you're not a robot</h1><p>Enter the characters you see below</p></body></html>
  `;
  const blocked = detectRetailerAvailability(amazonCaptcha, "Amazon");
  assert.equal(blocked.status, null);
  assert.match(blocked.reason, /captcha|robot/i);
});

test("exact product gates reject search links and require verified live image data", () => {
  const searchLink = classifyRetailerProductUrl("https://www.target.com/s?searchTerm=pokemon+etb", "Target");
  assert.equal(searchLink.searchOrCategory, true);
  assert.equal(searchLink.exactProductUrl, false);

  const baseProduct = {
    verificationStatus: "VERIFIED_EXACT",
    verifiedFinalUrl: "https://www.target.com/p/pokemon-etb/-/A-12345678",
    url: "https://www.target.com/p/pokemon-etb/-/A-12345678",
    retailerProductId: "12345678",
    liveTitle: "Pokemon Trading Card Game Elite Trainer Box",
    livePrice: 59.99,
    liveStockStatus: "SOLD_OUT",
    liveConfidenceScore: 94,
    liveBlockedType: null
  };

  assert.equal(productReadyForBuyAlerts({ ...baseProduct, imageUrl: "https://example.com/manual.jpg" }), false);
  assert.equal(productReadyForBuyAlerts({ ...baseProduct, liveImageUrl: "https://target.scene7.com/image.jpg" }), true);
});
