import assert from "node:assert/strict";
import test from "node:test";
import { previewTargetDiscoveryHtml, targetDiscoverySourceUrl } from "../src/lib/product-discovery";

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
  assert.match(result.candidates[0].productName, /Three-Booster Blister/);
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
