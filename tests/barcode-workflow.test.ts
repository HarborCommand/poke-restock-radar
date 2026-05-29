import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync(new URL("../src/lib/radar-service.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");

test("barcode lookup checks UPC variants across inventory, watched products, and scan history", () => {
  assert.match(service, /const variants = upcLookupVariants\(rawUpc\)/);
  assert.match(service, /where: \{ upc: \{ in: variants \}/);
  assert.match(service, /lookupFailure\("scan_history"/);
  assert.match(service, /OR: \[\{ upc: \{ in: variants \} \}, \{ rawCode: \{ in: variants \} \}, \{ normalizedUpc: \{ in: variants \} \}\]/);
});

test("barcode lookup returns deterministic next actions for every scan result", () => {
  assert.match(service, /nextAction: matchedInventoryItem \? "ADD_STOCK"/);
  assert.match(service, /: matchedWatchedProduct \? "CREATE_FROM_WATCHED" : "CREATE_MANUAL"/);
  assert.match(service, /status: BarcodeScanDTO\["status"\] = matchedInventoryItem \|\| matchedWatchedProduct \|\| external\.product \? "PRODUCT_FOUND" : "NEW_UPC"/);
  assert.match(service, /new_upc_external_lookup_not_configured/);
});

test("scanner UI exposes useful actions instead of a dead-end lookup failed state", () => {
  assert.match(app, /function upcLookupPrimaryAction/);
  assert.match(app, /return "Add Stock"/);
  assert.match(app, /return "Create Inventory Product"/);
  assert.match(app, /return "Create New Product"/);
  assert.match(app, /onViewProduct\(result\.matchedInventoryItem!\)/);
  assert.match(app, /defaultItemId\s*\?\s*"Product already exists in your catalog\. Add stock to the existing item\."/);
  assert.match(app, /External UPC lookup is not configured, but you can still create this product manually/);
});
