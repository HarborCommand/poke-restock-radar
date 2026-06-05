import assert from "node:assert/strict";
import test from "node:test";
import { previewTargetDiscoveryHtml, previewTargetDiscoveryHtmlWithSearch, targetDiscoverySourceUrl } from "../src/lib/product-discovery";

const sourceUrl = targetDiscoverySourceUrl("Pokemon TCG");

test("Target search fixture extracts escaped product links without treating /s as a candidate", () => {
  const html = `
    <html>
      <a href="/s?searchTerm=Pokemon+TCG">Search page</a>
      <a href="/p/pokemon-trading-card-game-chaos-rising-booster-bundle/-/A-95298172">Pokemon TCG Mega Evolution Chaos Rising Booster Bundle</a>
      <script>
        self.__TGT = {
          "url":"\\/p\\/pokemon-trading-card-game-chaos-rising-booster-bundle\\/-\\/A-95298172",
          "tcin":"95298172",
          "title":"Pokemon TCG Mega Evolution Chaos Rising Booster Bundle",
          "primary_image_url":"https:\\/\\/target.scene7.com\\/is\\/image\\/Target\\/GUEST_95298172",
          "formatted_current_price":"$29.99",
          "dpci":"087-12-1234",
          "upc":"196214154162"
        };
      </script>
    </html>
  `;
  const result = previewTargetDiscoveryHtml({ sourceUrl, finalUrl: sourceUrl, httpStatus: 200, html });
  assert.equal(result.blocked, false);
  assert.equal(result.productLinksFound, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.candidates[0].retailerProductId, "95298172");
  assert.equal(result.candidates[0].livePrice, 29.99);
  assert.equal(result.candidates[0].productType, "Booster Bundle");
  assert.equal(result.candidates[0].upc, "196214154162");
  assert.equal(result.candidates[0].dpci, "087-12-1234");
  assert.equal(result.candidates[0].enrichmentStatus, "ENRICHED");
  assert.match(result.candidates[0].reason, /DPCI 087-12-1234/);
  assert.ok(!result.candidates[0].url.includes("/s?"));
});

test("Target discovery rejects non-card Pokemon merchandise", () => {
  const html = `
    <a href="/p/pokemon-pikachu-plush-toy/-/A-11111111">Pokemon Pikachu Plush Toy</a>
    <script>{"tcin":"11111111","title":"Pokemon Pikachu Plush Toy","url":"\\/p\\/pokemon-pikachu-plush-toy\\/-\\/A-11111111"}</script>
  `;
  const result = previewTargetDiscoveryHtml({ sourceUrl, finalUrl: sourceUrl, httpStatus: 200, html });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].status, "REJECTED_NON_TCG");
  assert.match(result.rejected[0].reason, /non-TCG|excluded/i);
  assert.match(result.zeroCandidateReason || "", /non-TCG/i);
});

test("Target discovery can create an exact product candidate from TCIN-only public JSON", () => {
  const html = `
    <script>
      {"tcin":"95280894","title":"Pokemon Trading Card Game: Mega Evolution Chaos Rising Three-Booster Blister","primary_image_url":"//target.scene7.com/is/image/Target/GUEST_95280894","price":13.99}
    </script>
  `;
  const result = previewTargetDiscoveryHtml({ sourceUrl, finalUrl: sourceUrl, httpStatus: 200, html });
  assert.equal(result.productLinksFound, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].url, "https://www.target.com/p/-/A-95280894");
  assert.equal(result.candidates[0].retailerProductId, "95280894");
  assert.equal(result.candidates[0].upc, null);
  assert.equal(result.candidates[0].dpci, null);
  assert.equal(result.candidates[0].productType, "3-Pack Blister");
  assert.equal(result.candidates[0].enrichmentStatus, "PARTIAL");
  assert.match(result.candidates[0].productName, /Three-Booster Blister/);
});

test("Target discovery classifies common Pokemon TCG sealed product types", () => {
  const html = `
    <a href="/p/pokemon-tcg-chaos-rising-sleeved-booster/-/A-10000001">Pokemon TCG Chaos Rising Sleeved Booster</a>
    <a href="/p/pokemon-tcg-perfect-order-checklane-blister/-/A-10000002">Pokemon TCG Perfect Order Checklane Blister</a>
    <a href="/p/pokemon-trading-card-game-mega-evolution-booster-pack/-/A-10000003">Pokemon Trading Card Game Mega Evolution Booster Pack</a>
  `;
  const result = previewTargetDiscoveryHtml({ sourceUrl, finalUrl: sourceUrl, httpStatus: 200, html });
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates.find((candidate) => candidate.retailerProductId === "10000001")?.productType, "Sleeved Booster");
  assert.equal(result.candidates.find((candidate) => candidate.retailerProductId === "10000002")?.productType, "Checklane Blister");
  assert.equal(result.candidates.find((candidate) => candidate.retailerProductId === "10000003")?.productType, "Booster Pack");
});

