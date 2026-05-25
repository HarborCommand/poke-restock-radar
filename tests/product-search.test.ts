import assert from "node:assert/strict";
import test from "node:test";
import { searchProductsByUpc } from "../src/lib/product-search/index";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

function restore() {
  process.env = { ...originalEnv };
  globalThis.fetch = originalFetch;
}

test("product search reports missing provider configuration safely", async () => {
  restore();
  delete process.env.PRODUCT_SEARCH_PROVIDER;
  delete process.env.PRODUCT_SEARCH_API_URL;
  delete process.env.PRODUCT_SEARCH_API_KEY;

  const result = await searchProductsByUpc("196214154155");

  assert.equal(result.configured, false);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.failures[0]?.source, "search");
  assert.equal(result.failures[0]?.reason, "missing_env_or_no_results");
});

test("serpapi provider normalizes Google Shopping UPC candidates", async () => {
  restore();
  process.env.PRODUCT_SEARCH_PROVIDER = "serpapi";
  process.env.PRODUCT_SEARCH_API_URL = "https://serpapi.com/search.json";
  process.env.PRODUCT_SEARCH_API_KEY = "test-key";
  let requestedUrl = "";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        shopping_results: [
          {
            title: "Pokemon Trading Card Game: Mega Evolution Chaos Rising Elite Trainer Box",
            source: "Target",
            product_link: "https://www.target.com/p/pokemon-trading-card-game-mega-evolution-chaos-rising-elite-trainer-box/-/A-94600000",
            thumbnail: "https://target.scene7.com/is/image/Target/GUEST-test",
            extracted_price: 59.99
          }
        ]
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const result = await searchProductsByUpc("196214154155");

  assert.equal(result.configured, true);
  assert.equal(result.provider, "serpapi");
  assert.match(requestedUrl, /engine=google_shopping/);
  assert.match(requestedUrl, /q=196214154155/);
  assert.match(requestedUrl, /api_key=test-key/);
  assert.equal(result.candidates[0]?.retailer, "Target");
  assert.equal(result.candidates[0]?.price, 59.99);
  assert.equal(result.candidates[0]?.tcin, "94600000");
  assert.ok((result.candidates[0]?.confidence ?? 0) >= 70);
});

test.after(restore);

