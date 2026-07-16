import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createStripeTaxCalculation,
  getStripeTaxRegistrationStatus,
  recordStripeTaxTransaction,
  reverseStripeTaxTransaction
} from "../src/lib/stripe-tax";
import { taxFeatureConfig } from "../src/lib/tax";

const address = {
  line1: "100 Test Way",
  city: "Orlando",
  state: "FL",
  postalCode: "32801",
  country: "US"
};

test("Stripe Tax calculation uses authoritative lines, destination, ship-from, and shipping cents", async () => {
  let payload: Record<string, unknown> | null = null;
  const client = {
    tax: {
      calculations: {
        create: async (input: Record<string, unknown>) => {
          payload = input;
          return {
            id: "taxcalc_test_123",
            livemode: false,
            expires_at: 1_800_000_000,
            tax_amount_exclusive: 455,
            tax_amount_inclusive: 0,
            shipping_cost: { amount: 500, amount_tax: 35 },
            line_items: { data: [{ id: "tax_li_test_1", reference: "item-1", amount: 5000, amount_tax: 420, quantity: 2 }] },
            tax_breakdown: [{
              amount: 455,
              taxable_amount: 5500,
              taxability_reason: "standard_rated",
              tax_rate_details: { country: "US", state: "FL", tax_type: "sales_tax", percentage_decimal: "7.0" }
            }]
          };
        }
      }
    }
  };
  const result = await createStripeTaxCalculation({
    lines: [{ reference: "item-1", amountCents: 5000, quantity: 2, taxCode: "txcd_99999999" }],
    destination: address,
    shipFrom: address,
    shippingCents: 500,
    shippingTaxCode: "txcd_92010001"
  }, client as never);

  assert.equal(result.taxCents, 455);
  assert.equal(result.shippingTaxCents, 35);
  assert.equal(result.providerStatus, "calculated");
  assert.deepEqual((payload as unknown as { shipping_cost: unknown }).shipping_cost, { amount: 500, tax_behavior: "exclusive", tax_code: "txcd_92010001" });
  assert.deepEqual((payload as unknown as { customer_details: { address: unknown } }).customer_details.address, {
    line1: address.line1, line2: undefined, city: address.city, state: address.state, postal_code: address.postalCode, country: address.country
  });
});

test("Stripe zero-tax reasons distinguish no registration, exemptions, and authoritative zero", async () => {
  const calculation = (reason: string) => ({
    tax: {
      calculations: {
        create: async () => ({
          id: `taxcalc_${reason}`,
          livemode: false,
          expires_at: 1_800_000_000,
          tax_amount_exclusive: 0,
          tax_amount_inclusive: 0,
          shipping_cost: null,
          line_items: { data: [{ id: "tax_li_zero", reference: "item-1", amount: 1000, amount_tax: 0, quantity: 1 }] },
          tax_breakdown: [{ amount: 0, taxable_amount: 0, taxability_reason: reason, tax_rate_details: { country: "US", state: "FL" } }]
        })
      }
    }
  });
  const base = { lines: [{ reference: "item-1", amountCents: 1000, quantity: 1, taxCode: "txcd_99999999" }], destination: address, shipFrom: address, shippingCents: 0 };
  assert.equal((await createStripeTaxCalculation(base, calculation("not_collecting") as never)).providerStatus, "not_collecting");
  assert.equal((await createStripeTaxCalculation({ ...base, customerExempt: true }, calculation("customer_exempt") as never)).providerStatus, "exempt");
  assert.equal((await createStripeTaxCalculation(base, calculation("not_subject_to_tax") as never)).providerStatus, "not_taxable");
  assert.equal((await createStripeTaxCalculation(base, calculation("zero_rated") as never)).providerStatus, "authoritative_zero");
});

test("Stripe Tax blocks missing locations and provider failures without falling back to zero", async () => {
  const base = { lines: [{ reference: "item-1", amountCents: 1000, quantity: 1, taxCode: "txcd_99999999" }], destination: address, shipFrom: address, shippingCents: 0 };
  await assert.rejects(
    createStripeTaxCalculation({ ...base, destination: { ...address, postalCode: "" } }, { tax: { calculations: { create: async () => ({}) } } } as never),
    /valid verified ZIP code/
  );
  await assert.rejects(
    createStripeTaxCalculation(base, { tax: { calculations: { create: async () => { throw new Error("private provider detail"); } } } } as never),
    /Stripe Tax could not calculate this sale/
  );
});

