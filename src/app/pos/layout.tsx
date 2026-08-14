import type { ReactNode } from "react";
import { PrivateSignOutButton } from "@/components/PrivateSignOutButton";
import styles from "./pos-admin-separation.module.css";

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.posShell}>
      {children}
      <PrivateSignOutButton adminOnly redirectTo="/pos" />
    </div>
  );
}
