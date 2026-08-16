import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AdminInventoryLocationTools } from "@/components/AdminInventoryLocationTools";
import { RadarApp } from "@/components/RadarApp";
import { currentUser } from "@/lib/auth";
import { isGameDayGrabsHost, POKE_RESTOCK_RADAR_PRODUCTION_URL } from "@/lib/storefront-routing";

export async function PrivateRadarAppEntry() {
  const user = await currentUser();
  if (user && String(user.role) === "CASHIER") redirect("/pos");

  const host = (await headers()).get("host");
  if (isGameDayGrabsHost(host)) {
    redirect(POKE_RESTOCK_RADAR_PRODUCTION_URL);
  }

  return (
    <>
      {user && String(user.role) === "ADMIN" ? <AdminInventoryLocationTools /> : null}
      <RadarApp />
    </>
  );
}
