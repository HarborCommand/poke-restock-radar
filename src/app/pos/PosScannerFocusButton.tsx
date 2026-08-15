"use client";

import { ScanBarcode } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { PosCustomerInviteButton } from "./PosCustomerInviteButton";

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function PosScannerFocusButton() {
  const [mountPoint, setMountPoint] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let scheduled = false;

    const syncMountPoint = () => {
      scheduled = false;
      const next = document.querySelector<HTMLElement>(".pos-scan-row");
      setMountPoint((current) => (current === next ? current : next));
    };

    const scheduleSync = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(syncMountPoint);
    };

    scheduleSync();
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  if (!mountPoint) return null;

  const activateScanner = () => {
    const input = mountPoint.querySelector<HTMLInputElement>(".pos-search-input input");
    if (!input) return;

    if (input.value) setControlledInputValue(input, "");
    input.focus({ preventScroll: true });
  };

  return createPortal(
    <div
      className="pos-register-toolbar-actions"
      style={{ display: "inline-flex", alignItems: "stretch", gap: 6 }}
    >
      <button
        className="pos-scanner-focus-button"
        type="button"
        aria-label="Ready barcode scanner"
        title="Ready barcode scanner"
        onClick={activateScanner}
      >
        <ScanBarcode size={18} aria-hidden="true" />
        <span>Scan</span>
      </button>
      <PosCustomerInviteButton />
    </div>,
    mountPoint
  );
}
