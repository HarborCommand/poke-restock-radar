import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  TARGET_DISCOVERY_SEARCH_TERMS,
  evaluateTargetPokemonTcgCandidate,
  targetDiscoverySourceUrl
} from "../src/lib/product-discovery";

test("Target Pokemon TCG discovery defaults cover core product searches", () => {
  for (const term of [
    "Pokemon trading cards",
    "Pokemon booster bundle",
    "Pokemon elite trainer box",
    "Pokemon checklane blister",
    "Chaos Rising Pokemon",
    "Perfect Order Pokemon"
  ]) {
    assert.ok(TARGET_DISCOVERY_SEARCH_TERMS.includes(term), `missing default Target search term ${term}`);
  }
  assert.equal(targetDiscoverySourceUrl("Pokemon TCG"), "https://www.target.com/s?searchTerm=Pokemon+TCG");
});

test("Target discovery accepts card products and rejects Pokemon merch", () => {
  const accepted = evaluateTargetPokemonTcgCandidate(
    "Pokemon Trading Card Game: Mega Evolution Chaos Rising Three-Booster Blister",
    "https://www.target.com/p/pokemon-trading-card-game-mega-evolution-chaos-rising-three-booster-blister/-/A-95280894"
  );
  assert.equal(accepted.included, true);
  assert.equal(accepted.productType, "Blister Pack");
  assert.ok(accepted.confidenceScore >= 70);

  const plush = evaluateTargetPokemonTcgCandidate(
    "Pokemon Pikachu Plush Toy",
    "https://www.target.com/p/pokemon-pikachu-plush/-/A-11111111"
  );
  assert.equal(plush.included, false);
  assert.match(plush.reason, /non-TCG/i);

  const hoodie = evaluateTargetPokemonTcgCandidate(
    "Pokemon Charizard Kids Hoodie",
    "https://www.target.com/p/pokemon-charizard-hoodie/-/A-22222222"
  );
  assert.equal(hoodie.included, false);
  assert.match(hoodie.reason, /excluded terms/i);
});

test("Target discovery UI and routes expose approval workflow without buy-alerting search pages", () => {
  const root = new URL("..", import.meta.url);
  const app = readFileSync(new URL("src/components/RadarApp.tsx", root), "utf8");
  const discovery = readFileSync(new URL("src/lib/product-discovery.ts", root), "utf8");
  const service = readFileSync(new URL("src/lib/radar-service.ts", root), "utf8");
  const route = readFileSync(new URL("src/app/api/radar/product-discovery/target/route.ts", root), "utf8");

  assert.match(discovery, /Search\/category pages are discovery-only/);
  assert.match(discovery, /REJECTED_NON_TCG/);
  assert.match(service, /approval requires an exact/i);
  assert.match(service, /verifyProductLink\(product\.id\)/);
  assert.match(route, /run_now/);
  assert.match(route, /approve_high_confidence/);
  assert.match(route, /clear_rejected/);
  assert.match(app, /Target Pokemon TCG Discovery/);
  assert.match(app, /Run Target Discovery Now/);
  assert.match(app, /Approve All High Confidence/);
  assert.match(app, /Reject as Non-TCG/);
  assert.match(app, /Show Rejected/);
  assert.match(app, /Add to Inventory/);
  assert.match(app, /Search pages are discovery-only|search pages are discovery-only/i);
  assert.match(app, /Pokemon Center and GameStop may block automated checks/);
  assert.match(app, /Best Buy exact products can be watched/);
});
