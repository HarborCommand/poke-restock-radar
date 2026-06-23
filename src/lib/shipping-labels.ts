import { shippingRateProviderConfig, type ShippingRateProviderEnv } from "@/lib/shipping-rate-provider";

export type ShippingLabelWorkflowConfig = {
  shippingLabelsEnabled: boolean;
  shippoLabelPurchaseEnabled: boolean;
  provider: "shippo" | "none";
  labelProviderConfigured: boolean;
  purchaseReady: boolean;
  envVars: string[];
};

export const shippingLabelWorkflowEnvVars = [
  "SHIPPING_LABELS_ENABLED",
  "SHIPPO_LABEL_PURCHASE_ENABLED",
  "SHIPPO_API_TOKEN",
  "SHIP_FROM_NAME",
  "SHIP_FROM_STREET1",
  "SHIP_FROM_STREET2",
  "SHIP_FROM_CITY",
  "SHIP_FROM_STATE",
  "SHIP_FROM_ZIP",
  "SHIP_FROM_COUNTRY"
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

export function shippingLabelWorkflowConfig(env: ShippingRateProviderEnv = process.env): ShippingLabelWorkflowConfig {
  const rateConfig = shippingRateProviderConfig(env);
  const shippingLabelsEnabled = envFlag(env, "SHIPPING_LABELS_ENABLED", false);
  const shippoLabelPurchaseEnabled = envFlag(env, "SHIPPO_LABEL_PURCHASE_ENABLED", false);
  const provider = rateConfig.provider === "shippo" ? "shippo" : "none";
  const labelProviderConfigured = provider === "shippo" && rateConfig.shippoConfigured;

  return {
    shippingLabelsEnabled,
    shippoLabelPurchaseEnabled,
    provider,
    labelProviderConfigured,
    purchaseReady: shippoLabelPurchaseEnabled && labelProviderConfigured,
    envVars: shippingLabelWorkflowEnvVars
  };
}
