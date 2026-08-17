import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file: string) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("POS Square refunds use the provider before recording the local refund", () => {
  const route = read("src/app/api/radar/pos/sales/[saleReference]/refund/route.ts");
  const helper = read("src/lib/square-refunds.ts");

  assert.match(route, /parseSquarePaymentReference/);
  assert.match(route, /refundSquarePosPayment/);
  assert.match(route, /providerRefund\.status !== "COMPLETED"/);
  assert.match(route, /refundPosSale\(storeUser, normalizedReference, input\)/);
  assert.match(helper, /POST/);
  assert.match(helper, /\/v2\/refunds/);
  assert.match(helper, /idempotency_key/);
  assert.match(helper, /verifySquarePosPayment/);
});
