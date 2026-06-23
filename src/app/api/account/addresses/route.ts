import { NextResponse } from "next/server";
import {
  currentCustomerAccount,
  customerAccountsEnabled
} from "@/lib/customer-account-auth";
import {
  createCustomerSavedAddress,
  customerSavedAddressInputFromForm,
  deleteCustomerSavedAddress,
  setDefaultCustomerSavedAddress,
  updateCustomerSavedAddress
} from "@/lib/customer-addresses";
import { badRequest, ok, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectToAddresses(request: Request, status: string) {
  const url = new URL("/account/addresses", request.url);
  url.searchParams.set("addressStatus", status);
  return NextResponse.redirect(url, { status: 303 });
}

async function formAction(request: Request) {
  const form = await request.formData();
  return {
    redirect: true,
    action: String(form.get("action") || "create"),
    addressId: String(form.get("addressId") || ""),
    input: customerSavedAddressInputFromForm(form)
  };
}

async function jsonAction(request: Request) {
  const json = await readJson(request);
  return {
    redirect: false,
    action: typeof json.action === "string" ? json.action : "create",
    addressId: typeof json.addressId === "string" ? json.addressId : "",
    input: {
      name: typeof json.name === "string" ? json.name : null,
      street1: typeof json.street1 === "string" ? json.street1 : "",
      street2: typeof json.street2 === "string" ? json.street2 : null,
      city: typeof json.city === "string" ? json.city : "",
      state: typeof json.state === "string" ? json.state : "",
      zip: typeof json.zip === "string" ? json.zip : "",
      country: typeof json.country === "string" ? json.country : "US",
      isDefault: Boolean(json.isDefault)
    }
  };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const input = contentType.includes("application/json") ? await jsonAction(request) : await formAction(request);

  try {
    if (!customerAccountsEnabled()) {
      return input.redirect
        ? redirectToAddresses(request, "disabled")
        : NextResponse.json({ error: "Customer accounts are not enabled yet." }, { status: 404 });
    }

    const account = await currentCustomerAccount();
    if (!account) {
      return input.redirect
        ? NextResponse.redirect(new URL("/account/login", request.url), { status: 303 })
        : NextResponse.json({ error: "Sign in required." }, { status: 401 });
    }

    if (input.action === "delete") {
      await deleteCustomerSavedAddress(account, input.addressId);
      return input.redirect ? redirectToAddresses(request, "deleted") : ok({ ok: true, status: "deleted" });
    }

    if (input.action === "default") {
      await setDefaultCustomerSavedAddress(account, input.addressId);
      return input.redirect ? redirectToAddresses(request, "default") : ok({ ok: true, status: "default" });
    }

    if (input.action === "update") {
      await updateCustomerSavedAddress(account, input.addressId, input.input);
      return input.redirect ? redirectToAddresses(request, "updated") : ok({ ok: true, status: "updated" });
    }

    await createCustomerSavedAddress(account, input.input);
    return input.redirect ? redirectToAddresses(request, "created") : ok({ ok: true, status: "created" }, 201);
  } catch (error) {
    return input.redirect ? redirectToAddresses(request, "error") : badRequest(error);
  }
}
