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
import {
  assertCustomerSameOriginRequest,
  CustomerAuthOriginError,
  customerAuthOriginErrorResponse
} from "@/lib/customer-auth-rate-limit";
import { badRequest, privateJson, privateOk, readJson, withPrivateNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectToAddresses(request: Request, status: string) {
  const url = new URL("/account/addresses", request.url);
  url.searchParams.set("addressStatus", status);
  return withPrivateNoStore(NextResponse.redirect(url, { status: 303 }));
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
  const redirect = !contentType.includes("application/json");
  let input: Awaited<ReturnType<typeof formAction>> | Awaited<ReturnType<typeof jsonAction>> | null = null;

  try {
    assertCustomerSameOriginRequest(request);
    input = contentType.includes("application/json") ? await jsonAction(request) : await formAction(request);
    if (!customerAccountsEnabled()) {
      return input.redirect
        ? redirectToAddresses(request, "disabled")
        : privateJson({ error: "Customer accounts are not enabled yet." }, 404);
    }

    const account = await currentCustomerAccount();
    if (!account) {
      return input.redirect
        ? withPrivateNoStore(NextResponse.redirect(new URL("/account/login", request.url), { status: 303 }))
        : privateJson({ error: "Sign in required." }, 401);
    }

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
    if (input?.redirect) return redirectToAddresses(request, "error");
    const response = badRequest(error);
    return withPrivateNoStore(response);
  }
}
