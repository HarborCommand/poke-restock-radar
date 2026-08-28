type EnvLike = Record<string, string | undefined>;

type DatabaseTarget = {
  name: string;
  configured: boolean;
  protocol: string | null;
  hostname: string | null;
  databaseName: string | null;
  username: string | null;
};

export type ProductionDatabaseGuardResult = {
  shouldRun: boolean;
  ok: boolean;
  errors: string[];
  warnings: string[];
  targets: DatabaseTarget[];
};

const defaultExpectedDatabaseName = "poke_restock_radar_prod";
const unsafeTargetPattern = /(preview|qa|test|empty|codex|pr\d+)/i;

function envFlag(value: string | undefined) {
  return String(value || "").trim().toLowerCase() === "true";
}

function cleanEnvValue(value: string | undefined) {
  const trimmed = String(value || "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDatabaseName(value: string | null) {
  return String(value || "").trim().toLowerCase();
}

function parseDatabaseTarget(name: string, rawValue: string | undefined): DatabaseTarget {
  const value = cleanEnvValue(rawValue);
  if (!value) {
    return { name, configured: false, protocol: null, hostname: null, databaseName: null, username: null };
  }

  try {
    const parsed = new URL(value);
    return {
      name,
      configured: true,
      protocol: parsed.protocol.replace(/:$/, ""),
      hostname: parsed.hostname || null,
      databaseName: decodeURIComponent(parsed.pathname.replace(/^\//, "")) || null,
      username: parsed.username ? decodeURIComponent(parsed.username) : null
    };
  } catch {
    return { name, configured: true, protocol: null, hostname: null, databaseName: null, username: null };
  }
}

function targetSummary(target: DatabaseTarget) {
  if (!target.configured) return `${target.name}=missing`;
  const parts = [
    target.protocol ? `${target.protocol}://` : "",
    target.username ? `${target.username}@` : "",
    target.hostname || "invalid-host",
    target.databaseName ? `/${target.databaseName}` : "/missing-db"
  ];
  return `${target.name}=${parts.join("")}`;
}

function targetLooksUnsafe(target: DatabaseTarget) {
  const text = [target.hostname, target.databaseName, target.username].filter(Boolean).join(" ");
  return unsafeTargetPattern.test(text);
}

export function validateProductionDatabaseConfig(env: EnvLike = process.env): ProductionDatabaseGuardResult {
  const shouldRun = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
  const allowUnsafe = envFlag(env.ALLOW_NON_PROD_DATABASE_IN_PRODUCTION);
  const expectedDatabaseName = normalizeDatabaseName(env.PRODUCTION_DATABASE_NAME || defaultExpectedDatabaseName);
  const targets = [
    parseDatabaseTarget("DATABASE_URL", env.DATABASE_URL),
    parseDatabaseTarget("DATABASE_URL_UNPOOLED", env.DATABASE_URL_UNPOOLED),
    parseDatabaseTarget("DIRECT_URL", env.DIRECT_URL)
  ];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!shouldRun) {
    return { shouldRun, ok: true, errors, warnings, targets };
  }

  const primary = targets[0];
  if (!primary.configured) {
    errors.push("DATABASE_URL is required for production.");
  } else if (primary.protocol !== "postgres" && primary.protocol !== "postgresql") {
    errors.push(`DATABASE_URL must be a Postgres URL; found ${primary.protocol || "invalid URL"}.`);
  }

  for (const target of targets.filter((item) => item.configured)) {
    if (!target.protocol || !target.hostname || !target.databaseName) {
      errors.push(`${target.name} is not a valid database URL.`);
      continue;
    }
    if (target.protocol !== "postgres" && target.protocol !== "postgresql") {
      errors.push(`${target.name} must use postgres/postgresql.`);
    }
    if (targetLooksUnsafe(target)) {
      const message = `${target.name} appears to point at a preview/test database target (${targetSummary(target)}).`;
      if (allowUnsafe) warnings.push(message);
      else errors.push(message);
    }
    if (expectedDatabaseName && normalizeDatabaseName(target.databaseName) !== expectedDatabaseName) {
      const message = `${target.name} database name is ${target.databaseName}; expected ${expectedDatabaseName}.`;
      if (allowUnsafe) warnings.push(message);
      else errors.push(message);
    }
  }

  const configuredDatabaseNames = new Set(
    targets
      .filter((target) => target.configured && target.databaseName)
      .map((target) => normalizeDatabaseName(target.databaseName))
  );
  if (!allowUnsafe && configuredDatabaseNames.size > 1) {
    errors.push(`Production database URLs point at different database names: ${Array.from(configuredDatabaseNames).join(", ")}.`);
  }

  return {
    shouldRun,
    ok: errors.length === 0,
    errors,
    warnings,
    targets
  };
}

export function formatProductionDatabaseGuardResult(result: ProductionDatabaseGuardResult) {
  const targetLines = result.targets
    .filter((target) => target.configured)
    .map((target) => `- ${targetSummary(target)}`);
  return [
    ...result.errors.map((error) => `ERROR: ${error}`),
    ...result.warnings.map((warning) => `WARNING: ${warning}`),
    targetLines.length > 0 ? "Configured production database targets:" : null,
    ...targetLines
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}
