import { notFound, redirect } from "next/navigation";
import { TaxReportsWorkspace } from "@/components/TaxReportsWorkspace";
import { currentUser } from "@/lib/auth";
import { taxFeatureConfig } from "@/lib/tax";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sales Tax Reports | GameDayGrabs Admin",
  description: "Private filing-support tax reports and accountant exports.",
  robots: { index: false, follow: false }
};

export default async function TaxReportsPage() {
  const user = await currentUser();
  if (!user) redirect("/admin");
  if (user.role !== "ADMIN") notFound();
  if (!taxFeatureConfig().taxReportingEnabled) {
    return (
      <main className="tax-report-workspace tax-report-disabled">
        <section className="tax-report-disabled-card" aria-labelledby="tax-report-disabled-title">
          <p className="tax-report-eyebrow">Filing-support workspace</p>
          <h1 id="tax-report-disabled-title">Sales Tax Reports are disabled</h1>
          <p>The independent reporting runtime gate is off. No transaction data was loaded and no export was generated.</p>
          <p>Configure and approve reporting readiness before enabling this workspace in a non-production environment.</p>
          <a href="/admin/tax-settings">Return to Tax Settings</a>
        </section>
      </main>
    );
  }
  return <TaxReportsWorkspace />;
}
