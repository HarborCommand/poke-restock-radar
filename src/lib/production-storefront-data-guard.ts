type EnvLike = Record<string, string | undefined>;

export type ProductionStorefrontDataGuardInput = {
  publicProductCount: number;
  adminUserCount: number;
  env?: EnvLike;
};

export type ProductionStorefrontDataGuardResult = {
  shouldRun: boolean;
  ok: boolean;
  errors: string[];
  warnings: string[];
};

function envFlag(value: string | undefined) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function evaluateProductionStorefrontDataGuard(input: ProductionStorefrontDataGuardInput): ProductionStorefrontDataGuardResult {
  const env = input.env ?? process.env;
  const shouldRun = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
  const allowEmpty = envFlag(env.ALLOW_EMPTY_STOREFRONT_IN_PRODUCTION);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!shouldRun) return { shouldRun, ok: true, errors, warnings };

  if (input.adminUserCount <= 0) {
    errors.push(
      "No Admin users exist in the connected production database. Refusing to deploy because admin login would be locked out."
    );
  }

  if (input.publicProductCount <= 0) {
    const message =
      "No public storefront products exist in the connected production database. This usually means DATABASE_URL points to an empty or wrong Neon database.";
    if (allowEmpty) warnings.push(`${message} ALLOW_EMPTY_STOREFRONT_IN_PRODUCTION=true allowed this build to continue.`);
    else errors.push(`${message} Refusing to deploy an empty public catalog.`);
  }

  return { shouldRun, ok: errors.length === 0, errors, warnings };
}

export function formatProductionStorefrontDataGuardResult(result: ProductionStorefrontDataGuardResult) {
  return [
    ...result.errors.map((error) => `ERROR: ${error}`),
    ...result.warnings.map((warning) => `WARNING: ${warning}`)
  ]
    .filter(Boolean)
    .join("\n");
}
