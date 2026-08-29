"use client";

import { useEffect } from "react";
import { BUILD_INFO } from "@/generated/build-info";

const POS_PWA_CACHE_VERSION_KEY = "gamedaygrabs-pos-pwa-cache-version";
const SERVICE_WORKER_PATH = "/sw.js";
const APP_CACHE_PREFIX = "poke-radar-sw-";
const POS_REFRESH_PARAM = "posPwaRefresh";

function isStandalonePwa() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return Boolean(window.matchMedia?.("(display-mode: standalone)").matches || navigatorWithStandalone.standalone);
}

function storageGet(storage: Storage, key: string) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private browsing. Cache cleanup still runs
    // in the background without blocking the register screen.
  }
}

async function refreshServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { updateViaCache: "none" });
  await registration.update();
  registration.waiting?.postMessage({ type: "SKIP_WAITING" });
  registration.active?.postMessage({ type: "CLEAR_APP_CACHE" });
}

async function clearLegacyPwaCaches() {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith(APP_CACHE_PREFIX)).map((key) => caches.delete(key)));
}

function reloadStandalonePos(version: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(POS_REFRESH_PARAM) === version) return;

  if (url.pathname === "/pos" || url.pathname.startsWith("/pos/")) {
    url.searchParams.set("source", "pos-pwa");
    url.searchParams.set(POS_REFRESH_PARAM, version);
    window.location.replace(`${url.pathname}?${url.searchParams.toString()}${url.hash}`);
    return;
  }

  window.location.reload();
}

export function PosPwaCacheGuard() {
  useEffect(() => {
    if (!isStandalonePwa()) return;

    const version = BUILD_INFO.serviceWorkerVersion;
    if (storageGet(window.localStorage, POS_PWA_CACHE_VERSION_KEY) === version) {
      if ("serviceWorker" in navigator) {
        void navigator.serviceWorker.getRegistration().then((registration) => registration?.update()).catch(() => undefined);
      }
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        await refreshServiceWorker();
        await clearLegacyPwaCaches();
      } catch {
        // A failed cache refresh should not block the register.
      }

      if (cancelled) return;
      storageSet(window.localStorage, POS_PWA_CACHE_VERSION_KEY, version);
      reloadStandalonePos(version);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
