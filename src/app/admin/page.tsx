import { RadarApp } from "@/components/RadarApp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Poke Radar Admin",
  description: "Private Poke Radar admin area."
};

export default function PrivateAdminPage() {
  return <RadarApp />;
}
