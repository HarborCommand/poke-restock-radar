import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tax Settings | GameDayGrabs Admin",
  description: "Private tax configuration and go-live readiness workspace.",
  robots: { index: false, follow: false }
};

export default async function TaxSettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/admin");
  if (user.role !== "ADMIN") notFound();
  redirect("/app?tab=tax&section=settings");
}
