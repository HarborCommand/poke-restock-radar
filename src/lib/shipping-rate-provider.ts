export type ShippingRateProviderEnv = Pick<NodeJS.ProcessEnv, string>;

export type ShippingRateProviderConfig = {
  calculatedUspsEnabled: boolean;
  provider: "shippo" | "none";
  shippoConfigured: boolean;
  shipFromZipConfigured: boolean;
  shipFromConfigured: boolean;
  fallbackEnabled: boolean;
  quoteTtlMinutes: number;
  envVars: string[];
};

export type ShippingRatePackage = {
  weightOz: number;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  profileKey: string;
};

export type ShippingRateDestination = {
  zip: string;
  state?: string | null;
  country?: string | null;
};

export type NormalizedShippingQuote = {
  provider: "shippo" | "internal_profile";
  carrier: "USPS" | "STANDARD";
  service: string;
  amountCents: number;
  currency: "USD";
  estimatedDays: number | null;
  rateProviderRef: string | null;
  shipmentProviderRef: string | null;
  expiresAt: Date;
  fallbackUsed: boolean;
  warning: string | null;
};

type ShippoRate = {
  object_id?: string;
  provider?: string;
  provider_image_75?: string;
  servicelevel?: {
    name?: string;
    token?: string;
  };
  amount?: string;
  currency?: string;
  estimated_days?: number | string | null;
};

type ShippoShipmentResponse = {
  object_id?: string;
  rates?: ShippoRate[];
};

const shippoEndpoint = "https://api.goshippo.com/shipments/";
const shippingEnvVars = [
  "CALCULATED_USPS_SHIPPING_ENABLED",
  "SHIPPING_RATE_PROVIDER",
  "SHIPPO_API_TOKEN",
  "SHIP_FROM_NAME",
  "SHIP_FROM_STREET1",
  "SHIP_FROM_STREET2",
  "SHIP_FROM_CITY",
  "SHIP_FROM_STATE",
  "SHIP_FROM_ZIP",
  "SHIP_FROM_COUNTRY",
  "SHIPPING_FALLBACK_ENABLED",
  "SHIPPING_QUOTE_TTL_MINUTES"
];

