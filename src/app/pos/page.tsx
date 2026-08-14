"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./pos-store-mode.module.css";

const RadarApp = dynamic(
  () => import("@/components/RadarApp").then((module) => module.RadarApp),
  { ssr: false }
);

export default function PosStoreModePage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") !== "pos") {
      url.searchParams.set("tab", "pos");
      window.history.replaceState(window.history.state, "", url);
    }
    setReady(true);
  }, []);

  return (
    <div className={styles.storeMode}>
      <Link className={styles.exitButton} href="/admin?tab=pos">
        Exit Store Mode
      </Link>
      {ready ? (
        <RadarApp />
      ) : (
        <div className={styles.loading} role="status" aria-live="polite">
          Opening POS…
        </div>
      )}
    </div>
  );
}
