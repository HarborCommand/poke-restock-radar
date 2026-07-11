import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(path.join(root, "src/components/RadarApp.tsx"), "utf8");
const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");

test("shared admin workspace heading is semantic and exposes summary data", () => {
  assert.match(app, /<header className="section-intro admin-workspace-heading">/);
  assert.match(app, /<dl className="section-intro-stats"/);
  assert.match(app, /<dd>\{stat\.value\}<\/dd>/);
  assert.match(app, /<dt>\{stat\.label\}<\/dt>/);
});

test("loading and empty states announce progress accessibly", () => {
  assert.match(app, /aria-busy="true"/);
  assert.match(app, /role="status" aria-live="polite"/);
  assert.match(app, /aria-busy=\{loading \|\| undefined\}/);
  assert.match(app, /aria-hidden="true"/);
});

test("shared admin states remain responsive and keyboard visible", () => {
  assert.match(css, /Shared admin workspace polish/);
  assert.match(css, /\.primary-action[\s\S]*:focus-visible/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*section-intro-stats/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*section-intro-stats/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("admin workspace polish does not alter business actions", () => {
  const sharedPolish = css.slice(css.indexOf("/* Shared admin workspace polish */"));
  assert.doesNotMatch(sharedPolish, /checkout|stripe|reward.*points|inventory.*quantity/i);
  assert.match(app, /const runAction: ActionHandler/);
  assert.match(app, /const submit: SubmitHandler/);
});
