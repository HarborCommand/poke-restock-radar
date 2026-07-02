import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("footer exposes legal identity, contact, support, and direct policy links", () => {
  const client = readProjectFile("src/components/StorefrontClient.tsx");
  const trust = readProjectFile("src/lib/storefront-trust.ts");

  assert.match(trust, /GameDayGrabs LLC/);
  assert.match(trust, /Online email support/);
  assert.match(trust, /Target response time: 1-2 business days/);
  assert.match(trust, /U\.S\. online shipping/);
  assert.match(trust, /Local pickup is available by appointment only when it appears at checkout/);
  assert.match(client, /GAMEDAYGRABS_LEGAL_NAME/);
  assert.match(client, /GAMEDAYGRABS_SUPPORT_HOURS/);
  assert.match(client, /GAMEDAYGRABS_RESPONSE_TIME/);
  assert.match(client, /storefrontPolicyLinks\.map/);

  for (const href of ["/policies/shipping", "/policies/returns", "/privacy", "/terms", "/contact", "/about"]) {
    assert.match(client + trust, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("contact and about pages explain support, service area, inventory, and affiliation limits", () => {
  const contact = readProjectFile("src/app/contact/page.tsx");
  const about = readProjectFile("src/app/about/page.tsx");

  assert.match(contact, /Email:/);
  assert.match(contact, /GAMEDAYGRABS_RESPONSE_TIME/);
  assert.match(contact, /Service area:/);
  assert.match(contact, /order number/);
  assert.match(contact, /pickup instructions/);
  assert.match(about, /independent online collectibles shop/);
  assert.match(about, /stocked inventory/);
  assert.match(about, /fulfilled by GameDayGrabs/);
  assert.match(about, /No Affiliation Claims/);
  assert.doesNotMatch(about, /authorized reseller|official retailer/i);
});

test("dedicated policy pages render full customer trust policies", () => {
  const overview = readProjectFile("src/app/policies/page.tsx");
  const shipping = readProjectFile("src/app/policies/shipping/page.tsx");
  const returns = readProjectFile("src/app/policies/returns/page.tsx");
  const privacy = readProjectFile("src/app/privacy/page.tsx");
  const terms = readProjectFile("src/app/terms/page.tsx");
  const trust = readProjectFile("src/lib/storefront-trust.ts");

  assert.match(overview, /storefrontPolicyLinks/);
  assert.match(trust, /Carriers and Services/);
  assert.match(shipping, /Shipping costs are shown before payment/);
  assert.match(trust, /Lost or Delayed Packages/);
  assert.match(returns, /Return & Refund Policy/);
  assert.match(returns, /Sealed trading card products are generally final sale/);
  assert.match(trust, /Refund Timing/);
  assert.match(trust, /Payment card numbers and CVC codes are handled by Stripe/);
  assert.match(privacy, /Customer information is used for checkout, fulfillment, and support/);
  assert.match(trust, /Store Use/);
  assert.match(trust, /GameDayGrabs is not affiliated/);
});

test("cart checkout trust copy stays clear before payment", () => {
  const client = readProjectFile("src/components/StorefrontClient.tsx");

  assert.match(client, /Shipping is calculated by ZIP before payment/);
  assert.match(client, /Local Pickup is free only when it appears as an available fulfillment option/);
  assert.match(client, /No hidden fees are added after payment/);
  assert.match(client, /Secure checkout by Stripe\. Guest checkout available/);
  assert.match(client, /href="\/policies\/shipping"/);
  assert.match(client, /href="\/policies\/returns"/);
  assert.match(client, /href="\/privacy"/);
});
