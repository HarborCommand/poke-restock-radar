import { redirect } from "next/navigation";
import { RadarApp } from "@/components/RadarApp";
import { AdminInventoryLocationTools } from "@/components/AdminInventoryLocationTools";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "GameDayGrabs Admin",
  description: "Private GameDayGrabs Admin system area.",
  robots: { index: false, follow: false }
};

export default async function PrivateAdminPage() {
  const user = await currentUser();
  if (user && String(user.role) === "CASHIER") redirect("/pos");
  return (
    <>
      {user && String(user.role) === "ADMIN" ? <AdminInventoryLocationTools /> : null}
      <RadarApp />
    </>
  );
}
