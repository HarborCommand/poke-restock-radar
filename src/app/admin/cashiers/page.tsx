import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { CashierAccountManager } from "./CashierAccountManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Cashier Accounts | GameDayGrabs Admin",
  description: "Manage POS-only cashier accounts.",
  robots: { index: false, follow: false }
};

export default async function CashierAccountsPage() {
  const user = await currentUser();
  if (!user) redirect("/admin");
  if (String(user.role) !== "ADMIN") redirect("/pos");

  return <CashierAccountManager />;
}
