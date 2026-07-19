import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { publicProductToDTO } from "../src/lib/storefront";
import { productCanonicalPath, productCanonicalUrl } from "../src/lib/storefront-seo";
import { auditStorefrontSlugs, normalizeStorefrontSlug } from "../src/lib/storefront-slugs";

function readProjectFile(path: string) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function storefrontItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "inventory-product-1",
    itemName: "Pokémon Trading Card Game: Mega Evolution Chaos Rising Booster Bundle",
    publicTitle: "Pokémon Trading Card Game: Mega Evolution Chaos Rising Booster Bundle",
    publicSlug: "pok233mon-trading-card-game-mega-evolution-chaos-rising-booster-bundle",
    publicPrice: 49.99,
    compareAtPrice: null,
    publishToStore: true,
    storeStatus: "active",
    quantity: 8,
    availableForSale: 5,
    sales: [],
    stockLots: [],
    productImages: [],
    storefrontTags: '["Pokemon","Booster Bundle"]',
    storefrontCategory: "Booster Bundles",
    category: "Booster Bundles",
    setName: "Mega Evolution",
    condition: "New sealed",
    brand: "Pokemon",
    manufacturer: "The Pokemon Company",
    sku: "GDG-CHAOS-1",
    upc: "123456789012",
    publicMaxQuantity: null,
    localPickupAvailable: true,
    shippingAvailable: true,
    shippingProfile: "small_box",
    packageWeightOz: 12,
    packageLengthIn: 8,
    packageWidthIn: 5,
    packageHeightIn: 3,
    shippingMetadataSource: null,
    freeShippingEligible: false,
    requiresBox: true,
    insuranceRecommended: false,
    publicDescription: "Factory sealed booster bundle.",
    description: "Internal notes are not public.",
    publishedAt: new Date("2026-06-15T00:00:00.000Z"),
    createdAt: new Date("2026-06-15T00:00:00.000Z"),
    updatedAt: new Date("2026-06-15T00:00:00.000Z"),
    ...overrides
  };
}

test("storefront slug normalization transliterates Unicode, entities, mojibake, and smart punctuation deterministically", () => {
  const examples = new Map([
    ["Pokémon Trading Card Game", "pokemon-trading-card-game"],
    ["Pok&#233;mon TCG", "pokemon-tcg"],
    ["Pok&#xE9;mon TCG", "pokemon-tcg"],
    ["PokÃ© Ball Tin", "poke-ball-tin"],
    ["CafÃ© PokÃ©mon", "cafe-pokemon"],
    ["Scarlet & Violet—151", "scarlet-violet-151"],
    ["Scarlet &amp; Violetâ€”151", "scarlet-violet-151"],
    ["Mega Evolution â€“ Receive 1 At Random!", "mega-evolution-receive-1-at-random"],
    ["Pokémon™ Elite Trainer Box®", "pokemon-elite-trainer-box"],
    ["Collector's Vault", "collector-s-vault"],
    ["Mega!!! Evolution??? Box", "mega-evolution-box"],
    ["Mega---Evolution___Box", "mega-evolution-box"],
    ["Pokemon 233 Pack", "pokemon-233-pack"]
  ]);

  for (const [input, expected] of examples) {
    assert.equal(normalizeStorefrontSlug(input), expected, input);
  }
});

test("storefront slug normalization repairs legacy numeric entity fragments without corrupting normal product numbers", () => {
  assert.equal(
    normalizeStorefrontSlug("pok233mon-trading-card-game-mega-evolution-chaos-rising-booster-bundle"),
    "pokemon-trading-card-game-mega-evolution-chaos-rising-booster-bundle"
  );
  assert.equal(normalizeStorefrontSlug("pok233-ball-tin-q4-2025"), "poke-ball-tin-q4-2025");
  assert.equal(normalizeStorefrontSlug("scarlet-violet-151"), "scarlet-violet-151");
  assert.equal(normalizeStorefrontSlug("product-233-pack"), "product-233-pack");
});

test("storefront slug normalization is bounded and deterministic for long or unsupported strings", () => {
  const longSlug = normalizeStorefrontSlug(
    "Pokémon Trading Card Game Mega Evolution Chaos Rising Booster Bundle With Many Extra Words And Repeated !!! Punctuation"
  );

  assert.ok(longSlug.length <= 96);
  assert.equal(longSlug, "pokemon-trading-card-game-mega-evolution-chaos-rising-booster-bundle-with-many-extra-words-and");
  assert.equal(normalizeStorefrontSlug("!!! --- ___", "fallback-product"), "fallback-product");
});

