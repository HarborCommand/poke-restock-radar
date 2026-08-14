import type { ReactNode } from "react";
import { PrivateSignOutButton } from "@/components/PrivateSignOutButton";

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PrivateSignOutButton adminOnly redirectTo="/pos" />
    </>
  );
}
