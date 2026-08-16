import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("iPad POS cart keeps variable content inside explicit scroll and grid boundaries", () => {
  const layout = readFileSync(path.join(root, "src/app/pos/layout.tsx"), "utf8");
  const css = readFileSync(path.join(root, "src/app/pos/pos-ipad-cart-overflow.module.css"), "utf8");

  assert.match(layout, /pos-ipad-cart-overflow\.module\.css/);
  assert.match(layout, /overflowStyles\.cartOverflowFix/);
  assert.match(css, /\.pos-cart-lines:not\(\.is-empty\)/);
  assert.match(css, /overflow-y: auto !important/);
  assert.match(css, /grid-template-columns: 48px minmax\(0, 1fr\) 108px 34px !important/);
  assert.match(css, /> \.pos-cart-line-copy/);
  assert.match(css, /> \.pos-cart-quantity/);
  assert.match(css, /> \.pos-line-total/);
  assert.match(css, /> \.icon-button\.small/);
  assert.match(css, /\.pos-customer-results/);
  assert.match(css, /-webkit-overflow-scrolling: touch/);
});
