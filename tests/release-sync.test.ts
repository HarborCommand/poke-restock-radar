import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  classifyAdapterStatusForTest,
  isLikelyReleaseArticleTitle,
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
        <h2>Mega Evolution Pitch Black</h2>
        <p>Release Date: July 17, 2026</p>
        <p>Explore the newest Pokemon TCG expansion.</p>
      </main>
    `,
    "https://tcg.pokemon.com/en-us/expansions/"
  );

  assert.equal(releases.length, 1);
  assert.equal(releases[0].setName, "Mega Evolution Pitch Black");
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

test("official news parser ignores source article titles and generic headlines", () => {
  const releases = parseOfficialNewsHtml(
    `
      <html>
        <title>Check Out Every Pokemon TCG Product Release in March 2026</title>
        <h1>Check Out Every Pokemon TCG Product Release in March 2026</h1>
        <h2>Don't miss out on more products from the latest expansions.</h2>
        <h2>Pokemon TCG: Mega Evolution Perfect Order Booster Bundle</h2>
        <p>Available March 20, 2026 at participating retailers.</p>
      </html>
    `,
    "https://www.pokemon.com/us/pokemon-news/check-out-every-pokemon-tcg-product-release-in-march-2026"
  );

  assert.equal(releases.length, 1);
  assert.equal(releases[0].productName, "Pokemon TCG: Mega Evolution Perfect Order Booster Bundle");
  assert.equal(releases[0].officialReleaseDate?.toISOString().slice(0, 10), "2026-03-20");
  assert.ok(isLikelyReleaseArticleTitle("Check Out Every Pokemon TCG Product Release in March 2026"));
  assert.ok(isLikelyReleaseArticleTitle("Don't miss out on more products from the latest expansions."));
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
  assert.match(fallback[0].setName, /Mega Evolution.*Pitch Black/);
  assert.equal(fallback[0].status, "confirmed");
  assert.equal(fallback[0].officialReleaseDate?.toISOString().slice(0, 10), "2026-07-17");
});

test("icv2 parser schedules trusted product calendar entries automatically", () => {
  const releases = parseIcv2CalendarHtml(
    `
      July 17, 2026 Pokemon TCG: Mega Evolution Pitch Black Booster Bundle
      July 24, 2026 Pokemon TCG: Mega Evolution Pitch Black Premium Collection
    `,
    "https://icv2.com/search?q=Pokemon%20TCG%202026%20Product%20Calendar"
  );

  assert.equal(releases.length, 2);
  assert.ok(releases.every((release) => release.sourceType === "icv2_calendar"));
  assert.ok(releases.every((release) => !release.needsReview));
  assert.ok(releases.every((release) => release.status === "scheduled"));
});

test("icv2 parser handles product-name-first calendar entries", () => {
  const releases = parseIcv2CalendarHtml(
    `
      Pokemon TCG: Mega Evolution Pitch Black Booster Bundle Release Date: July 17, 2026
      Pokemon TCG: Lumiose City Mini Tins Release Date: June 5, 2026
      Mega Greninja ex Premium Collection Release Date: July 3, 2026
      Pokemon TCG: Mega Evolution Pitch Black Premium Collection Street Date: July 24, 2026
    `,
    "https://icv2.com/articles/news/view/61079/pokemon-tcg-2026-product-calendar"
  );

  assert.equal(releases.length, 4);
  assert.equal(releases[0].productName, "Pokemon TCG: Mega Evolution Pitch Black Booster Bundle");
  assert.equal(releases[0].officialReleaseDate?.toISOString().slice(0, 10), "2026-07-17");
  assert.ok(
    releases.some(
      (release) =>
        release.productName === "Mega Greninja ex Premium Collection" &&
        release.officialReleaseDate?.toISOString().slice(0, 10) === "2026-07-03"
    )
  );
  assert.ok(releases.every((release) => release.confidence === "MEDIUM"));
  assert.ok(releases.every((release) => !release.needsReview));
  assert.ok(releases.every((release) => release.status === "scheduled"));
});


test("icv2 parser extracts clean product name from description-heavy lines", () => {
  const releases = parseIcv2CalendarHtml(
    `
      coin-flip die, 2 coin condition markers, a deck box, a strategy sheet, and a code card for online play. Lumiose City Mini Tins Release Date: June 5, 2026
    `,
    "https://icv2.com/articles/news/view/61079/pokemon-tcg-2026-product-calendar"
  );

  assert.equal(releases.length, 1);
  assert.equal(releases[0].productName, "Lumiose City Mini Tins");
  assert.equal(releases[0].status, "scheduled");
  assert.equal(releases[0].needsReview, false);
});
test("release candidate merge prefers official sources and flags date conflicts", () => {
  const [official] = parseOfficialExpansionsHtml(
    `<h2>Mega Evolution Pitch Black</h2><p>Release Date: July 17, 2026</p>`,
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

test("source health marks blocked and 404 sources instead of clean", () => {
  assert.equal(
    classifyAdapterStatusForTest({
      sourceName: "Official Pokemon News",
      sourceUrl: "https://www.pokemon.com/us/pokemon-news/missing",
      adapter: "official_pokemon_news",
      httpStatus: 404,
      parsedCount: 0,
      error: "HTTP 404"
    }),
    "failed"
  );
  assert.equal(
    classifyAdapterStatusForTest({
      sourceName: "Official Pokemon expansions",
      sourceUrl: "https://tcg.pokemon.com/en-us/expansions/",
      adapter: "official_pokemon",
      httpStatus: 200,
      parsedCount: 0,
      error: "Blocked or bot-protected response"
    }),
    "blocked"
  );
});

test("release details UI exposes source links and source-missing states", () => {
  const app = readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

  assert.match(app, /function ReleaseDetailModal/);
  assert.match(app, /Open Source <ExternalLink/);
  assert.match(app, /Copy Source Link/);
  assert.match(app, /This release does not have a source link yet\./);
  assert.match(app, /Save Source URL/);
  assert.match(app, /releaseSourceUrl\(release\)/);
  assert.match(app, /aria-label=\{`Open source for \$\{release\.setName\}`\}/);
  assert.match(app, /aria-label=\{`Source missing for \$\{release\.setName\}`\}/);
  assert.match(css, /release-source-card/);
  assert.match(css, /release-source-warning/);
});

test("release detail admin controls can mark status and save source URL", () => {
  const app = readFileSync(new URL("../src/components/RadarApp.tsx", import.meta.url), "utf8");

  assert.match(app, /Mark Confirmed/);
  assert.match(app, /Mark Needs Review/);
  assert.match(app, /Merge Duplicate/);
  assert.match(app, /Ignore/);
  assert.match(app, /releasePatchPayload\(release, \{\s*status: "confirmed"/);
  assert.match(app, /releasePatchPayload\(release, \{\s*status: "needs_review"/);
  assert.match(app, /const nextSourceUrl = formString\(data\.sourceUrl\)/);
  assert.match(app, /sourceUrl: nextSourceUrl \|\| null/);
});


