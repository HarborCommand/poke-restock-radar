import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const schemaPath = ".prisma-postgres/schema.prisma";
const baselineMigration = "20260613110511_checkout_customer_records";
const cancelRefundMigration = "20260613143000_storefront_cancel_refund_flow";

type CommandResult = {
  output: string;
  status: number;
};

function migrationEnv() {
  const directDatabaseUrl = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!directDatabaseUrl) return process.env;

  return {
    ...process.env,
    DATABASE_URL: directDatabaseUrl
  };
}

function prismaBin() {
  return process.platform === "win32" ? "prisma.cmd" : "prisma";
}

function redact(output: string) {
  return output
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[redacted database url]")
    .replace(
      /Datasource "db": PostgreSQL database "[^"]+", schema "[^"]+" at "[^"]+"/g,
      'Datasource "db": PostgreSQL database [redacted]'
    );
}

function runPrisma(
  args: string[],
  options: { allowFailure?: boolean; printOutput?: boolean } = {}
): CommandResult {
  const result = spawnSync(prismaBin(), args, {
    encoding: "utf8",
    env: migrationEnv()
  });
  const output = [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n");
  const status = result.status ?? 1;

  if (status !== 0 && !options.allowFailure) {
    throw new Error(`prisma ${args.join(" ")} failed:\n${redact(output)}`);
  }

  if (status === 0 && options.printOutput !== false && output.trim()) {
    console.log(redact(output.trim()));
  }

  return { output, status };
}

async function runSqlCheck(sql: string) {
  const dir = await mkdtemp(join(tmpdir(), "poke-radar-migrate-"));
  const file = join(dir, "check.sql");

  try {
    await writeFile(file, sql, "utf8");
    return runPrisma(["db", "execute", "--schema", schemaPath, "--file", file], {
      allowFailure: true,
      printOutput: false
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

const baselineVerifier = `
DO $$
DECLARE
  missing_column text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'StorefrontCustomer'
  ) THEN
    RAISE EXCEPTION 'baseline table missing: StorefrontCustomer';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'StorefrontOrder'
  ) THEN
    RAISE EXCEPTION 'baseline table missing: StorefrontOrder';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'PaymentEvent'
  ) THEN
    RAISE EXCEPTION 'baseline table missing: PaymentEvent';
  END IF;

  SELECT required.table_name || '.' || required.column_name INTO missing_column
  FROM (
    VALUES
      ('StorefrontCustomer', 'firstOrderAt'),
      ('StorefrontCustomer', 'lastOrderAt'),
      ('StorefrontCustomer', 'totalOrders'),
      ('StorefrontCustomer', 'totalSpent'),
      ('StorefrontCustomer', 'defaultShippingName'),
      ('StorefrontOrder', 'customerPhone'),
      ('StorefrontOrder', 'shippingName'),
      ('StorefrontOrder', 'billingName')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns columns
    WHERE columns.table_schema = current_schema()
      AND columns.table_name = required.table_name
      AND columns.column_name = required.column_name
  )
  LIMIT 1;

  IF missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'baseline column missing: %', missing_column;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'StorefrontCustomer_email_key'
  ) THEN
    RAISE EXCEPTION 'baseline index missing: StorefrontCustomer_email_key';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'StorefrontOrder_stripeCheckoutSessionId_key'
  ) THEN
    RAISE EXCEPTION 'baseline index missing: StorefrontOrder_stripeCheckoutSessionId_key';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'PaymentEvent_eventId_key'
  ) THEN
    RAISE EXCEPTION 'baseline index missing: PaymentEvent_eventId_key';
  END IF;
END $$;
`;

const cancelRefundVerifier = `
DO $$
DECLARE
  present_count integer;
  missing_column text;
BEGIN
  SELECT COUNT(*) INTO present_count
  FROM (
    VALUES
      ('refundStatus'),
      ('refundedAmount'),
      ('refundCurrency'),
      ('stripeRefundId'),
      ('refundReason'),
      ('refundNote'),
      ('stockReturnStatus'),
      ('stockReturnedAt'),
      ('customerCancellationEmailStatus'),
      ('customerCancellationEmailSentAt')
  ) AS required(column_name)
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns columns
    WHERE columns.table_schema = current_schema()
      AND columns.table_name = 'StorefrontOrder'
      AND columns.column_name = required.column_name
  );

  IF present_count = 0 THEN
    RAISE EXCEPTION 'CANCEL_REFUND_MIGRATION_PENDING';
  END IF;

  SELECT required.column_name INTO missing_column
  FROM (
    VALUES
      ('refundStatus'),
      ('refundedAmount'),
      ('refundCurrency'),
      ('stripeRefundId'),
      ('refundReason'),
      ('refundNote'),
      ('stockReturnStatus'),
      ('stockReturnedAt'),
      ('customerCancellationEmailStatus'),
      ('customerCancellationEmailSentAt')
  ) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns columns
    WHERE columns.table_schema = current_schema()
      AND columns.table_name = 'StorefrontOrder'
      AND columns.column_name = required.column_name
  )
  LIMIT 1;

  IF missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'cancel/refund migration is partially present; missing column: %', missing_column;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema() AND indexname = 'StorefrontOrder_refundStatus_idx'
  ) THEN
    RAISE EXCEPTION 'cancel/refund migration is partially present; missing index: StorefrontOrder_refundStatus_idx';
  END IF;
END $$;
`;

async function main() {
  if (process.env.DATABASE_URL_UNPOOLED?.trim()) {
    console.log("Using DATABASE_URL_UNPOOLED for production Prisma migration commands.");
  }

  console.log("Checking production Prisma migration status.");
  const status = runPrisma(["migrate", "status", "--schema", schemaPath], {
    allowFailure: true,
    printOutput: false
  });

  if (status.status === 0) {
    if (status.output.trim()) {
      console.log(redact(status.output.trim()));
    }
    console.log("Production migration history is current; skipping migrate deploy.");
    return;
  }

  console.log("Production migration status requires deploy or repair; running migrate deploy.");
  const deploy = runPrisma(["migrate", "deploy", "--schema", schemaPath], {
    allowFailure: true,
    printOutput: false
  });

  if (deploy.status === 0) {
    if (deploy.output.trim()) {
      console.log(redact(deploy.output.trim()));
    }
    console.log("Production migrations are applied.");
    return;
  }

  if (!/P3005|database schema is not empty/i.test(deploy.output)) {
    throw new Error(`prisma migrate deploy failed:\n${redact(deploy.output)}`);
  }

  console.log("Production database needs one-time Prisma migration baseline.");
  const baseline = await runSqlCheck(baselineVerifier);
  if (baseline.status !== 0) {
    throw new Error(`Production baseline verification failed:\n${redact(baseline.output)}`);
  }

  console.log(`Verified existing production schema for ${baselineMigration}.`);
  runPrisma(["migrate", "resolve", "--applied", baselineMigration, "--schema", schemaPath]);

  const cancelRefund = await runSqlCheck(cancelRefundVerifier);
  if (cancelRefund.status === 0) {
    console.log(`Verified existing production schema for ${cancelRefundMigration}.`);
    runPrisma(["migrate", "resolve", "--applied", cancelRefundMigration, "--schema", schemaPath]);
  } else if (/CANCEL_REFUND_MIGRATION_PENDING/.test(cancelRefund.output)) {
    console.log(`${cancelRefundMigration} is pending and will be applied by migrate deploy.`);
  } else {
    throw new Error(`Cancel/refund migration verification failed:\n${redact(cancelRefund.output)}`);
  }

  runPrisma(["migrate", "deploy", "--schema", schemaPath]);
  console.log("Production migration deploy completed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
