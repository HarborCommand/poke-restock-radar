import "dotenv/config";
import { prisma } from "@/lib/db";
import { runProductMonitorBatch } from "@/lib/monitor";

async function main() {
  const result = await runProductMonitorBatch("due", "DUE_JOB");
  console.log(
    `Monitor complete: checked ${result.checked}, changed ${result.changed}, errors ${result.errors}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
