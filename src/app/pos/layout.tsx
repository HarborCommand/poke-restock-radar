import type { ReactNode } from "react";
import { PrivateSignOutButton } from "@/components/PrivateSignOutButton";
import { PosCartImageFix } from "./PosCartImageFix";
import { PosCashTender } from "./PosCashTender";
import { PosScannerFocusButton } from "./PosScannerFocusButton";
import styles from "./pos-admin-separation.module.css";
import registerStyles from "./ipad-register-fix.module.css";

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.posShell} ${registerStyles.registerShell}`}>
      {children}
      <PosCartImageFix />
      <PosScannerFocusButton />
      <PosCashTender />
      <PrivateSignOutButton adminOnly redirectTo="/pos" />
    </div>
  );
}