import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { storefrontCheckoutErrorResponse } from "../src/lib/storefront-checkout-errors";
import { checkoutTaxSnapshot } from "../src/lib/storefront";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

test("cart and pickup copy defer final tax to Stripe Checkout", () => {
  const client = read("src/components/StorefrontClient.tsx");
  assert.match(client, /Tax calculated at checkout/);
  assert.match(client, /Final tax uses your delivery or approved pickup location and appears before payment\. Shipping and tax stay separate\./);
  assert.match(client, /Local Pickup tax is never estimated in this cart\. Stripe uses the configured pickup location after its tax policy is approved\./);
  assert.doesNotMatch(client, /estimated tax|calculateConfiguredPosTax|countyRateBasisPoints/i);
});

test("mocked Stripe automatic-tax totals produce an authoritative snapshot, including explicit zero tax", () => {
  const order = { subtotal: 100, shippingCharged: 8, taxProvider: "stripe_tax" } as never;
  const customer = {
    shippingAddress: { country: "us", state: "fl", postal_code: "33101" },
    billingAddress: null
  } as never;
  const taxed = checkoutTaxSnapshot(
    {
      id: "cs_test_taxed",
      automatic_tax: { enabled: true, status: "complete" },
      amount_subtotal: 10_000,
      amount_total: 11_450,
      total_details: { amount_discount: 500, amount_shipping: 800, amount_tax: 1_150 }
    } as never,
    order,
    customer
  );
  assert.equal(taxed.taxCents, 1_150);
  assert.equal(taxed.totalCents, 11_450);
  assert.equal(taxed.taxStatus, "collected");
  assert.equal(taxed.taxJurisdictionState, "FL");

  const zeroTax = checkoutTaxSnapshot(
    {
      id: "cs_test_zero",
      automatic_tax: { enabled: true, status: "complete" },
      amount_subtotal: 10_000,
      amount_total: 10_300,
      total_details: { amount_discount: 500, amount_shipping: 800, amount_tax: 0 }
    } as never,
    order,
    customer
  );
  assert.equal(zeroTax.taxCents, 0);
  assert.equal(zeroTax.taxStatus, "collected");
});

test("mocked incomplete automatic-tax results fail instead of falling back to zero", () => {
  const order = { subtotal: 100, shippingCharged: 8, taxProvider: "stripe_tax" } as never;
  const customer = { shippingAddress: null, billingAddress: null } as never;
  assert.throws(
    () =>
      checkoutTaxSnapshot(
        {
          id: "cs_test_incomplete",
          automatic_tax: { enabled: true, status: "requires_location_inputs" },
          amount_subtotal: 10_000,
          amount_total: 10_800,
          total_details: { amount_discount: 0, amount_shipping: 800, amount_tax: null }
        } as never,
        order,
        customer
      ),
    /complete authoritative calculation/
  );
  assert.throws(
    () =>
      checkoutTaxSnapshot(
        {
          id: "cs_test_missing_tax",
          automatic_tax: { enabled: true, status: "complete" },
          amount_subtotal: 10_000,
          amount_total: 10_800,
          total_details: { amount_discount: 0, amount_shipping: 800 }
        } as never,
        order,
        customer
      ),
    /complete authoritative checkout totals/
  );
});

test("checkout error contracts redact provider details and include the request reference", async () => {
  const requestId = "request-safe-123";
  const cases = [
    [new Error("automatic_tax requires a complete address"), 422, "CHECKOUT_ADDRESS_REQUIRED"],
    [new Error("unsupported tax location"), 422, "TAX_LOCATION_UNSUPPORTED"],
    [{ type: "StripeAPIError", message: "api_key=secret raw provider failure" }, 503, "CHECKOUT_PROVIDER_UNAVAILABLE"]
  ] as const;
  for (const [error, expectedStatus, expectedCode] of cases) {
    const response = storefrontCheckoutErrorResponse(error, requestId);
    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get("x-request-id"), requestId);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const body = await response.json();
    assert.equal(body.requestId, requestId);
    assert.equal(body.code, expectedCode);
    assert.doesNotMatch(JSON.stringify(body), /api_key|secret|raw provider/i);
  }
});

test("feature-off and feature-on checkout paths preserve Stripe authority", () => {
  const storefront = read("src/lib/storefront.ts");
  assert.match(storefront, /const onlineTaxEnabled = settings\.tax\.features\.onlineStripeTaxEnabled/);
  assert.match(storefront, /onlineTaxEnabled \? \{ automatic_tax: \{ enabled: true \} \} : \{\}/);
  assert.match(storefront, /onlineTaxEnabled \? \{ billing_address_collection: "required" as const \} : \{\}/);
  assert.match(storefront, /total_details\?\.amount_tax/);
  assert.match(storefront, /Stripe Tax did not return a complete authoritative calculation/);
  assert.doesNotMatch(storefront, /automaticTaxStatus[^\n]+(?:fallback|zero)/i);
});

