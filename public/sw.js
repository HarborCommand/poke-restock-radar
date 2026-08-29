const CACHE_NAME = "poke-radar-sw-2026-08-29-pos-install-v8";
const OFFLINE_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icon.png?v=gdg-icons-v1",
  "/apple-touch-icon.png?v=gdg-icons-v1",
  "/icons/icon-192.png?v=gdg-icons-v1",
  "/icons/icon-512.png?v=gdg-icons-v1",
  "/brand/gamedaygrabs-icon.png?v=gdg-icons-v1"
];

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ version: CACHE_NAME, ...message }));
}

async function clearAppCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}

function isPosPath(pathname) {
  return pathname === "/pos" || pathname.startsWith("/pos/");
}

function requestCameFromPos(request) {
  if (!request.referrer) return false;
  try {
    const referrer = new URL(request.referrer);
    return referrer.origin === self.location.origin && isPosPath(referrer.pathname);
  } catch {
    return false;
  }
}

function posShouldBypassCache(request, url) {
  return isPosPath(url.pathname) || url.pathname === "/manifest-pos.webmanifest" || requestCameFromPos(request);
}

async function fetchFresh(request, fallbackUrl) {
  try {
    return await fetch(request, { cache: "reload" });
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (fallbackUrl) return caches.match(fallbackUrl);
    throw new Error("Network request failed and no cached fallback exists.");
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(OFFLINE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => notifyClients({ type: "APP_VERSION_READY" }))
  );
});

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (type === "CLEAR_APP_CACHE") {
    event.waitUntil(clearAppCaches().then(() => notifyClients({ type: "APP_CACHE_CLEARED" })));
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return;

  // POS is a checkout/register app. Always fetch it fresh so the iPad Home
  // Screen install cannot keep running an old broken app shell.
  if (posShouldBypassCache(request, url)) {
    event.respondWith(fetchFresh(request, request.mode === "navigate" ? "/offline.html" : null));
    return;
  }

  // Account HTML and App Router payloads can contain authenticated customer data.
  // Always use the network so they cannot survive logout in a shared worker cache.
  if (url.pathname === "/account" || url.pathname.startsWith("/account/") || request.headers.get("RSC") === "1") {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          return response;
        })
        .catch(() => caches.match("/offline.html"))
    );
    return;
  }

  if (url.origin === self.location.origin && url.pathname.startsWith("/_next/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          const cacheControl = response.headers.get("Cache-Control")?.toLowerCase() || "";
          if (
            response.ok &&
            url.origin === self.location.origin &&
            !cacheControl.includes("private") &&
            !cacheControl.includes("no-store")
          ) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match("/offline.html"));
    })
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: "Poke Restock Radar", body: event.data.text() };
    }
  }

  const title = payload.title || "Poke Restock Radar alert";
  const options = {
    body: payload.body || "Open the app for the latest private radar alert.",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/icon-192.png",
    tag: payload.tag || "poke-radar-alert",
    data: payload.data || { url: "/" },
    actions: [{ action: "open", title: "Open Radar" }]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).toString();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
