import { PrivateRadarAppEntry } from "@/components/PrivateRadarAppEntry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Poke Radar Login",
  description: "Private Poke Radar login.",
  robots: { index: false, follow: false }
};

export default function PrivateLoginPage() {
  return <PrivateRadarAppEntry />;
}
