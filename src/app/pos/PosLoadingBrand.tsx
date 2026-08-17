"use client";

import { useEffect, useState } from "react";
import styles from "./PosLoadingBrand.module.css";

const OPENING_MESSAGES = new Set([
  "Opening Store POS…",
  "Opening Store POS...",
  "Opening POS…",
  "Opening POS...",
  "Loading POS…",
  "Loading POS..."
]);

function hasOpeningMessage() {
  return Array.from(document.querySelectorAll<HTMLElement>("div")).some((element) =>
    OPENING_MESSAGES.has(element.textContent?.trim() || "")
  );
}

export function PosLoadingBrand() {
  // Start visible so the branded logo is present on the very first painted POS frame.
  const [active, setActive] = useState(true);

  useEffect(() => {
    let scheduled = false;

    const sync = () => {
      scheduled = false;
      setActive(hasOpeningMessage());
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(sync);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
  }, []);

  if (!active) return null;

  return (
    <div className={styles.overlay} role="status" aria-live="polite" aria-label="Opening GameDayGrabs POS">
      <img
        className={styles.logo}
        src="/icon.png?v=gdg-icons-v1"
        width="128"
        height="128"
        alt=""
        aria-hidden="true"
      />
      <span className={styles.srOnly}>Opening GameDayGrabs POS</span>
    </div>
  );
}
