import { safeApiError, safeMutationError } from "@/lib/http";

function checkoutErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.toLowerCase() : "";
}

export function storefrontCheckoutErrorResponse(error: unknown, requestId: string) {
  const message = checkoutErrorMessage(error);

  if ((/(?:address|postal|zip)/.test(message) && /(?:required|requires|missing|incomplete)/.test(message)) || /enter zip/.test(message)) {
    return safeApiError("CHECKOUT_ADDRESS_REQUIRED", "Complete the delivery address before continuing.", 422, requestId);
  }
  if (/local pickup.*(?:tax policy|not available)|unsupported.*location/.test(message)) {
    return safeApiError("TAX_LOCATION_UNSUPPORTED", "Checkout tax is not available for that pickup or delivery location.", 422, requestId);
  }
  if (/tax code|automatic.?tax.*(?:unavailable|disabled)|stripe tax.*(?:not ready|unavailable)/.test(message)) {
    return safeApiError("AUTOMATIC_TAX_UNAVAILABLE", "Automatic tax is temporarily unavailable. No payment was created.", 503, requestId, true);
  }
  if (/stripe tax|tax calculation|tax location|jurisdiction/.test(message)) {
    return safeApiError("TAX_CALCULATION_FAILED", "Tax could not be calculated for this checkout. No payment was created.", 422, requestId, true);
  }
  if (/stripe checkout/.test(message) || (error && typeof error === "object" && "type" in error && String((error as { type?: unknown }).type).startsWith("Stripe"))) {
    return safeApiError("CHECKOUT_PROVIDER_UNAVAILABLE", "Secure checkout is temporarily unavailable. No payment was created.", 503, requestId, true);
  }

  return safeMutationError(error, requestId, "Checkout could not start. No payment was created.");
}
