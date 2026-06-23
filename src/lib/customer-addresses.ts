import { prisma } from "@/lib/db";
import type { CurrentCustomerAccount } from "@/lib/customer-account-auth";

export type CustomerSavedAddressInput = {
  name?: string | null;
  street1: string;
  street2?: string | null;
  city: string;
  state: string;
  zip: string;
  country?: string | null;
  isDefault?: boolean;
};

function cleanOptional(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length ? text : null;
}

function cleanRequired(value: unknown, field: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function normalizeZip(value: string) {
  const zip = value.trim();
  if (!/^\d{5}(?:-\d{4})?$/.test(zip)) throw new Error("Enter a valid ZIP code.");
  return zip;
}

function normalizeState(value: string) {
  const state = value.trim().toUpperCase();
  if (!state) throw new Error("State is required.");
  if (state.length > 32) throw new Error("State is too long.");
  return state;
}

function normalizeCountry(value: string | null | undefined) {
  const country = value?.trim().toUpperCase() || "US";
  if (!/^[A-Z]{2}$/.test(country)) throw new Error("Enter a valid country code.");
  return country;
}

export function normalizeCustomerSavedAddressInput(input: CustomerSavedAddressInput) {
  return {
    name: cleanOptional(input.name),
    street1: cleanRequired(input.street1, "Street address"),
    street2: cleanOptional(input.street2),
    city: cleanRequired(input.city, "City"),
    state: normalizeState(input.state),
    zip: normalizeZip(input.zip),
    country: normalizeCountry(input.country),
    isDefault: Boolean(input.isDefault)
  };
}

export function customerSavedAddressInputFromForm(form: FormData): CustomerSavedAddressInput {
  return {
    name: cleanOptional(form.get("name")),
    street1: String(form.get("street1") || ""),
    street2: cleanOptional(form.get("street2")),
    city: String(form.get("city") || ""),
    state: String(form.get("state") || ""),
    zip: String(form.get("zip") || ""),
    country: cleanOptional(form.get("country")) || "US",
    isDefault: form.get("isDefault") === "on" || form.get("isDefault") === "true"
  };
}

export async function createCustomerSavedAddress(account: CurrentCustomerAccount, input: CustomerSavedAddressInput) {
  const data = normalizeCustomerSavedAddressInput(input);
  const existingCount = await prisma.customerSavedAddress.count({
    where: { customerAccountId: account.id }
  });
  const shouldBeDefault = data.isDefault || existingCount === 0;

  return prisma.$transaction(async (tx) => {
    if (shouldBeDefault) {
      await tx.customerSavedAddress.updateMany({
        where: { customerAccountId: account.id },
        data: { isDefault: false }
      });
    }

    return tx.customerSavedAddress.create({
      data: {
        customerAccountId: account.id,
        ...data,
        isDefault: shouldBeDefault
      }
    });
  });
}

export async function updateCustomerSavedAddress(
  account: CurrentCustomerAccount,
  addressId: string,
  input: CustomerSavedAddressInput
) {
  const data = normalizeCustomerSavedAddressInput(input);

  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.customerSavedAddress.updateMany({
        where: { customerAccountId: account.id },
        data: { isDefault: false }
      });
    }

    const result = await tx.customerSavedAddress.updateMany({
      where: { id: addressId, customerAccountId: account.id },
      data
    });
    if (result.count !== 1) throw new Error("Saved address was not found.");

    return tx.customerSavedAddress.findFirstOrThrow({
      where: { id: addressId, customerAccountId: account.id }
    });
  });
}

export async function deleteCustomerSavedAddress(account: CurrentCustomerAccount, addressId: string) {
  const result = await prisma.customerSavedAddress.deleteMany({
    where: { id: addressId, customerAccountId: account.id }
  });
  if (result.count !== 1) throw new Error("Saved address was not found.");
  return { deleted: true };
}

export async function setDefaultCustomerSavedAddress(account: CurrentCustomerAccount, addressId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customerSavedAddress.findFirst({
      where: { id: addressId, customerAccountId: account.id },
      select: { id: true }
    });
    if (!existing) throw new Error("Saved address was not found.");

    await tx.customerSavedAddress.updateMany({
      where: { customerAccountId: account.id },
      data: { isDefault: false }
    });
    await tx.customerSavedAddress.updateMany({
      where: { id: addressId, customerAccountId: account.id },
      data: { isDefault: true }
    });
    return { updated: true };
  });
}
