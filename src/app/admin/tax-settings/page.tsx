import { TaxSettingsWorkspace } from "@/components/TaxSettingsWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tax Settings | GameDayGrabs Admin",
  description: "Private tax configuration and go-live readiness workspace."
};

export default function TaxSettingsPage() {
  return <TaxSettingsWorkspace />;
}