test("Florida delivery and Local Pickup remain provider-located rather than browser-rated", () => {
  const storefront = read("src/lib/storefront.ts");
  assert.match(storefront, /shipping_address_collection/);
  assert.match(storefront, /taxJurisdictionState: state/);
  assert.match(storefront, /shippingAddress \?\? customer\.billingAddress/);
  assert.match(storefront, /Tax-enabled Local Pickup requires an approved store-location tax policy/);
  assert.doesNotMatch(storefront, /Miami-Dade|Broward|Palm Beach|FL.*(?:600|650|700)/);
});

test("order lookup and account detail expose persisted tax and historical unknowns safely", () => {
  const storefront = read("src/lib/storefront.ts");
  const account = read("src/lib/customer-account-auth.ts");
  const lookup = read("src/components/OrderStatusLookupClient.tsx");
  assert.match(storefront, /tax: order\.taxCents === null \? null : moneyFromCents\(order\.taxCents\)/);
  assert.match(storefront, /refundedTax: order\.taxCents === null \? null/);
  assert.match(account, /refundedTax: order\.taxCents === null \? null/);
  assert.match(lookup, /Sales tax/);
  assert.match(lookup, /Sales tax refunded/);
  assert.match(lookup, /Not recorded/);
});

test("checkout failures return safe codes and a request reference without a zero-tax fallback", () => {
  const route = read("src/app/api/storefront/checkout/session/route.ts");
  const legacyRoute = read("src/app/api/storefront/checkout/route.ts");
  const errors = read("src/lib/storefront-checkout-errors.ts");
  const client = read("src/components/StorefrontClient.tsx");
  assert.match(route, /crypto\.randomUUID\(\)/);
  assert.match(route, /assertSameOriginRequest\(request\)/);
  assert.match(route, /storefrontCheckoutErrorResponse\(error, requestId\)/);
  assert.match(legacyRoute, /assertSameOriginRequest\(request\)/);
  assert.match(legacyRoute, /storefrontCheckoutErrorResponse\(error, requestId\)/);
  for (const code of ["CHECKOUT_ADDRESS_REQUIRED", "TAX_LOCATION_UNSUPPORTED", "AUTOMATIC_TAX_UNAVAILABLE", "TAX_CALCULATION_FAILED"]) {
    assert.match(errors, new RegExp(code));
  }
  assert.match(errors, /No payment was created/);
  assert.match(client, /Reference: \$\{responsePayload\.requestId\}/);
  assert.doesNotMatch(errors, /tax(?: amount)?[^\n]{0,30}= 0|fall back to zero/i);
});

test("tax-code validation happens before the pending order write and failed provider setup is cleaned up", () => {
  const storefront = read("src/lib/storefront.ts");
  const checkout = storefront.slice(
    storefront.indexOf("export async function createCheckoutSession"),
    storefront.indexOf("export async function createInvoiceRequest")
  );
  assert.ok(checkout.indexOf("const stripeTaxCodeByInventoryId") < checkout.indexOf("tx.storefrontOrder.create"));
  assert.match(checkout, /stripeTaxCodeByInventoryId\?\.get\(item\.inventoryItemId\)/);
  assert.match(checkout, /await prisma\.storefrontOrder\.delete\(\{ where: \{ id: order\.id \} \}\)/);
  assert.doesNotMatch(checkout, /Stripe Checkout session creation failed: \$\{error/);
  const providerMetadata = checkout.slice(checkout.indexOf("const metadata ="), checkout.indexOf("const stripe = stripeClient"));
  assert.doesNotMatch(providerMetadata, /shippingQuotedZip|customerEmail|customerName|destinationZip/);
});

test("emails state persisted sales tax and refunded tax without provider metadata", () => {
  const templates = read("src/lib/storefront-email-templates.ts");
  assert.match(templates, /Sales tax/);
  assert.match(templates, /Sales tax refunded/);
  assert.match(templates, /Not recorded/);
  assert.doesNotMatch(templates, /taxCalculationId|stripeCheckoutSessionId|stripePaymentIntentId|providerReference/);
});

test("webhooks remain idempotent and rewards remain merchandise-only", () => {
  const storefront = read("src/lib/storefront.ts");
  const rewards = read("src/lib/customer-rewards.ts");
  const webhookRoutes = [
    read("src/app/api/storefront/webhook/stripe/route.ts"),
    read("src/app/api/storefront/stripe/webhook/route.ts")
  ];
  assert.match(storefront, /claimProviderEvent/);
  assert.match(storefront, /completeProviderEvent/);
  assert.match(storefront, /checkout\.session\.completed/);
  assert.match(rewards, /eligibleSubtotalCents/);
  assert.match(rewards, /taxCentsExcluded/);
  for (const route of webhookRoutes) {
    assert.match(route, /WEBHOOK_REJECTED/);
    assert.match(route, /crypto\.randomUUID\(\)/);
    assert.doesNotMatch(route, /error instanceof Error \? error\.message/);
  }
});

test("account order queries keep customer isolation in the server where clause", () => {
  const account = read("src/lib/customer-account-auth.ts");
  assert.match(account, /const where = customerVisibleOrderWhere\(account, cleanOrderNumber\)/);
  assert.match(account, /findFirst\(\{\s*\r?\n\s*where,/);
  assert.doesNotMatch(read("src/components/CustomerAccountPages.tsx"), /customerAccountId\s*[:=]/);
});
