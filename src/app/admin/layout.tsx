import type { ReactNode } from "react";
import { PrivateSignOutButton } from "@/components/PrivateSignOutButton";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PrivateSignOutButton redirectTo="/pos" />
    </>
  );
}
