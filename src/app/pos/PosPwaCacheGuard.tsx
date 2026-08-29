"use client";

import { useEffect } from "react";
import { BUILD_INFO } from "@/generated/build-info";

const POS_PWA_CACHE_VERSION_KEY = "gamedaygrabs-pos-pwa-cache-version";
const POS_PWA_RELOAD_KEY_PREFIX = "gamedaygrabs-pos-pwa-cache-reloaded";
const SERVICE_WORKER_PATH = "/sw.js";
const APP_CACHE_PREFIX = "poke-radar-sw-";

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
    // Storage can be unavailable in private browsing. The reload guard still
    // falls back to the current in-memory app session.
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

function reloadFreshPos(version: string) {
  const reloadKey = `${POS_PWA_RELOAD_KEY_PREFIX}:${version}`;
  if (storageGet(window.sessionStorage, reloadKey) === "true") return;
  storageSet(window.sessionStorage, reloadKey, "true");

  const url = new URL(window.location.href);
  url.searchParams.set("posPwaRefresh", version);
  window.location.replace(url.toString());
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
        // A failed cache refresh should not block the register. The version
        // marker prevents repeated reload loops on locked-down iPad sessions.
      }

      if (cancelled) return;
      storageSet(window.localStorage, POS_PWA_CACHE_VERSION_KEY, version);
      reloadFreshPos(version);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
