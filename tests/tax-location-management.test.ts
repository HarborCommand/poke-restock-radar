import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "../src/types/radar";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbDir = mkdtempSync(path.join(tmpdir(), "gdg-tax-location-"));
const dbPath = path.join(dbDir, "location.sqlite");
process.env.DATABASE_URL = `file:${dbPath}`;
execFileSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "prisma/init-sqlite.ts"], { cwd: root, env: { ...process.env, DATABASE_URL: `file:${dbPath}` }, stdio: "pipe" });

const dbModule = await import(pathToFileURL(path.join(root, "src/lib/db.ts")).href);
const locationModule = await import(pathToFileURL(path.join(root, "src/lib/tax-location.ts")).href);
const { prisma } = dbModule as { prisma: PrismaClient };
const { listTaxLocations, saveTaxLocation, deleteTaxLocation, resolveTaxLocation, taxLocationSnapshot, taxLocationInputSchema } = locationModule as typeof import("../src/lib/tax-location");

const actor = (id: string, email: string): SessionUser => ({ id, email, name: "Tax Admin", role: "ADMIN", canAddSightings: true, canAddComps: true, canRunChecks: true, canReceivePushAlerts: true });
const input = (name: string, extras: Record<string, unknown> = {}) => ({ name, locationType: "primary_store", country: "US", addressLine1: "100 Test Way", addressLine2: "", city: "Orlando", state: "FL", postalCode: "32801", county: "Orange", active: true, defaultForPos: true, defaultForLocalPickup: false, defaultShipFrom: false, effectiveDate: "2026-07-16", verificationStatus: "verified", ...extras });

let owner: SessionUser;
let other: SessionUser;

test.before(async () => {
  const first = await prisma.user.create({ data: { email: "location-owner@example.test", name: "Owner", role: "ADMIN", passwordHash: "test" } });
  const second = await prisma.user.create({ data: { email: "location-other@example.test", name: "Other", role: "ADMIN", passwordHash: "test" } });
  owner = actor(first.id, first.email); other = actor(second.id, second.email);
});

test.after(async () => { await prisma.$disconnect(); rmSync(dbDir, { recursive: true, force: true }); });

test("default location selection is scoped, singular, and GET-style listing writes nothing", async () => {
  const first = await saveTaxLocation(owner, input("Primary store"), "req-location-1");
  const second = await saveTaxLocation(owner, input("Replacement store", { locationType: "local_pickup", defaultForLocalPickup: true }), "req-location-2");
  assert.equal((await resolveTaxLocation(owner.id, "pos"))?.id, second.id);
  assert.equal((await resolveTaxLocation(owner.id, "local_pickup"))?.id, second.id);
  assert.equal(await prisma.taxLocation.count({ where: { userId: owner.id, defaultForPos: true } }), 1);
  assert.equal(await prisma.taxLocation.findUniqueOrThrow({ where: { id: first.id } }).then((value) => value.defaultForPos), false);
  const auditCount = await prisma.auditLog.count();
  const listed = await listTaxLocations(owner.id);
  assert.equal(listed.locations.length, 2);
  assert.equal(await prisma.auditLog.count(), auditCount);
});

test("cross-workspace IDs and invalid U.S. addresses are rejected", async () => {
  const location = await prisma.taxLocation.findFirstOrThrow({ where: { userId: owner.id } });
  await assert.rejects(saveTaxLocation(other, input("Spoofed", { id: location.id }), "req-cross"), /not found in this workspace/i);
  assert.throws(() => taxLocationInputSchema.parse(input("Bad ZIP", { postalCode: "not-a-zip" })), /valid U\.S\. ZIP/i);
  assert.throws(() => taxLocationInputSchema.parse({ ...input("Unknown"), browserRate: 0.07 }), /Unrecognized key/i);
});

test("historical transaction location snapshot remains immutable after location edits and deletion", async () => {
  const location = await prisma.taxLocation.findFirstOrThrow({ where: { userId: owner.id, defaultForPos: true } });
  const snapshot = taxLocationSnapshot(location);
  const item = await prisma.inventoryItem.create({ data: { userId: owner.id, itemType: "SEALED", itemName: "Snapshot item", cost: 10, quantity: 1, source: "test", purchasedAt: new Date() } });
  const sale = await prisma.inventorySale.create({ data: { userId: owner.id, inventoryItemId: item.id, quantitySold: 1, soldPricePerItem: 20, grossSale: 20, platform: "pos", netSale: 20, costBasis: 10, profitLoss: 10, soldAt: new Date(), taxLocationId: snapshot.id, taxLocationNameSnapshot: snapshot.name, taxLocationSnapshotJson: snapshot.json } });
  await saveTaxLocation(owner, input("Renamed store", { id: location.id, addressLine1: "200 Changed Way" }), "req-edit");
  const persisted = await prisma.inventorySale.findUniqueOrThrow({ where: { id: sale.id } });
  assert.equal(persisted.taxLocationNameSnapshot, snapshot.name);
  assert.equal(persisted.taxLocationSnapshotJson, snapshot.json);
  await deleteTaxLocation(owner, { id: location.id, confirmDeletion: true }, "req-delete");
  assert.equal((await prisma.inventorySale.findUniqueOrThrow({ where: { id: sale.id } })).taxLocationSnapshotJson, snapshot.json);
});

test("route and UI keep locations private, admin-only, audited, and cashier-simple", () => {
  const route = readFileSync(path.join(root, "src/app/api/radar/tax-locations/route.ts"), "utf8");
  const service = readFileSync(path.join(root, "src/lib/tax-location.ts"), "utf8");
  const ui = readFileSync(path.join(root, "src/components/TaxLocationsWorkspace.tsx"), "utf8");
  const pos = readFileSync(path.join(root, "src/components/RadarApp.tsx"), "utf8");
  for (const requirement of [/requireUser/, /requireAdmin/, /authorizeAdminMutation/, /privateOk/, /withPrivateNoStore/]) assert.match(route, requirement);
  assert.match(service, /userId: user\.id/);
  assert.match(service, /tax\.location\.(created|updated)/);
  assert.doesNotMatch(service, /metadata: JSON\.stringify\([^)]*addressLine1/);
  assert.match(ui, /Tax Locations/);
  assert.match(ui, /Default for POS/);
  assert.match(ui, /Default for Local Pickup/);
  assert.match(pos, /Location: \{taxQuote\.locationName\}/);
  assert.doesNotMatch(pos.slice(pos.indexOf("function PosPanel"), pos.indexOf("function PosReceipt")), /tax rate input|county rate/i);
});

test("migration is additive and stores private location snapshots without rewriting history", () => {
  const migration = readFileSync(path.join(root, "prisma/migrations/20260716023000_tax_location_management/migration.sql"), "utf8");
  assert.match(migration, /CREATE TABLE "TaxLocation"/);
  assert.match(migration, /FOREIGN KEY \("userId"\) REFERENCES "User"/);
  assert.match(migration, /taxLocationSnapshotJson/);
  assert.doesNotMatch(migration, /UPDATE "(?:InventorySale|StorefrontOrder)"/);
});
