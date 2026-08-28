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

test("iPad POS sale screen keeps the Charge footer inside the visible viewport", () => {
  const layout = readFileSync(path.join(root, "src/app/pos/layout.tsx"), "utf8");
  const flow = readFileSync(path.join(root, "src/app/pos/PosSquareLikeFlow.tsx"), "utf8");
  const flowCss = readFileSync(path.join(root, "src/app/pos/PosSquareLikeFlow.module.css"), "utf8");
  const guard = readFileSync(path.join(root, "src/app/pos/PosSaleViewportGuard.tsx"), "utf8");
  const guardCss = readFileSync(path.join(root, "src/app/pos/pos-sale-viewport-guard.module.css"), "utf8");

  assert.match(layout, /import \{ PosSaleViewportGuard \} from "\.\/PosSaleViewportGuard"/);
  assert.match(layout, /import saleViewportGuardStyles from "\.\/pos-sale-viewport-guard\.module\.css"/);
  assert.match(layout, /cartTitleLayoutStyles\.cartTitleLayout\} \$\{saleViewportGuardStyles\.saleViewportGuard\}/);
  assert.match(layout, /<PosSaleViewportGuard \/>[\s\S]*<PosRegisterShell>\{children\}<\/PosRegisterShell>/);

  assert.match(guard, /const CSS_VARIABLE = "--pos-sale-visible-height"/);
  assert.match(guard, /const MIN_PANEL_HEIGHT = 320/);
  assert.match(guard, /const BOTTOM_GAP = 14/);
  assert.match(guard, /window\.visualViewport/);
  assert.match(guard, /viewport\.offsetTop \+ viewport\.height/);
  assert.match(guard, /root\.dataset\.posSquareFlowMode !== "sale"/);
  assert.match(guard, /panel\.getBoundingClientRect\(\)\.top/);
  assert.match(guard, /viewportBottom\(\) - top - BOTTOM_GAP/);
  assert.match(guard, /panel\.style\.setProperty\(CSS_VARIABLE, `\$\{available\}px`\)/);
  assert.match(guard, /window\.visualViewport\?\.addEventListener\("resize", sync/);
  assert.match(guard, /window\.visualViewport\?\.addEventListener\("scroll", sync/);

  assert.match(guardCss, /Final sale-screen viewport boundary/);
  assert.match(guardCss, /data-pos-authenticated="true"\]\[data-pos-square-flow-mode="sale"\] \.pos-cart-panel/);
  assert.match(guardCss, /height: var\(--pos-sale-visible-height, 100%\) !important/);
  assert.match(guardCss, /max-height: var\(--pos-sale-visible-height, 100%\) !important/);
  assert.match(guardCss, /display: flex !important/);
  assert.match(guardCss, /flex-direction: column !important/);
  assert.match(guardCss, /overflow: hidden !important/);
  assert.match(guardCss, /\.pos-cart-lines:not\(\.is-empty\)[\s\S]*flex: 1 1 0 !important/);
  assert.match(guardCss, /\.pos-cart-lines:not\(\.is-empty\)[\s\S]*overflow-y: auto !important/);
  assert.match(guardCss, /\.pos-cart-lines:not\(\.is-empty\)[\s\S]*-webkit-overflow-scrolling: touch/);
  assert.match(guardCss, /\.pos-cart-panel > \[aria-label="Checkout action"\][\s\S]*flex: 0 0 auto !important/);
  assert.match(guardCss, /\.pos-cart-panel > \[aria-label="Checkout action"\][\s\S]*min-height: 66px !important/);
  assert.match(guardCss, /\.pos-cart-panel > \[aria-label="Checkout action"\][\s\S]*position: sticky !important/);
  assert.match(guardCss, /\.pos-cart-panel > \[aria-label="Checkout action"\][\s\S]*bottom: 0 !important/);

  assert.match(flow, /elementIsCheckoutVisible/);
  assert.match(flow, /visibleViewportBounds/);
  assert.match(flow, /aria-label="Pinned checkout action"/);
  assert.match(flow, /aria-label="Pinned complete sale action"/);
  assert.match(flow, /completeButtonIsDisabled/);
  assert.match(flow, /button\.click\(\)/);
  assert.match(flowCss, /\.floatingActionDock[\s\S]*position: fixed/);
  assert.match(flowCss, /\.floatingActionDock[\s\S]*bottom: max\(12px, env\(safe-area-inset-bottom\)\)/);
  assert.match(flowCss, /\.floatingActionDock[\s\S]*z-index: 5100/);
  assert.match(flowCss, /\.floatingCompleteButton/);
});
