import { RadarApp } from "@/components/RadarApp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "GameDayGrabs Admin",
  description: "Private GameDayGrabs Admin system area.",
  robots: { index: false, follow: false }
};

export default function PrivateAdminPage() {
  return <RadarApp />;
}