test("Target discovery reports a clear zero-candidate reason when no product links are present", () => {
  const result = previewTargetDiscoveryHtml({
    sourceUrl,
    finalUrl: sourceUrl,
    httpStatus: 200,
    html: "<html><title>Target Search</title><p>No product cards rendered.</p></html>"
  });
  assert.equal(result.productLinksFound, 0);
  assert.equal(result.candidates.length, 0);
  assert.match(result.zeroCandidateReason || "", /no product links found/i);
});

test("Target discovery reports blocked pages and does not create candidates", () => {
  const result = previewTargetDiscoveryHtml({
    sourceUrl,
    finalUrl: sourceUrl,
    httpStatus: 403,
    html: "<html><title>Access Denied</title><p>captcha robot blocked</p></html>"
  });
  assert.equal(result.blocked, true);
  assert.equal(result.productLinksFound, 0);
  assert.equal(result.candidates.length, 0);
  assert.match(result.zeroCandidateReason || "", /blocked/i);
});

test("Target discovery deduplicates repeated product links", () => {
  const html = `
    <a href="/p/pokemon-tcg-mega-evolution-perfect-order-3-booster-blister/-/A-95280000">Pokemon TCG Mega Evolution Perfect Order 3-Booster Blister</a>
    <script>{"url":"\\/p\\/pokemon-tcg-mega-evolution-perfect-order-3-booster-blister\\/-\\/A-95280000","tcin":"95280000","title":"Pokemon TCG Mega Evolution Perfect Order 3-Booster Blister"}</script>
  `;
  const result = previewTargetDiscoveryHtml({ sourceUrl, finalUrl: sourceUrl, httpStatus: 200, html });
  assert.equal(result.productLinksFound, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].retailerProductId, "95280000");
});

test("Target discovery falls back to public search JSON when static HTML has no product links", async () => {
  const targetConfig = {
    services: {
      redsky: {
        apiKey: "test-redsky-key",
        baseUrl: "https://redsky.target.com"
      },
      redskyAggregations: {
        apis: {
          product: {
            endpointPaths: {
              plpSearchV2: "redsky_aggregations/v1/web/plp_search_v2"
            }
          }
        }
      }
    },
    serverLocationVariables: {
      store_id: "2848",
      store_ids: "2848,2109"
    }
  };
  const encodedConfig = JSON.stringify(JSON.stringify(targetConfig)).slice(1, -1);
  const html = `<html><script>window.__CONFIG__ = JSON.parse("${encodedConfig}")</script></html>`;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = (async (url: string | URL | Request) => {
    requestedUrl = String(url);
    return new Response(
      JSON.stringify({
        data: {
          search: {
            products: [
              {
                tcin: "1009003207",
                item: {
                  enrichment: {
                    buy_url: "https://www.target.com/p/pokemon-tcg-ultra-rare-value-pack-12-cards/-/A-1009003207",
                    image_info: {
                      primary_image: {
                        url: "https://target.scene7.com/is/image/Target/GUEST_a5ecdc09-16b9-4b5d-87e2-22ef751deba1"
                      }
                    }
                  },
                  product_classification: {
                    item_type: {
                      name: "Collectible Trading Cards"
                    }
                  },
                  product_description: {
                    title: "Pokemon TCG Ultra Rare Value Pack - 12 Cards"
                  },
                  primary_brand: {
                    name: "Pokemon"
                  }
                },
                price: {
                  current_retail: 14.99
                }
              }
            ]
          }
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await previewTargetDiscoveryHtmlWithSearch({ sourceUrl, finalUrl: sourceUrl, httpStatus: 200, html });
    assert.match(requestedUrl, /plp_search_v2/);
    assert.equal(result.productLinksFound, 1);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].retailerProductId, "1009003207");
    assert.match(result.candidates[0].productName, /Ultra Rare Value Pack/);
    assert.equal(result.candidates[0].livePrice, 14.99);
    assert.match(result.candidates[0].reason, /Target public search API/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