function envValue(env: ShippingRateProviderEnv, name: string) {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function envFlag(env: ShippingRateProviderEnv, name: string, defaultValue = false) {
  const value = envValue(env, name);
  if (value === null) return defaultValue;
  return value.toLowerCase() === "true";
}

function configuredProvider(env: ShippingRateProviderEnv): "shippo" | "none" {
  const provider = (envValue(env, "SHIPPING_RATE_PROVIDER") || "shippo").toLowerCase();
  return provider === "shippo" ? "shippo" : "none";
}

function quoteTtlMinutes(env: ShippingRateProviderEnv) {
  const configured = Number(envValue(env, "SHIPPING_QUOTE_TTL_MINUTES") || 30);
  return Number.isFinite(configured) ? Math.max(5, Math.min(120, Math.floor(configured))) : 30;
}

export function shippingRateProviderConfig(env: ShippingRateProviderEnv = process.env): ShippingRateProviderConfig {
  const provider = configuredProvider(env);
  const shippoTokenConfigured = Boolean(envValue(env, "SHIPPO_API_TOKEN"));
  const shipFromZipConfigured = Boolean(envValue(env, "SHIP_FROM_ZIP"));
  const shipFromConfigured = Boolean(
    envValue(env, "SHIP_FROM_NAME") &&
      envValue(env, "SHIP_FROM_STREET1") &&
      envValue(env, "SHIP_FROM_CITY") &&
      envValue(env, "SHIP_FROM_STATE") &&
      shipFromZipConfigured &&
      envValue(env, "SHIP_FROM_COUNTRY")
  );

  return {
    calculatedUspsEnabled: envFlag(env, "CALCULATED_USPS_SHIPPING_ENABLED", false),
    provider,
    shippoConfigured: provider === "shippo" && shippoTokenConfigured && shipFromConfigured,
    shipFromZipConfigured,
    shipFromConfigured,
    fallbackEnabled: envFlag(env, "SHIPPING_FALLBACK_ENABLED", true),
    quoteTtlMinutes: quoteTtlMinutes(env),
    envVars: shippingEnvVars
  };
}

export function shippingQuoteExpiresAt(now = new Date(), env: ShippingRateProviderEnv = process.env) {
  return new Date(now.getTime() + shippingRateProviderConfig(env).quoteTtlMinutes * 60 * 1000);
}

function shippoAddressFrom(env: ShippingRateProviderEnv) {
  return {
    name: envValue(env, "SHIP_FROM_NAME"),
    street1: envValue(env, "SHIP_FROM_STREET1"),
    street2: envValue(env, "SHIP_FROM_STREET2") || undefined,
    city: envValue(env, "SHIP_FROM_CITY"),
    state: envValue(env, "SHIP_FROM_STATE"),
    zip: envValue(env, "SHIP_FROM_ZIP"),
    country: envValue(env, "SHIP_FROM_COUNTRY") || "US"
  };
}

function centsFromShippoAmount(amount: string | undefined) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function shippoEstimatedDays(value: ShippoRate["estimated_days"]) {
  const days = typeof value === "string" ? Number(value) : value;
  return typeof days === "number" && Number.isFinite(days) && days > 0 ? Math.floor(days) : null;
}

function isUspsRate(rate: ShippoRate) {
  return String(rate.provider || "").trim().toUpperCase() === "USPS";
}

function rateServiceName(rate: ShippoRate) {
  return String(rate.servicelevel?.name || rate.servicelevel?.token || "USPS Shipping").trim();
}

function preferGroundAdvantage(left: ShippoRate, right: ShippoRate) {
  const leftGround = /ground advantage/i.test(rateServiceName(left));
  const rightGround = /ground advantage/i.test(rateServiceName(right));
  if (leftGround !== rightGround) return leftGround ? -1 : 1;
  const leftAmount = centsFromShippoAmount(left.amount) ?? Number.POSITIVE_INFINITY;
  const rightAmount = centsFromShippoAmount(right.amount) ?? Number.POSITIVE_INFINITY;
  return leftAmount - rightAmount;
}

export function normalizeShippoUspsQuote(
  shipment: ShippoShipmentResponse,
  options: { now?: Date; env?: ShippingRateProviderEnv } = {}
): NormalizedShippingQuote | null {
  const uspsRate = (shipment.rates || [])
    .filter((rate) => isUspsRate(rate) && String(rate.currency || "").toUpperCase() === "USD" && centsFromShippoAmount(rate.amount) !== null)
    .sort(preferGroundAdvantage)[0];
  if (!uspsRate) return null;
  const amountCents = centsFromShippoAmount(uspsRate.amount);
  if (amountCents === null) return null;
  const service = rateServiceName(uspsRate);
  return {
    provider: "shippo",
    carrier: "USPS",
    service: /ground advantage/i.test(service) ? "USPS Ground Advantage" : service,
    amountCents,
    currency: "USD",
    estimatedDays: shippoEstimatedDays(uspsRate.estimated_days),
    rateProviderRef: uspsRate.object_id || null,
    shipmentProviderRef: shipment.object_id || null,
    expiresAt: shippingQuoteExpiresAt(options.now ?? new Date(), options.env ?? process.env),
    fallbackUsed: false,
    warning: null
  };
}

export async function fetchShippoUspsQuote(
  input: {
    destination: ShippingRateDestination;
    package: ShippingRatePackage;
  },
  options: {
    env?: ShippingRateProviderEnv;
    fetchImpl?: typeof fetch;
    now?: Date;
  } = {}
): Promise<NormalizedShippingQuote | null> {
  const env = options.env ?? process.env;
  const config = shippingRateProviderConfig(env);
  if (!config.calculatedUspsEnabled || config.provider !== "shippo" || !config.shippoConfigured) return null;
  if (!input.package.lengthIn || !input.package.widthIn || !input.package.heightIn || input.package.weightOz <= 0) return null;

  const response = await (options.fetchImpl ?? fetch)(shippoEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `ShippoToken ${envValue(env, "SHIPPO_API_TOKEN") || ""}`
    },
    body: JSON.stringify({
      address_from: shippoAddressFrom(env),
      address_to: {
        name: "GameDayGrabs Customer",
        zip: input.destination.zip,
        state: input.destination.state || undefined,
        country: input.destination.country || "US"
      },
      parcels: [
        {
          length: String(input.package.lengthIn),
          width: String(input.package.widthIn),
          height: String(input.package.heightIn),
          distance_unit: "in",
          weight: String(input.package.weightOz),
          mass_unit: "oz"
        }
      ],
      async: false
    })
  });

  if (!response.ok) return null;
  const shipment = (await response.json()) as ShippoShipmentResponse;
  return normalizeShippoUspsQuote(shipment, { now: options.now, env });
}

