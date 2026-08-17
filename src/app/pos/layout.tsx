import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PosCartImageFix } from "./PosCartImageFix";
import { PosCashTender } from "./PosCashTender";
import { PosCheckoutPresentation } from "./PosCheckoutPresentation";
import { PosLoadingBrand } from "./PosLoadingBrand";
import { PosRegisterShell } from "./PosRegisterShell";
import { PosScannerFocusButton } from "./PosScannerFocusButton";
import { PosSquareLikeFlow } from "./PosSquareLikeFlow";
import { PosSquarePayment } from "./PosSquarePayment";
import { PosTaxDisplaySimplifier } from "./PosTaxDisplaySimplifier";
import { PosVisibleViewport } from "./PosVisibleViewport";
import styles from "./pos-admin-separation.module.css";
import registerStyles from "./ipad-register-fix.module.css";
import squareStyles from "./pos-square-register.module.css";
import overflowStyles from "./pos-ipad-cart-overflow.module.css";
import saleContainmentStyles from "./pos-square-sale-containment.module.css";
import saleRowDensityStyles from "./pos-square-sale-row-density.module.css";
import finalFixStyles from "./pos-ipad-register-final-fix.module.css";

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
    <div className={`${styles.posShell} ${registerStyles.registerShell} ${squareStyles.squareRegister} ${overflowStyles.cartOverflowFix} ${saleContainmentStyles.saleContainmentFix} ${saleRowDensityStyles.saleRowDensity} ${finalFixStyles.finalFix}`}>
      <PosLoadingBrand />
      <PosVisibleViewport />
      <PosRegisterShell>{children}</PosRegisterShell>
      <PosCheckoutPresentation />
      <PosSquareLikeFlow />
      <PosCartImageFix />
      <PosScannerFocusButton />
      <PosCashTender />
      <PosSquarePayment />
      <PosTaxDisplaySimplifier />
    </div>
  );
}
