import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sales Tax Reports | GameDayGrabs Admin",
  description: "Private filing-support tax reports and accountant exports.",
  robots: { index: false, follow: false }
};

export default async function TaxReportsPage() {
  const user = await currentUser();
  if (!user) redirect("/admin");
  if (user.role !== "ADMIN") notFound();
  redirect("/app?tab=tax&section=reports");
}