test("public product DTOs expose normalized canonical slugs while preserving the existing record identity", () => {
  const product = publicProductToDTO(storefrontItem() as never);

  assert.ok(product);
  assert.equal(product.id, "inventory-product-1");
  assert.equal(product.slug, "pokemon-trading-card-game-mega-evolution-chaos-rising-booster-bundle");
  assert.notEqual(product.slug, "pok233mon-trading-card-game-mega-evolution-chaos-rising-booster-bundle");
});

test("product canonical paths and URLs never emit malformed legacy slug fragments", () => {
  assert.equal(
    productCanonicalPath("pok233mon-trading-card-game-mega-evolution-chaos-rising-booster-bundle"),
    "/product/pokemon-trading-card-game-mega-evolution-chaos-rising-booster-bundle"
  );
  assert.equal(
    productCanonicalUrl("pok233mon-trading-card-game-mega-evolution-chaos-rising-booster-bundle"),
    "https://www.gamedaygrabs.com/product/pokemon-trading-card-game-mega-evolution-chaos-rising-booster-bundle"
  );
});

test("legacy product URLs resolve through public lookup and redirect source without adding a slug-alias migration", () => {
  const storefront = readProjectFile("src/lib/storefront.ts");
  const serverViews = readProjectFile("src/components/StorefrontServerViews.tsx");
  const schema = readProjectFile("prisma/schema.prisma");
  const migrations = fs.readdirSync(new URL("../prisma/migrations", import.meta.url)).join("\n");

  assert.match(storefront, /const normalizedSlug = normalizeStorefrontSlug\(slug\)/);
  assert.match(storefront, /normalizedMatches\.length === 1/);
  assert.match(storefront, /publicProductToDTO\(item, \{ profileDefinitions \}\)/);
  assert.match(serverViews, /permanentRedirect\(productCanonicalPath\(product\.slug\)\)/);
  assert.match(serverViews, /if \(!product\) notFound\(\)/);
  assert.doesNotMatch(serverViews, /searchParams|request\.url|nextUrl/);
  assert.doesNotMatch(schema, /SlugAlias|slugAlias|StorefrontSlugAlias|LegacySlug/);
  assert.doesNotMatch(migrations, /slug.*alias|legacy.*slug/i);
});

test("storefront slug audit reports deterministic corrections and collisions without writes", () => {
  const rows = auditStorefrontSlugs([
    {
      id: "item_1",
      title: "Pokémon Trading Card Game",
      publicSlug: "pok233mon-trading-card-game",
      publishToStore: true,
      storeStatus: "active"
    },
    {
      id: "item_2",
      title: "Pokemon Trading Card Game",
      publicSlug: "pokemon-trading-card-game",
      publishToStore: true,
      storeStatus: "active"
    },
    {
      id: "item_3",
      title: "Scarlet & Violet—151",
      publicSlug: "scarlet-violet-151",
      publishToStore: true,
      storeStatus: "sold_out"
    }
  ]);

  assert.equal(rows[0].proposedSlug, "pokemon-trading-card-game");
  assert.equal(rows[0].needsCorrection, true);
  assert.equal(rows[0].collision, true);
  assert.equal(rows[1].needsCorrection, false);
  assert.equal(rows[1].collision, true);
  assert.equal(rows[2].proposedSlug, "scarlet-violet-151");
  assert.equal(rows[2].collision, false);

  const script = readProjectFile("scripts/audit-storefront-slugs.ts");
  assert.match(script, /mode: "dry-run"/);
  assert.match(script, /writesPerformed: false/);
  assert.doesNotMatch(script, /prisma\.inventoryItem\.(update|updateMany|upsert|create|delete|deleteMany)/);
});

test("admin storefront preview links use canonical normalized paths instead of raw stored slugs", () => {
  const radarApp = readProjectFile("src/components/RadarApp.tsx");

  assert.match(radarApp, /function storefrontPreviewHref\(publicSlug: string\)/);
  assert.match(radarApp, /normalizeStorefrontSlug\(publicSlug\)/);
  assert.doesNotMatch(radarApp, /href=\{`\/shop\/product\/\$\{(?:item|actionMenu\.item)\.publicSlug\}`\}/);
});
