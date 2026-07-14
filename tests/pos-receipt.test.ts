import assert from "node:assert/strict";
import test from "node:test";
import { legacyPosReceiptTax } from "../src/lib/pos-receipt";

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
