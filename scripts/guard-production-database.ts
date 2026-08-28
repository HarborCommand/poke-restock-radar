import {
  formatProductionDatabaseGuardResult,
  validateProductionDatabaseConfig
} from "../src/lib/production-database-guard";

const result = validateProductionDatabaseConfig();

if (!result.shouldRun) {
  console.log("Production database guard skipped outside production.");
  process.exit(0);
}

if (!result.ok) {
  console.error("Production database guard failed.");
  console.error(formatProductionDatabaseGuardResult(result));
  process.exit(1);
}

const details = formatProductionDatabaseGuardResult(result);
console.log("Production database guard passed.");
if (details) console.log(details);
