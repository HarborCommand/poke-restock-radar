import { PrivateRadarAppEntry } from "@/components/PrivateRadarAppEntry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "GameDayGrabs Admin Dashboard",
  description: "Private GameDayGrabs Admin dashboard.",
  robots: { index: false, follow: false }
};

export default function PrivateDashboardPage() {
  return <PrivateRadarAppEntry />;
}
