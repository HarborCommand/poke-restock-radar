import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeReleaseCandidatesForTest,
  parseIcv2CalendarHtml,
  parseOfficialExpansionsHtml,
  parseOfficialNewsHtml,
  parseOfficialNewsUrlFallback
} from "../src/lib/release-sync";

test("official expansion parser captures future Pokemon TCG set dates", () => {
  const releases = parseOfficialExpansionsHtml(
    `
      <main>
        <h2>Mega Evolution—Pitch Black</h2>
        <p>Release Date: July 17, 2026</p>
        <p>Explore the newest Pokemon TCG expansion.</p>
      </main>
    `,
    "https://tcg.pokemon.com/en-us/expansions/"
  );

  assert.equal(releases.length, 1);
  assert.equal(releases[0].setName, "Mega Evolution—Pitch Black");
  assert.equal(releases[0].sourceType, "official_pokemon");
  assert.equal(releases[0].confidence, "HIGH");
  assert.equal(releases[0].officialReleaseDate?.toISOString().slice(0, 10), "2026-07-17");
});

test("official news parser captures product roundup entries with dates", () => {
  const releases = parseOfficialNewsHtml(
    `
      <html>
        <title>Check Out Every Pokemon TCG Product Release in July 2026</title>
        <h2>Pokemon TCG: Mega Evolution Pitch Black Elite Trainer Box</h2>
        <p>Available July 17, 2026, this product includes booster packs and accessories.</p>
        <h2>Pokemon TCG: Mega Evolution Pitch Black Booster Bundle</h2>
        <p>Arrives July 17, 2026 at participating retailers.</p>
      </html>
    `,
    "https://www.pokemon.com/us/pokemon-news/check-out-every-pokemon-tcg-product-release-in-july-2026"
  );

  assert.equal(releases.length, 2);
  assert.ok(releases.every((release) => release.sourceType === "official_pokemon_news"));
  assert.ok(releases.every((release) => release.confidence === "HIGH"));
});

test("official news sync can derive a release from an official dated article URL when the body is blocked", () => {
  const releases = parseOfficialNewsHtml(
    `<html><h1>Pardon Our Interruption</h1><p>Please stand by</p></html>`,
    "https://www.pokemon.com/uk/pokemon-news/the-pokemon-tcg-mega-evolution-pitch-black-expansion-arrives-july-17-2026"
  );

  assert.equal(releases.length, 0);
  const fallback = parseOfficialNewsUrlFallback(
    "https://www.pokemon.com/uk/pokemon-news/the-pokemon-tcg-mega-evolution-pitch-black-expansion-arrives-july-17-2026"
  );
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].setName, "Mega Evolution—Pitch Black");
  assert.equal(fallback[0].officialReleaseDate?.toISOString().slice(0, 10), "2026-07-17");
});

test("icv2 parser marks secondary-only product calendar entries for review", () => {
  const releases = parseIcv2CalendarHtml(
    `
      July 17, 2026 Pokemon TCG: Mega Evolution Pitch Black Booster Bundle
      July 24, 2026 Pokemon TCG: Mega Evolution Pitch Black Premium Collection
    `,
    "https://icv2.com/search?q=Pokemon%20TCG%202026%20Product%20Calendar"
  );

  assert.equal(releases.length, 2);
  assert.ok(releases.every((release) => release.sourceType === "icv2_calendar"));
  assert.ok(releases.every((release) => release.needsReview));
});

test("icv2 parser handles product-name-first calendar entries", () => {
  const releases = parseIcv2CalendarHtml(
    `
      Pokemon TCG: Mega Evolution Pitch Black Booster Bundle Release Date: July 17, 2026
      Pokemon TCG: Lumiose City Mini Tins Release Date: June 5, 2026
      Pokemon TCG: Mega Evolution Pitch Black Premium Collection Street Date: July 24, 2026
    `,
    "https://icv2.com/articles/news/view/61079/pokemon-tcg-2026-product-calendar"
  );

  assert.equal(releases.length, 3);
  assert.equal(releases[0].productName, "Pokemon TCG: Mega Evolution Pitch Black Booster Bundle");
  assert.equal(releases[0].officialReleaseDate?.toISOString().slice(0, 10), "2026-07-17");
  assert.ok(releases.every((release) => release.confidence === "MEDIUM"));
  assert.ok(releases.every((release) => release.needsReview));
});

test("release candidate merge prefers official sources and flags date conflicts", () => {
  const [official] = parseOfficialExpansionsHtml(
    `<h2>Mega Evolution—Pitch Black</h2><p>Release Date: July 17, 2026</p>`,
    "https://tcg.pokemon.com/en-us/expansions/"
  );
  const [secondary] = parseIcv2CalendarHtml(
    `July 24, 2026 Pokemon TCG: Mega Evolution Pitch Black Booster Bundle`,
    "https://icv2.com/calendar"
  );
  const merged = mergeReleaseCandidatesForTest([official, secondary]);

  assert.equal(merged.candidates.length, 1);
  assert.equal(merged.conflicts, 1);
  assert.equal(merged.candidates[0].sourceType, "official_pokemon");
  assert.equal(merged.candidates[0].officialReleaseDate?.toISOString().slice(0, 10), "2026-07-17");
  assert.equal(merged.candidates[0].needsReview, true);
  assert.match(merged.candidates[0].reviewReason ?? "", /Conflicting release dates/);
});
