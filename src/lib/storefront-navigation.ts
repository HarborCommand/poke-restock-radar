import { headers } from "next/headers";
import { isGameDayGrabsHost } from "@/lib/storefront-routing";

export async function getStorefrontHomeHref() {
  const requestHeaders = await headers();
  return isGameDayGrabsHost(requestHeaders.get("host")) ? "/" : "/shop";
}
