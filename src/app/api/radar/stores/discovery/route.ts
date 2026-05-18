import { requireUser } from "@/lib/auth";
import { badRequest, ok, readJson } from "@/lib/http";
import { discoverNearbyStores, googlePlacesConfigured } from "@/lib/store-discovery";
import { storeDiscoverySearchSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireUser();
  if (response) return response;
  return ok({
    configured: googlePlacesConfigured(),
    mode: googlePlacesConfigured() ? "google_places" : "manual",
    message: googlePlacesConfigured()
      ? "Google Places is configured for public nearby store discovery."
      : "Google Places is not configured. Manual entry and CSV/JSON import are available."
  });
}

export async function POST(request: Request) {
  const { response } = await requireUser();
  if (response) return response;

  try {
    const input = storeDiscoverySearchSchema.parse(await readJson(request));
    return ok(await discoverNearbyStores(input));
  } catch (error) {
    return badRequest(error);
  }
}
