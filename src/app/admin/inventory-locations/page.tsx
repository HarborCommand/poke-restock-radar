import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { InventoryLocationsAdmin } from "./InventoryLocationsAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Inventory Locations | GameDayGrabs Admin",
  description: "Manage physical locations for GameDayGrabs inventory.",
  robots: { index: false, follow: false }
};

export default async function InventoryLocationsPage() {
  const user = await currentUser();
  if (!user) redirect("/admin");
  if (String(user.role) !== "ADMIN") redirect("/pos");

  return <InventoryLocationsAdmin />;
}
