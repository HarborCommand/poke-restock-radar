import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/types/radar";

export const taxLocationInputSchema = z.strictObject({
  id: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(80),
  locationType: z.enum(["primary_store", "local_pickup", "ship_from", "warehouse", "pos_delivery_origin"]),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).default("US"),
  addressLine1: z.string().trim().min(1).max(160),
  addressLine2: z.string().trim().max(160).optional().nullable(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
  postalCode: z.string().trim().min(3).max(16),
  county: z.string().trim().max(100).optional().nullable(),
  active: z.boolean().default(true),
  defaultForPos: z.boolean().default(false),
  defaultForLocalPickup: z.boolean().default(false),
  defaultShipFrom: z.boolean().default(false),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verificationStatus: z.enum(["unverified", "verified", "failed"]).default("unverified")
}).superRefine((value, context) => {
  if (value.country === "US" && !/^\d{5}(?:-\d{4})?$/.test(value.postalCode)) {
    context.addIssue({ code: "custom", path: ["postalCode"], message: "Enter a valid U.S. ZIP code." });
  }
  if (!value.active && (value.defaultForPos || value.defaultForLocalPickup || value.defaultShipFrom)) {
    context.addIssue({ code: "custom", path: ["active"], message: "An inactive location cannot be a default." });
  }
  const effectiveAt = new Date(`${value.effectiveDate}T00:00:00.000Z`);
  if (Number.isNaN(effectiveAt.getTime()) || effectiveAt.toISOString().slice(0, 10) !== value.effectiveDate) {
    context.addIssue({ code: "custom", path: ["effectiveDate"], message: "Enter a valid effective date." });
  }
});

export const taxLocationDeleteSchema = z.strictObject({ id: z.string().cuid(), confirmDeletion: z.literal(true) });

type TaxLocationInput = z.infer<typeof taxLocationInputSchema>;
type Client = Prisma.TransactionClient | typeof prisma;
type Role = "pos" | "local_pickup" | "ship_from";

function toDto(location: {
  id: string; name: string; locationType: string; country: string; addressLine1: string; addressLine2: string | null;
  city: string; state: string; postalCode: string; county: string | null; active: boolean; defaultForPos: boolean;
  defaultForLocalPickup: boolean; defaultShipFrom: boolean; effectiveAt: Date; verificationStatus: string;
  verifiedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    ...location,
    effectiveDate: location.effectiveAt.toISOString().slice(0, 10),
    verifiedAt: location.verifiedAt?.toISOString() ?? null,
    createdAt: location.createdAt.toISOString(),
    updatedAt: location.updatedAt.toISOString()
  };
}

function values(input: TaxLocationInput) {
  return {
    name: input.name,
    locationType: input.locationType,
    country: input.country,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 || null,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    county: input.county || null,
    active: input.active,
    defaultForPos: input.defaultForPos,
    defaultForLocalPickup: input.defaultForLocalPickup,
    defaultShipFrom: input.defaultShipFrom,
    effectiveAt: new Date(`${input.effectiveDate}T00:00:00.000Z`),
    verificationStatus: input.verificationStatus,
    verifiedAt: input.verificationStatus === "verified" ? new Date() : null
  };
}

async function clearOtherDefaults(tx: Prisma.TransactionClient, userId: string, locationId: string | null, input: TaxLocationInput) {
  if (input.defaultForPos) await tx.taxLocation.updateMany({ where: { userId, id: locationId ? { not: locationId } : undefined }, data: { defaultForPos: false } });
  if (input.defaultForLocalPickup) await tx.taxLocation.updateMany({ where: { userId, id: locationId ? { not: locationId } : undefined }, data: { defaultForLocalPickup: false } });
  if (input.defaultShipFrom) await tx.taxLocation.updateMany({ where: { userId, id: locationId ? { not: locationId } : undefined }, data: { defaultShipFrom: false } });
}

export async function listTaxLocations(userId: string) {
  const locations = await prisma.taxLocation.findMany({ where: { userId }, orderBy: [{ active: "desc" }, { name: "asc" }] });
  return { locations: locations.map(toDto) };
}

export async function saveTaxLocation(user: SessionUser, rawInput: unknown, requestId: string) {
  const input = taxLocationInputSchema.parse(rawInput);
  return prisma.$transaction(async (tx) => {
    const existing = input.id ? await tx.taxLocation.findFirst({ where: { id: input.id, userId: user.id } }) : null;
    if (input.id && !existing) throw new Error("Tax location not found in this workspace.");
    await clearOtherDefaults(tx, user.id, input.id ?? null, input);
    const location = existing
      ? await tx.taxLocation.update({ where: { id: existing.id }, data: values(input) })
      : await tx.taxLocation.create({ data: { userId: user.id, ...values(input) } });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        actorEmail: user.email,
        action: existing ? "tax.location.updated" : "tax.location.created",
        entityType: "TAX_LOCATION",
        entityId: location.id,
        summary: existing ? "Tax location updated." : "Tax location created.",
        metadata: JSON.stringify({ requestId, locationType: location.locationType, active: location.active, defaultForPos: location.defaultForPos, defaultForLocalPickup: location.defaultForLocalPickup, defaultShipFrom: location.defaultShipFrom, verificationStatus: location.verificationStatus })
      }
    });
    return toDto(location);
  });
}

export async function deleteTaxLocation(user: SessionUser, rawInput: unknown, requestId: string) {
  const input = taxLocationDeleteSchema.parse(rawInput);
  return prisma.$transaction(async (tx) => {
    const location = await tx.taxLocation.findFirst({ where: { id: input.id, userId: user.id } });
    if (!location) throw new Error("Tax location not found in this workspace.");
    await tx.taxLocation.delete({ where: { id: location.id } });
    await tx.auditLog.create({
      data: {
        userId: user.id,
        actorEmail: user.email,
        action: "tax.location.deleted",
        entityType: "TAX_LOCATION",
        entityId: location.id,
        summary: "Tax location deleted after explicit confirmation.",
        metadata: JSON.stringify({ requestId, locationType: location.locationType, wasDefault: location.defaultForPos || location.defaultForLocalPickup || location.defaultShipFrom })
      }
    });
    return { deleted: true };
  });
}

export async function resolveTaxLocation(userId: string, role: Role, client: Client = prisma) {
  const field = role === "pos" ? "defaultForPos" : role === "local_pickup" ? "defaultForLocalPickup" : "defaultShipFrom";
  return client.taxLocation.findFirst({
    where: { userId, active: true, verificationStatus: "verified", [field]: true },
    orderBy: [{ effectiveAt: "desc" }, { updatedAt: "desc" }]
  });
}

export function taxLocationSnapshot(location: { id: string; name: string; locationType: string; country: string; addressLine1: string; addressLine2: string | null; city: string; state: string; postalCode: string; county: string | null; verificationStatus: string } | null) {
  if (!location) return { id: null, name: null, json: null };
  return {
    id: location.id,
    name: location.name,
    json: JSON.stringify({ name: location.name, locationType: location.locationType, country: location.country, addressLine1: location.addressLine1, addressLine2: location.addressLine2, city: location.city, state: location.state, postalCode: location.postalCode, county: location.county, verificationStatus: location.verificationStatus })
  };
}

export function taxLocationAddress(location: { country: string; addressLine1: string; addressLine2: string | null; city: string; state: string; postalCode: string }) {
  return { line1: location.addressLine1, line2: location.addressLine2, city: location.city, state: location.state, postalCode: location.postalCode, country: location.country };
}
