import { RadarApp } from "@/components/RadarApp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Poke Radar App",
  description: "Private Poke Radar dashboard.",
  robots: { index: false, follow: false }
};

export default function PrivateAppPage() {
  return <RadarApp />;
}
