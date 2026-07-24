import { PrivateRadarAppEntry } from "@/components/PrivateRadarAppEntry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "GameDayGrabs Admin",
  description: "Private GameDayGrabs Admin dashboard.",
  robots: { index: false, follow: false }
};

export default function PrivateAppPage() {
  return <PrivateRadarAppEntry />;
}
