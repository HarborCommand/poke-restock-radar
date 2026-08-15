import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PrivateSignOutButton } from "@/components/PrivateSignOutButton";
import { PosCartImageFix } from "./PosCartImageFix";
import { PosCashTender } from "./PosCashTender";
import { PosScannerFocusButton } from "./PosScannerFocusButton";
import { PosSquarePayment } from "./PosSquarePayment";
import { PosTaxDisplaySimplifier } from "./PosTaxDisplaySimplifier";
import styles from "./pos-admin-separation.module.css";
import registerStyles from "./ipad-register-fix.module.css";

export const metadata: Metadata = {
  applicationName: "GameDayGrabs POS",
  title: "GameDayGrabs POS",
  description: "GameDayGrabs iPad point-of-sale register.",
  manifest: "/manifest-pos.webmanifest",
  appleWebApp: {
    capable: true,
    title: "GameDayGrabs POS",
    statusBarStyle: "black-translucent"
  }
};

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${styles.posShell} ${registerStyles.registerShell}`}>
      {children}
      <PosCartImageFix />
      <PosScannerFocusButton />
      <PosCashTender />
      <PosSquarePayment />
      <PosTaxDisplaySimplifier />
      <PrivateSignOutButton adminOnly redirectTo="/pos" />
    </div>
  );
}
