import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BEST_BUY_DISCOVERY_SEARCH_TERMS,
  TARGET_DISCOVERY_SEARCH_TERMS,
  bestBuyDiscoverySourceUrl,
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
  assert.ok(BEST_BUY_DISCOVERY_SEARCH_TERMS.includes("Pokemon TCG"));
  assert.equal(bestBuyDiscoverySourceUrl("Pokemon TCG"), "https://www.bestbuy.com/site/searchpage.jsp?st=Pokemon+TCG");
});

test("Target discovery accepts card products and rejects Pokemon merch", () => {
  const accepted = evaluateTargetPokemonTcgCandidate(
    "Pokemon Trading Card Game: Mega Evolution Chaos Rising Three-Booster Blister",
    "https://www.target.com/p/pokemon-trading-card-game-mega-evolution-chaos-rising-three-booster-blister/-/A-95280894"
  );
  assert.equal(accepted.included, true);
  assert.equal(accepted.productType, "3-Pack Blister");
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
  assert.match(service, /verifyProductLink\(productWithCandidateData\.id\)/);
  assert.match(service, /runProductMonitorCheck\(productWithCandidateData\.id/);
  assert.match(route, /run_now/);
  assert.match(route, /enrich_all_pending/);
  assert.match(route, /approve_watch_ready/);
  assert.match(route, /approve_selected/);
  assert.match(route, /reject_selected/);
  assert.match(route, /ignore_selected/);
  assert.match(route, /approve_high_confidence_enriched/);
  assert.match(route, /approve_high_confidence/);
  assert.match(route, /clear_rejected/);
  assert.match(route, /run_auto_pipeline/);
  assert.match(app, /Target Pokemon TCG Discovery/);
  assert.match(app, /Automatic Target discovery/);
  assert.match(app, /Run Discovery Now/);
  assert.match(app, /Run Monitor Now/);
  assert.match(app, /Auto Discovery/);
  assert.match(app, /Auto Approval/);
  assert.match(app, /Retail Only/);
  assert.match(app, /Advanced manual review tools/);
  assert.match(app, /Advanced manual Target tools/);
  assert.match(app, /Approve All Watch Ready/);
  assert.match(app, /Approve Selected/);
  assert.match(app, /Reject Selected/);
  assert.match(app, /Ignore Selected/);
  assert.match(app, /Select All Visible/);
  assert.match(app, /Watch Ready/);
  assert.match(app, /Enrich All Pending/);
  assert.match(app, /Reject/);
  assert.match(app, /Show Rejected/);
  assert.match(app, /Hide Partial Candidates/);
  assert.match(app, /Add to Inventory/);
  assert.match(app, /Missing UPC/);
  assert.match(app, /Missing DPCI/);
  assert.match(app, /Watch ready/);
  assert.match(service, /normalizedDiscoveryTitle/);
  assert.match(service, /runAutomaticTargetDiscoveryPipeline/);
  assert.match(service, /TARGET_DISCOVERY_AUTO_APPROVAL_ENABLED/);
  assert.match(service, /TARGET_DISCOVERY_RETAIL_ONLY_ENABLED/);
  assert.match(service, /Auto-approved from Target discovery/);
  assert.match(service, /approveWatchReadyTargetDiscoveryCandidates/);
  assert.match(service, /findExistingProductForDiscoveryCandidate/);
  assert.match(app, /Automatic Target discovery is the normal workflow/);
  assert.match(app, /Search pages are scanned automatically|search pages are scanned automatically/i);
  assert.match(app, /Pokemon Center and GameStop may block automated checks/);
  assert.match(app, /Best Buy exact products can be watched/);
  assert.match(app, /Best Buy discovery/);
  assert.match(app, /Run Best Buy Discovery Now/);
  assert.match(app, /Products API configured/);
  assert.match(app, /Public pages fallback/);
  assert.match(app, /Run Target QA Now/);
  assert.match(app, /Vendor \/ marketplace suppressed/);
  assert.match(app, /Over-MSRP suppressed/);
  assert.match(service, /ensureBestBuyDiscoverySources/);
  assert.match(service, /runAutomaticBestBuyDiscoveryPipeline/);
  assert.match(service, /Auto-approved Best Buy exact Pokemon TCG candidate/);
});

test("Target automatic discovery is wired into cron and configuration docs", () => {
  const root = new URL("..", import.meta.url);
  const cron = readFileSync(new URL("src/app/api/radar/monitor/cron/route.ts", root), "utf8");
  const env = readFileSync(new URL(".env.example", root), "utf8");
  const readme = readFileSync(new URL("README.md", root), "utf8");

  assert.match(cron, /runAutomaticTargetDiscoveryPipeline\(false\)/);
  assert.match(cron, /automaticTargetDiscovery/);
  assert.match(cron, /runAutomaticBestBuyDiscoveryPipeline\(false\)/);
  assert.match(cron, /automaticBestBuyDiscovery/);
  assert.match(env, /TARGET_DISCOVERY_AUTO_ENABLED="true"/);
  assert.match(env, /TARGET_DISCOVERY_AUTO_APPROVAL_ENABLED="true"/);
  assert.match(env, /TARGET_DISCOVERY_RETAIL_ONLY_ENABLED="true"/);
  assert.match(env, /TARGET_DISCOVERY_AUTO_SOURCE_LIMIT="4"/);
  assert.match(env, /TARGET_DISCOVERY_AUTO_APPROVE_LIMIT="12"/);
  assert.match(env, /BESTBUY_DISCOVERY_ENABLED="true"/);
  assert.match(env, /BESTBUY_API_KEY=""/);
  assert.match(readme, /Target discovery now runs as the primary tracker intake/);
  assert.match(readme, /Best Buy discovery is the next conservative automatic intake/);
  assert.match(readme, /TARGET_DISCOVERY_CADENCE_MINUTES/);
  assert.match(readme, /BESTBUY_DISCOVERY_CADENCE_MINUTES/);
});
