import assert from "node:assert/strict";
import test from "node:test";
import { canonicalProductUPC, upcLookupVariants } from "../src/lib/upc";

test("canonicalProductUPC maps EAN-13 leading zero scans to saved UPC-A values", () => {
  assert.equal(canonicalProductUPC("0 196214 154155"), "196214154155");
  assert.equal(canonicalProductUPC("0196214154155"), "196214154155");
});

test("upcLookupVariants searches both UPC-A and leading-zero EAN-13 forms", () => {
  assert.deepEqual(upcLookupVariants("0196214154155"), ["196214154155", "0196214154155"]);
  assert.deepEqual(upcLookupVariants("196214154155"), ["196214154155", "0196214154155"]);
});
