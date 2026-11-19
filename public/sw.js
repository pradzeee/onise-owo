// Oníṣẹ́ ọwọ́ Service Worker — lightweight shell & Web Push with delivery ack (Step 3)
const CACHE_NAME = "onise-owo-shell-v2";
const SHELL_URLS = ["/", "/login", "/terms", "/privacy", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

// Network-first for navigation; never cache /api/* responses
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((res) => res || caches.match("/")),
      ),
    );
  }
});

// Web Push handler: displays notification AND acknowledges receipt to cancel 30s SMS backup
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data = {
    title: "Oníṣẹ́ ọwọ́",
    body: "You have a new update.",
    url: "/dashboard",
    alertId: null,
    ackToken: null,
  };

  try {
    data = { ...data, ...event.data.json() };
  } catch {
    data.body = event.data.text();
  }

  const tasks = [
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/icon.svg",
      badge: "/icons/icon.svg",
      tag: data.alertId ? `onise-alert-${data.alertId}` : undefined,
      renotify: true,
      data: { url: data.url || "/dashboard" },
    }),
  ];

  // Acknowledge delivery so the server knows push arrived within 30s and skips SMS backup
  if (data.alertId && data.ackToken) {
    tasks.push(
      fetch("/api/alerts/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alertId: data.alertId,
          ackToken: data.ackToken,
        }),
      }).catch(() => {}),
    );
  }

  event.waitUntil(Promise.all(tasks));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
