import { prisma } from "@/lib/db";
import { createStore } from "@/lib/radar-service";
import type { StoreDiscoveryCandidateDTO, StoreDiscoveryResponseDTO, StoreDTO, Zone } from "@/types/radar";

const GOOGLE_PLACES_NEARBY_MAX_METERS = 50000;
const METERS_PER_MILE = 1609.344;

type StoreDiscoverySearchInput = {
  locationQuery?: string;
  latitude?: number;
  longitude?: number;
  radiusMiles: number;
  retailers: Array<"Target" | "Walmart" | "GameStop" | "Best Buy">;
};

type GoogleGeocodeResult = {
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
};

type GoogleGeocodeResponse = {
  status: string;
  results?: GoogleGeocodeResult[];
  error_message?: string;
};

type GooglePlaceSearchResult = {
  name?: string;
  place_id?: string;
  vicinity?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
};

type GoogleNearbyResponse = {
  status: string;
  results?: GooglePlaceSearchResult[];
  error_message?: string;
};

type GoogleAddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

type GooglePlaceDetailsResult = {
  name?: string;
  formatted_address?: string;
  formatted_phone_number?: string;
  place_id?: string;
  url?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  address_components?: GoogleAddressComponent[];
};

type GooglePlaceDetailsResponse = {
  status: string;
  result?: GooglePlaceDetailsResult;
  error_message?: string;
};

type ExistingStore = {
  id: string;
  retailerId: string;
  storeName: string;
  address: string;
  city: string;
  notes: string | null;
  vendorNotes: string | null;
  retailer: { name: string };
};

function googlePlacesKey() {
  return process.env.GOOGLE_PLACES_API_KEY?.trim() || "";
}

export function googlePlacesConfigured() {
  return googlePlacesKey().length > 0;
}

