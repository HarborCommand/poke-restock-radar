import { PrivateRadarAppEntry } from "@/components/PrivateRadarAppEntry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "GameDayGrabs Admin Login",
  description: "Private GameDayGrabs Admin login.",
  robots: { index: false, follow: false }
};

export default function PrivateLoginPage() {
  return <PrivateRadarAppEntry />;
}
