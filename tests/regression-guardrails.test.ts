import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("large frontend files stay below documented growth ceilings", () => {
  const limits = [
    { file: "src/components/RadarApp.tsx", maxBytes: 1_350_000 },
    { file: "src/app/globals.css", maxBytes: 700_000 }
  ];
  for (const limit of limits) {
    const bytes = statSync(path.join(root, limit.file)).size;
    assert.ok(bytes <= limit.maxBytes, `${limit.file} is ${bytes} bytes; split shared modules before exceeding ${limit.maxBytes}.`);
  }
});

test("customer workspace search debounces and aborts stale requests", () => {
  const source = readFileSync(path.join(root, "src/components/RadarApp.tsx"), "utf8");
  const panel = source.slice(source.indexOf("function CustomersRewardsPanel"), source.indexOf("function CustomerRewardKpi"));
  assert.match(source, /function useDebouncedValue<T>/);
  assert.match(panel, /useDebouncedValue\(search, 300\)/);
  assert.match(panel, /const effectiveSearch = submittedSearch === search \? submittedSearch : debouncedSearch/);
  assert.match(panel, /function handleSearchKeyDown|const handleSearchKeyDown/);
  assert.match(panel, /event\.key !== "Enter"/);
  assert.match(panel, /submitSearchNow\(event\.currentTarget\.value\)/);
  assert.match(panel, /customerRequestRef\.current\?\.abort\(\)/);
  assert.match(panel, /ledgerRequestRef\.current\?\.abort\(\)/);
  assert.match(panel, /signal: controller\.signal/);
  assert.match(panel, /requestWasAborted\(error\)/);
});

test("customer workspace tabs expose complete keyboard semantics", () => {
  const source = readFileSync(path.join(root, "src/components/RadarApp.tsx"), "utf8");
  const panel = source.slice(source.indexOf("function CustomersRewardsPanel"), source.indexOf("function CustomerRewardKpi"));
  assert.match(panel, /role="tablist"/);
  assert.match(panel, /role="tab"/);
  assert.match(panel, /aria-selected=\{activeView === view\}/);
  assert.match(panel, /role="tabpanel"/);
  assert.match(panel, /event\.key === "ArrowRight"/);
  assert.match(panel, /event\.key === "Home"/);
});

test("core safety regression suites remain part of the default test command", () => {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
  assert.match(packageJson.scripts.test ?? "", /tests\/\*\.test/);
  assert.equal(packageJson.scripts["test:guardrails"], "tsx --test tests/regression-guardrails.test.ts");
});

test("production configuration contains no automatic Vercel jobs", () => {
  const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8")) as {
    crons?: unknown[];
  };

  assert.ok(
    !Array.isArray(vercel.crons) || vercel.crons.length === 0,
    "Do not add automatic Vercel cron jobs: they can wake Neon and create charges while the app is unused."
  );
});
