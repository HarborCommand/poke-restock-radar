import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  BEST_BUY_DISCOVERY_SEARCH_TERMS,
  TARGET_DISCOVERY_SEARCH_TERMS,
  bestBuyDiscoverySourceUrl,
  evaluateTargetPokemonTcgCandidate,
  targetDiscoverySourceUrl
} from "../src/lib/product-discovery";

test("dormant Target and Best Buy discovery helpers still classify historical data", () => {
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
  assert.ok(BEST_BUY_DISCOVERY_SEARCH_TERMS.includes("Pokemon TCG"));
  assert.equal(bestBuyDiscoverySourceUrl("Pokemon TCG"), "https://www.bestbuy.com/site/searchpage.jsp?st=Pokemon+TCG");

  const accepted = evaluateTargetPokemonTcgCandidate(
    "Pokemon Trading Card Game: Mega Evolution Chaos Rising Three-Booster Blister",
    "https://www.target.com/p/pokemon-trading-card-game-mega-evolution-chaos-rising-three-booster-blister/-/A-95280894"
  );
  assert.equal(accepted.included, true);
  assert.equal(accepted.productType, "3-Pack Blister");

  const plush = evaluateTargetPokemonTcgCandidate(
    "Pokemon Pikachu Plush Toy",
    "https://www.target.com/p/pokemon-pikachu-plush/-/A-11111111"
  );
  assert.equal(plush.included, false);
  assert.match(plush.reason, /non-TCG/i);
});

test("automatic Target and Best Buy discovery routes, cron, and env examples are retired", () => {
  const root = new URL("..", import.meta.url);
  const app = readFileSync(new URL("src/components/RadarApp.tsx", root), "utf8");
  const service = readFileSync(new URL("src/lib/radar-service.ts", root), "utf8");
  const env = readFileSync(new URL(".env.example", root), "utf8");
  const readme = readFileSync(new URL("README.md", root), "utf8");

  for (const route of [
    "src/app/api/radar/product-discovery/target/route.ts",
    "src/app/api/radar/product-discovery/best-buy/route.ts",
    "src/app/api/radar/product-discovery/sources/route.ts",
    "src/app/api/radar/product-discovery/candidates/[candidateId]/enrich/route.ts",
    "src/app/api/radar/product-discovery/candidates/[candidateId]/identifiers/route.ts",
    "src/app/api/radar/product-discovery/candidates/[candidateId]/review/route.ts",
    "src/app/api/radar/monitor/cron/route.ts"
  ]) {
    assert.equal(existsSync(new URL(route, root)), false, `retired route still exists: ${route}`);
  }

  assert.match(service, /runAutomaticTargetDiscoveryPipeline/);
  assert.match(service, /runAutomaticBestBuyDiscoveryPipeline/);
  assert.match(app.slice(app.indexOf("const tabs"), app.indexOf("type NavTab")), /label: "Alerts"/);
  assert.match(app.slice(app.indexOf("<section className=\"content-grid\">"), app.indexOf("{activeTab === \"settings\"")), /AlertsPanel/);
  const alertsPanelSource = app.slice(app.indexOf("function AlertsPanel"), app.indexOf("function runTargetBatch"));
  assert.doesNotMatch(alertsPanelSource.slice(alertsPanelSource.indexOf("title=\"Alerts\"")), /product-discovery|monitor\/run|check-stock|Run Discovery|Run Check/);
  assert.doesNotMatch(env, /TARGET_DISCOVERY_AUTO_ENABLED|BESTBUY_DISCOVERY_ENABLED|BESTBUY_API_KEY/);
  assert.match(readme, /automated Restock Radar \/ product tracker subsystem has been retired/i);
  assert.doesNotMatch(readme, /Target discovery now runs as the primary tracker intake|Best Buy discovery is the next conservative automatic intake/);
});
