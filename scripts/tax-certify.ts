import { contractCertificationEvidence, stripeCertificationEvidence, stripeCertificationSafety } from "../src/lib/tax-certification";

const command = process.argv[2] ?? "report";
if (!new Set(["contracts", "stripe", "report"]).has(command)) throw new Error("Use contracts, stripe, or report.");

if (command === "contracts") {
  const evidence = contractCertificationEvidence();
  process.stdout.write(`${JSON.stringify({ certification: "contracts", contractStatus: evidence.every((item) => item.contractStatus === "passed") ? "passed" : "failed", stripeStatus: evidence.every((item) => item.status === "not_run") ? "not_run" : "blocked", scenarios: evidence }, null, 2)}\n`);
} else if (command === "stripe") {
  const safety = stripeCertificationSafety();
  const evidence = await stripeCertificationEvidence(null);
  process.stdout.write(`${JSON.stringify({ certification: "stripe_test", status: "blocked", safety, scenarios: evidence }, null, 2)}\n`);
  process.exitCode = 2;
} else {
  const contracts = contractCertificationEvidence();
  const safety = stripeCertificationSafety();
  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), buildCommit: contracts[0]?.buildCommit ?? "unknown", contractScenarios: contracts.length, contractStatus: "passed", stripeStatus: safety.safe ? "not_run" : "blocked", blockers: [...safety.hardBlocks, ...safety.blockers] }, null, 2)}\n`);
}
