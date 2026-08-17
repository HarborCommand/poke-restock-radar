"use client";

import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Keyboard, SwitchCamera, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./PosCameraScanner.module.css";

type CameraFacing = "user" | "environment";

type PosCameraScannerProps = {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
  onExternalScanner: () => void;
};

const supportedBarcodeFormats = [
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39
];

function createBarcodeReader() {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, supportedBarcodeFormats);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints);
}

function stopVideo(video: HTMLVideoElement | null) {
  const stream = video?.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) track.stop();
  }
  if (video) video.srcObject = null;
}

function cameraErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access is blocked. Allow camera access for GameDayGrabs, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "That camera is not available on this iPad. Try switching cameras.";
  }
  return "Could not start the camera. You can retry or use an external scanner.";
}

export function PosCameraScanner({ open, onClose, onDetected, onExternalScanner }: PosCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const detectedRef = useRef(false);
  const [facingMode, setFacingMode] = useState<CameraFacing>("user");
  const [status, setStatus] = useState("Starting front camera…");
  const [error, setError] = useState<string | null>(null);

  const stopScanner = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    stopVideo(videoRef.current);
  }, []);

  useEffect(() => {
    if (!open) {
      stopScanner();
      return;
    }

    let cancelled = false;
    const video = videoRef.current;
    if (!video) return;

    detectedRef.current = false;
    setError(null);
    setStatus(facingMode === "user" ? "Starting front camera…" : "Starting rear camera…");

    const reader = createBarcodeReader();
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    };

    void reader
      .decodeFromConstraints(constraints, video, (result) => {
        if (!result || cancelled || detectedRef.current) return;
        const code = result.getText().trim();
        if (!code) return;
        detectedRef.current = true;
        setStatus(`Scanned ${code}`);
        onDetected(code);
      })
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          stopVideo(video);
          return;
        }
        controlsRef.current = controls;
        setStatus("Hold the barcode inside the box");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        stopVideo(video);
        setError(cameraErrorMessage(reason));
        setStatus("Camera unavailable");
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      stopVideo(video);
    };
  }, [facingMode, onDetected, open, stopScanner]);

  useEffect(() => () => stopScanner(), [stopScanner]);

  if (!open) return null;

  const switchCamera = () => {
    stopScanner();
    detectedRef.current = false;
    setFacingMode((current) => (current === "user" ? "environment" : "user"));
  };

  const close = () => {
    stopScanner();
    onClose();
  };

  const useExternal = () => {
    stopScanner();
    onExternalScanner();
  };

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className={styles.card} role="dialog" aria-modal="true" aria-label="Barcode scanner">
        <header className={styles.header}>
          <div className={styles.heading}>
            <span>GameDayGrabs POS</span>
            <strong>Scan barcode</strong>
          </div>
          <button className={styles.closeButton} type="button" aria-label="Close scanner" onClick={close}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.preview}>
          <video ref={videoRef} className={styles.video} autoPlay muted playsInline aria-label="Live barcode camera" />
          <div className={styles.guide} aria-hidden="true" />
          <div className={`${styles.status} ${error ? styles.error : ""}`} role="status">
            {error || status}
          </div>
        </div>

        <footer className={styles.footer}>
          <button className={styles.controlButton} type="button" onClick={switchCamera}>
            <SwitchCamera size={18} aria-hidden="true" />
            {facingMode === "user" ? "Use rear camera" : "Use front camera"}
          </button>
          <button className={styles.externalButton} type="button" onClick={useExternal}>
            <Keyboard size={18} aria-hidden="true" />
            External scanner
          </button>
          <p className={styles.tip}>
            Front camera opens first. Keep the full UPC straight and well lit; switch to the rear camera if you need faster focus.
          </p>
        </footer>
      </section>
    </div>
  );
}
