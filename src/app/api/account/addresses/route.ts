import { NextResponse } from "next/server";
import { z } from "zod";
import {
  currentCustomerAccount,
  customerAccountsEnabled
} from "@/lib/customer-account-auth";
import {
  createCustomerSavedAddress,
  deleteCustomerSavedAddress,
  setDefaultCustomerSavedAddress,
  updateCustomerSavedAddress
} from "@/lib/customer-addresses";
import {
  assertCustomerSameOriginRequest,
  CustomerAuthOriginError,
  customerAuthOriginErrorResponse
} from "@/lib/customer-auth-rate-limit";
import { badRequest, privateJson, privateOk, readJson, withPrivateNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addressActionSchema = z.object({
  action: z.enum(["create", "update", "delete", "default"]).default("create"),
  addressId: z.string().trim().max(128).optional().default(""),
  name: z.string().trim().max(80).nullable().optional(),
  street1: z.string().trim().max(160).optional().default(""),
  street2: z.string().trim().max(160).nullable().optional(),
  city: z.string().trim().max(100).optional().default(""),
  state: z.string().trim().max(32).optional().default(""),
  zip: z.string().trim().max(10).optional().default(""),
  country: z.string().trim().max(2).optional().default("US"),
  isDefault: z.union([z.boolean(), z.enum(["on", "true", "false", ""])]).optional().transform((value) => value === true || value === "on" || value === "true")
}).strict().superRefine((input, context) => {
  if (input.action !== "create" && !input.addressId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["addressId"], message: "Saved address was not found." });
  }
});

function parsedAddressAction(raw: unknown, redirect: boolean) {
  const input = addressActionSchema.parse(raw);
  return {
    redirect,
    action: input.action,
    addressId: input.addressId,
    input: {
      name: input.name ?? null,
      street1: input.street1,
      street2: input.street2 ?? null,
      city: input.city,
      state: input.state,
      zip: input.zip,
      country: input.country,
      isDefault: input.isDefault
    }
  };
}

function redirectToAddresses(request: Request, status: string) {
  const url = new URL("/account/addresses", request.url);
  url.searchParams.set("addressStatus", status);
  return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
}

async function formAction(request: Request) {
  const form = await request.formData();
  const raw = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
  return parsedAddressAction(raw, true);
}

async function jsonAction(request: Request) {
  return parsedAddressAction(await readJson(request), false);
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const redirect = !contentType.includes("application/json");

  try {
    assertCustomerSameOriginRequest(request);
    if (!customerAccountsEnabled()) {
      return redirect
        ? redirectToAddresses(request, "disabled")
        : privateJson({ error: "Customer accounts are not enabled yet." }, 404);
    }

    const account = await currentCustomerAccount();
    if (!account) {
      return redirect
        ? withPrivateNoStore(NextResponse.redirect(new URL("/account/login", request.url), { status: 303 }))
        : privateJson({ error: "Sign in required." }, 401);
    }

    const input = contentType.includes("application/json") ? await jsonAction(request) : await formAction(request);

    if (input.action === "delete") {
      await deleteCustomerSavedAddress(account, input.addressId);
      return input.redirect ? redirectToAddresses(request, "deleted") : privateOk({ ok: true, status: "deleted" });
    }

    if (input.action === "default") {
      await setDefaultCustomerSavedAddress(account, input.addressId);
      return input.redirect ? redirectToAddresses(request, "default") : privateOk({ ok: true, status: "default" });
    }

    if (input.action === "update") {
      await updateCustomerSavedAddress(account, input.addressId, input.input);
      return input.redirect ? redirectToAddresses(request, "updated") : privateOk({ ok: true, status: "updated" });
    }

    await createCustomerSavedAddress(account, input.input);
    return input.redirect ? redirectToAddresses(request, "created") : privateOk({ ok: true, status: "created" }, 201);
  } catch (error) {
    if (error instanceof CustomerAuthOriginError) {
      return redirect ? redirectToAddresses(request, "error") : customerAuthOriginErrorResponse();
    }
    if (redirect) return redirectToAddresses(request, "error");
    const response = badRequest(error);
    return withPrivateNoStore(response);
  }
}
