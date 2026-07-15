import assert from "node:assert/strict";
import test from "node:test";
import { legacyPosReceiptTax } from "../src/lib/pos-receipt";
import { safeMutationError } from "../src/lib/http";
import { PosTaxQuoteConflictError } from "../src/lib/pos-tax-quote";

test("not-recorded historical POS tax stays unknown even when legacy notes say zero", () => {
  assert.equal(legacyPosReceiptTax({
    taxStatus: "not_recorded",
    notes: "POS subtotal: $19.99. POS tax: $0.00. POS total: $19.99."
  }), null);
});

test("legacy POS tax remains recoverable when no explicit tax status exists", () => {
  assert.equal(legacyPosReceiptTax({
    taxStatus: null,
    notes: "POS subtotal: $19.99. POS tax: $1.40. POS total: $21.39."
  }), 1.4);
});

test("stale POS quotes return a safe conflict response", async () => {
  const response = safeMutationError(
    new PosTaxQuoteConflictError("POS tax quote is stale. Refresh the tax calculation before completing the sale."),
    "request-82"
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "The POS tax quote changed or expired. Refresh the calculation and try again.",
    code: "POS_TAX_QUOTE_CONFLICT",
    requestId: "request-82",
    retryable: false
  });
});
