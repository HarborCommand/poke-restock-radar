"use client";

import { ScanBarcode } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { PosCameraScanner } from "./PosCameraScanner";
import { PosCustomerInviteButton } from "./PosCustomerInviteButton";

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function dispatchEnterWithoutSearchFocus(input: HTMLInputElement) {
  const originalFocus = input.focus;
  const blockedFocus: typeof input.focus = () => undefined;
  input.focus = blockedFocus;
  try {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  } finally {
    input.focus = originalFocus;
  }
}

function checkoutSearchInput() {
  return document.querySelector<HTMLInputElement>(".pos-search-input input");
}

export function PosScannerFocusButton() {
  const [mountPoint, setMountPoint] = useState<HTMLElement | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

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

  const activateCameraScanner = () => {
    const input = checkoutSearchInput();
    if (input?.value) setControlledInputValue(input, "");
    input?.blur();
    setScannerOpen(true);
  };

  const useExternalScanner = useCallback(() => {
    setScannerOpen(false);
    window.requestAnimationFrame(() => {
      const input = checkoutSearchInput();
      if (!input) return;
      if (input.value) setControlledInputValue(input, "");
      input.focus({ preventScroll: true });
      input.select();
    });
  }, []);

  const handleDetected = useCallback((rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    const input = checkoutSearchInput();
    if (!input) return;

    setControlledInputValue(input, code);
    dispatchEnterWithoutSearchFocus(input);
    setScannerOpen(false);
  }, []);

  if (!mountPoint) return null;

  return (
    <>
      {createPortal(
        <div
          className="pos-register-toolbar-actions"
          style={{ display: "inline-flex", alignItems: "stretch", gap: 6 }}
        >
          <button
            className="pos-scanner-focus-button"
            type="button"
            aria-label="Scan barcode with iPad camera"
            title="Scan barcode with iPad camera"
            onClick={activateCameraScanner}
          >
            <ScanBarcode size={18} aria-hidden="true" />
            <span>Scan</span>
          </button>
          <PosCustomerInviteButton />
        </div>,
        mountPoint
      )}

      {createPortal(
        <PosCameraScanner
          open={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onDetected={handleDetected}
          onExternalScanner={useExternalScanner}
        />,
        document.body
      )}
    </>
  );
}