test("Stripe Tax transactions and reversals use stable references and idempotency", async () => {
  const calls: Array<{ method: string; payload: Record<string, unknown>; options: Record<string, unknown> }> = [];
  const client = {
    tax: {
      transactions: {
        createFromCalculation: async (payload: Record<string, unknown>, options: Record<string, unknown>) => {
          calls.push({ method: "transaction", payload, options });
          return {
            id: "tax_test_transaction",
            livemode: false,
            reference: payload.reference,
            shipping_cost: null,
            line_items: { data: [{ id: "tax_li_transaction_1", reference: "item-1", amount: 1000, amount_tax: 70 }] }
          };
        },
        createReversal: async (payload: Record<string, unknown>, options: Record<string, unknown>) => {
          calls.push({ method: "reversal", payload, options });
          return {
            id: "tax_test_reversal",
            livemode: false,
            reference: payload.reference,
            reversal: { original_transaction: payload.original_transaction }
          };
        }
      }
    }
  };
  const transaction = await recordStripeTaxTransaction({
    calculationId: "taxcalc_test_123",
    saleReference: "POS-TEST-1",
    postedAt: new Date("2026-07-15T12:00:00Z"),
    workspaceReference: "workspace-hash"
  }, client as never);
  assert.equal(transaction.id, "tax_test_transaction");
  assert.equal(transaction.lineItems[0]?.id, "tax_li_transaction_1");
  assert.equal(transaction.totalCents, 1070);

  await reverseStripeTaxTransaction({
    originalTransactionId: transaction.id,
    reversalReference: "POS-TEST-1-refund-a",
    mode: "partial",
    lineItems: [{ originalLineItemId: "tax_li_transaction_1", reference: "item-1-refund", amountCents: 500, taxCents: 35 }]
  }, client as never);
  const reversal = calls.find((call) => call.method === "reversal")!;
  assert.deepEqual(reversal.payload.line_items, [{ amount: -500, amount_tax: -35, original_line_item: "tax_li_transaction_1", reference: "item-1-refund" }]);
  assert.match(String(reversal.options.idempotencyKey), /^tax-reversal:/);
});

test("registration readiness reads active Florida registration without exposing registration data", async () => {
  const result = await getStripeTaxRegistrationStatus("US", "FL", {
    tax: { registrations: { list: async () => ({ data: [{ country: "US", status: "active", country_options: { us: { state: "FL" } } }] }) } }
  } as never);
  assert.deepEqual(result, { status: "active" });
});

test("POS Stripe Tax alias has explicit precedence over the legacy flag", () => {
  assert.equal(taxFeatureConfig({ POS_SALES_TAX_ENABLED: "true" }).posSalesTaxEnabled, true);
  assert.equal(taxFeatureConfig({ POS_SALES_TAX_ENABLED: "true", POS_STRIPE_TAX_ENABLED: "false" }).posSalesTaxEnabled, false);
  assert.equal(taxFeatureConfig({ POS_SALES_TAX_ENABLED: "false", POS_STRIPE_TAX_ENABLED: "true" }).posSalesTaxEnabled, true);
});

test("every tax provider runtime gate defaults off and Stripe/manual POS modes conflict safely", async () => {
  assert.deepEqual(taxFeatureConfig({}), {
    onlineStripeTaxEnabled: false,
    posSalesTaxEnabled: false,
    manualTaxFallbackEnabled: false,
    posTaxModeConflict: false,
    taxExemptSalesEnabled: false,
    taxReportingEnabled: false
  });
  assert.deepEqual(taxFeatureConfig({ POS_STRIPE_TAX_ENABLED: "true", MANUAL_TAX_FALLBACK_ENABLED: "true" }), {
    onlineStripeTaxEnabled: false,
    posSalesTaxEnabled: true,
    manualTaxFallbackEnabled: true,
    posTaxModeConflict: true,
    taxExemptSalesEnabled: false,
    taxReportingEnabled: false
  });

  const [adminService, settingsUi] = await Promise.all([
    readFile(new URL("../src/lib/tax-admin.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/TaxSettingsWorkspace.tsx", import.meta.url), "utf8")
  ]);
  assert.match(adminService, /input\.legacyManualTaxFallbackEnabled && !features\.manualTaxFallbackEnabled/);
  assert.match(adminService, /input\.legacyManualTaxFallbackEnabled && features\.posSalesTaxEnabled/);
  assert.match(adminService, /features\.manualTaxFallbackEnabled && !features\.posSalesTaxEnabled && legacyFallbackConfigured/);
  assert.match(settingsUi, /disabled=\{!settings\.pos\.legacyFallbackRuntimeEnabled \|\| settings\.pos\.runtimeEnabled\}/);
  assert.match(settingsUi, /Source \/ incident reason/);
});

test("unified tax UI hides manual rates from the primary POS workflow and keeps a collapsed emergency fallback", async () => {
  const [settingsUi, posUi, service, reporting] = await Promise.all([
    readFile(new URL("../src/components/TaxSettingsWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/radar-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/tax-reporting.ts", import.meta.url), "utf8")
  ]);
  assert.match(settingsUi, /<details className="tax-legacy-fallback">/);
  assert.match(settingsUi, /Emergency fallback only — not used for normal tax calculations/);
  assert.match(settingsUi, /Transaction recording/);
  assert.match(posUi, /Calculating tax with Stripe/);
  assert.match(posUi, /Add location to calculate tax/);
  assert.doesNotMatch(posUi.slice(posUi.indexOf("function PosPanel"), posUi.indexOf("function PosReceipt")), /Combined saved rate/);
  assert.match(service, /taxProvider = taxExempt \? "exempt" : posTaxEnabled \? "stripe_tax"/);
  assert.match(service, /recordStripeTaxTransaction/);
  assert.match(service, /reverseStripeTaxTransaction/);
  assert.match(reporting, /missing_stripe_tax_transaction/);
  assert.match(reporting, /internal_refund_missing_stripe_reversal/);
  assert.match(reporting, /stripe_tax_transaction_total_mismatch/);
  assert.match(reporting, /stripe_reversal_without_internal_refund/);
});
