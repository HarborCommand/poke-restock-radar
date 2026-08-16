import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("POS Square-style flow keeps Charge reachable and separates customer/payment screens", () => {
  const layout = readFileSync(path.join(root, "src/app/pos/layout.tsx"), "utf8");
  const flow = readFileSync(path.join(root, "src/app/pos/PosSquareLikeFlow.tsx"), "utf8");
  const css = readFileSync(path.join(root, "src/app/pos/PosSquareLikeFlow.module.css"), "utf8");

  assert.match(layout, /<PosSquareLikeFlow \/>/);
  assert.match(flow, /data\.posSquareFlowMode = mode/);
  assert.match(flow, /setMode\("payment"\)/);
  assert.match(flow, /setMode\("customer"\)/);
  assert.match(flow, /hasActiveSquarePending/);
  assert.match(flow, /url\.searchParams\.has\("data"\)/);

  assert.match(
    css,
    /data-pos-square-flow-mode="sale"[\s\S]*\.pos-cart-lines[\s\S]*overflow-y: auto !important/
  );
  assert.match(
    css,
    /data-pos-square-flow-mode="sale"[\s\S]*\.pos-payment-panel[\s\S]*display: none !important/
  );
  assert.match(
    css,
    /data-pos-square-flow-mode="payment"[\s\S]*\.pos-payment-panel[\s\S]*display: block !important/
  );
  assert.match(
    css,
    /data-pos-square-flow-mode="payment"[\s\S]*\.pos-complete-button[\s\S]*position: sticky !important/
  );
  assert.match(
    css,
    /data-pos-square-flow-mode="customer"[\s\S]*\.pos-customer-panel[\s\S]*display: block !important/
  );
});