function normalize(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cityToZone(city: string): Zone {
  const normalized = normalize(city);
  if (normalized.includes("fort lauderdale") || normalized.includes("plantation") || normalized.includes("sunrise")) {
    return "FORT_LAUDERDALE";
  }
  if (normalized.includes("orlando")) return "ORLANDO";
  if (normalized.includes("tampa")) return "TAMPA";
  if (normalized.includes("jacksonville")) return "JACKSONVILLE";
  return "MIAMI";
}

function distanceMilesBetween(
  from: { latitude?: number | null; longitude?: number | null },
  to: { latitude?: number | null; longitude?: number | null }
) {
  if (
    from.latitude === null ||
    from.latitude === undefined ||
    from.longitude === null ||
    from.longitude === undefined ||
    to.latitude === null ||
    to.latitude === undefined ||
    to.longitude === null ||
    to.longitude === undefined
  ) {
    return null;
  }
  const radians = Math.PI / 180;
  const dLat = (to.latitude - from.latitude) * radians;
  const dLon = (to.longitude - from.longitude) * radians;
  const lat1 = from.latitude * radians;
  const lat2 = to.latitude * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function component(result: GooglePlaceDetailsResult, type: string, short = false) {
  const item = result.address_components?.find((part) => part.types.includes(type));
  return short ? item?.short_name : item?.long_name;
}

function parseAddress(result: GooglePlaceDetailsResult, fallbackAddress: string | undefined) {
  const streetNumber = component(result, "street_number");
  const route = component(result, "route");
  const address = [streetNumber, route].filter(Boolean).join(" ").trim() || fallbackAddress || result.formatted_address || "";
  const city =
    component(result, "locality") ||
    component(result, "postal_town") ||
    component(result, "sublocality") ||
    component(result, "administrative_area_level_3") ||
    "";
  const state = component(result, "administrative_area_level_1", true) || "";
  const zip = component(result, "postal_code", true) || null;
  return { address, city, state, zip };
}

function duplicateReason(candidate: StoreDiscoveryCandidateDTO, existingStores: ExistingStore[]) {
  const candidateRetailer = normalize(candidate.retailerName);
  const candidateAddress = normalize(candidate.address);
  const candidateNameCity = `${normalize(candidate.storeName)}|${normalize(candidate.city)}`;

  for (const store of existingStores) {
    const sameRetailer = normalize(store.retailer.name) === candidateRetailer;
    if (candidate.placeId && `${store.notes || ""}\n${store.vendorNotes || ""}`.includes(candidate.placeId)) {
      return `Already saved from Google place_id ${candidate.placeId}.`;
    }
    if (sameRetailer && normalize(store.address) === candidateAddress) {
      return `Already saved as ${store.storeName} at this retailer/address.`;
    }
    if (sameRetailer && `${normalize(store.storeName)}|${normalize(store.city)}` === candidateNameCity) {
      return `Already saved as ${store.storeName} in ${store.city}.`;
    }
  }

  return null;
}

function candidateId(retailerName: string, placeId: string | null, address: string, storeName: string) {
  return [retailerName, placeId || normalize(address), normalize(storeName)].join(":");
}

function discoveryManualResponse(input: StoreDiscoverySearchInput, message: string): StoreDiscoveryResponseDTO {
  return {
    mode: "manual",
    configured: false,
    origin: {
      label: input.locationQuery || "Browser location",
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null
    },
    radiusMiles: input.radiusMiles,
    message,
    candidates: []
  };
}

async function geocodeLocation(input: StoreDiscoverySearchInput, key: string) {
  if (input.latitude !== undefined && input.longitude !== undefined) {
    return {
      label: input.locationQuery || "Browser location",
      latitude: input.latitude,
      longitude: input.longitude
    };
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", input.locationQuery || "");
  url.searchParams.set("key", key);
  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json()) as GoogleGeocodeResponse;
  if (!response.ok || data.status !== "OK" || !data.results?.[0]?.geometry?.location) {
    throw new Error(data.error_message || `Google Geocoding returned ${data.status || response.status}`);
  }
  const location = data.results[0].geometry.location;
  return {
    label: data.results[0].formatted_address || input.locationQuery || "Search location",
    latitude: Number(location.lat),
    longitude: Number(location.lng)
  };
}

async function nearbySearch(retailerName: string, origin: { latitude: number; longitude: number }, radiusMiles: number, key: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${origin.latitude},${origin.longitude}`);
  url.searchParams.set("radius", String(Math.min(Math.round(radiusMiles * METERS_PER_MILE), GOOGLE_PLACES_NEARBY_MAX_METERS)));
  url.searchParams.set("keyword", retailerName);
  url.searchParams.set("type", "store");
  url.searchParams.set("key", key);
  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json()) as GoogleNearbyResponse;
  if (!response.ok || !["OK", "ZERO_RESULTS"].includes(data.status)) {
    throw new Error(data.error_message || `Google Places search returned ${data.status || response.status}`);
  }
  return (data.results || []).slice(0, 12);
}

async function placeDetails(result: GooglePlaceSearchResult, key: string) {
  if (!result.place_id) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", result.place_id);
  url.searchParams.set("fields", "name,formatted_address,formatted_phone_number,geometry,place_id,url,address_components");
  url.searchParams.set("key", key);
  const response = await fetch(url, { cache: "no-store" });
  const data = (await response.json()) as GooglePlaceDetailsResponse;
  if (!response.ok || data.status !== "OK" || !data.result) return null;
  return data.result;
}

export async function discoverNearbyStores(input: StoreDiscoverySearchInput): Promise<StoreDiscoveryResponseDTO> {
  const key = googlePlacesKey();
  if (!key) {
    return discoveryManualResponse(
      input,
      "Google Places is not configured. Add stores manually, import CSV/JSON, or paste Google Maps details into the store form."
    );
  }

  const retailers = await prisma.retailer.findMany({
    where: { name: { in: input.retailers } },
    select: { id: true, name: true }
  });
  const retailerByName = new Map(retailers.map((retailer) => [retailer.name, retailer]));
  const existingStores: ExistingStore[] = await prisma.store.findMany({
    include: { retailer: { select: { name: true } } }
  });
  const origin = await geocodeLocation(input, key);
  const candidates: StoreDiscoveryCandidateDTO[] = [];
  const seen = new Set<string>();

  for (const retailerName of input.retailers) {
    const retailer = retailerByName.get(retailerName);
    if (!retailer) continue;
    const results = await nearbySearch(retailerName, origin, input.radiusMiles, key);
    for (const result of results) {
      const details = (await placeDetails(result, key)) || null;
      const location = details?.geometry?.location || result.geometry?.location || {};
      const parsedAddress = parseAddress(details || {}, result.vicinity);
      const candidate: StoreDiscoveryCandidateDTO = {
        id: candidateId(retailer.name, details?.place_id || result.place_id || null, parsedAddress.address, details?.name || result.name || retailer.name),
        retailerId: retailer.id,
        retailerName: retailer.name as StoreDiscoveryCandidateDTO["retailerName"],
        storeName: details?.name || result.name || `${retailer.name} store`,
        address: parsedAddress.address,
        city: parsedAddress.city || origin.label,
        state: parsedAddress.state || "FL",
        zip: parsedAddress.zip,
        latitude: location.lat === undefined ? null : Number(location.lat),
        longitude: location.lng === undefined ? null : Number(location.lng),
        phone: details?.formatted_phone_number || null,
        placeId: details?.place_id || result.place_id || null,
        googleMapsUrl: details?.url || null,
        distanceMiles: distanceMilesBetween(origin, {
          latitude: location.lat === undefined ? null : Number(location.lat),
          longitude: location.lng === undefined ? null : Number(location.lng)
        }),
        duplicate: false,
        duplicateReason: null,
        source: "google_places"
      };
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      const reason = duplicateReason(candidate, existingStores);
      candidates.push({
        ...candidate,
        distanceMiles: candidate.distanceMiles === null ? null : Math.round(candidate.distanceMiles * 10) / 10,
        duplicate: Boolean(reason),
        duplicateReason: reason
      });
    }
  }

  const radiusNote =
    input.radiusMiles > GOOGLE_PLACES_NEARBY_MAX_METERS / METERS_PER_MILE
      ? " Google Places caps nearby radius around 31 miles, so use import/manual entry for wider coverage."
      : "";

  return {
    mode: "google_places",
    configured: true,
    origin,
    radiusMiles: input.radiusMiles,
    message: `Found ${candidates.length} public Google Places candidate stores.${radiusNote}`,
    candidates: candidates.sort((a, b) => Number(a.duplicate) - Number(b.duplicate) || (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999))
  };
}

function defaultRestockDefaults(retailerName: string) {
  switch (retailerName) {
    case "Target":
      return { days: "Tuesday,Friday", window: "8:00 AM - 11:00 AM", confidence: 55 };
    case "Walmart":
      return { days: "Wednesday,Friday", window: "9:30 AM - 12:30 PM", confidence: 45 };
    case "GameStop":
      return { days: "Friday", window: "12:00 PM - 3:00 PM", confidence: 45 };
    case "Best Buy":
      return { days: "Tuesday,Thursday", window: "10:00 AM - 1:00 PM", confidence: 45 };
    default:
      return { days: "Unknown", window: "Unknown", confidence: 40 };
  }
}

function storeNotes(candidate: StoreDiscoveryCandidateDTO) {
  return [
    candidate.phone ? `Phone: ${candidate.phone}` : null,
    candidate.zip ? `ZIP: ${candidate.zip}` : null,
    candidate.placeId ? `Google place_id: ${candidate.placeId}` : null,
    candidate.googleMapsUrl ? `Google Maps: ${candidate.googleMapsUrl}` : null,
    "Discovered from public Google Places/manual store discovery. Confirm local Pokemon TCG aisle behavior manually."
  ]
    .filter(Boolean)
    .join("\n");
}

export async function addDiscoveredStores(candidates: StoreDiscoveryCandidateDTO[]) {
  const existingStores: ExistingStore[] = await prisma.store.findMany({
    include: { retailer: { select: { name: true } } }
  });
  const result = {
    ok: true,
    created: 0,
    skipped: 0,
    errors: [] as string[],
    stores: [] as StoreDTO[]
  };

  for (const candidate of candidates) {
    try {
      const reason = duplicateReason(candidate, existingStores);
      if (reason) {
        result.skipped += 1;
        result.errors.push(`${candidate.storeName}: ${reason}`);
        continue;
      }
      const defaults = defaultRestockDefaults(candidate.retailerName);
      const store = await createStore({
        retailerId: candidate.retailerId,
        storeName: candidate.storeName,
        address: candidate.address,
        city: candidate.city,
        state: candidate.state,
        zone: cityToZone(candidate.city),
        latitude: candidate.latitude ?? undefined,
        longitude: candidate.longitude ?? undefined,
        typicalRestockDays: defaults.days,
        typicalRestockTimeWindow: defaults.window,
        vendorNotes: candidate.placeId ? `Google place_id: ${candidate.placeId}` : "Discovered store; verify vendor timing manually.",
        confidenceScore: defaults.confidence,
        notes: storeNotes(candidate)
      });
      existingStores.push({
        id: store.id,
        retailerId: store.retailerId,
        storeName: store.storeName,
        address: store.address,
        city: store.city,
        notes: store.notes,
        vendorNotes: store.vendorNotes,
        retailer: { name: store.retailerName }
      });
      result.stores.push(store);
      result.created += 1;
    } catch (error) {
      result.errors.push(`${candidate.storeName}: ${error instanceof Error ? error.message : "Could not add store"}`);
    }
  }

  return result;
}
