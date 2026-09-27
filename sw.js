const CACHE_NAME = "cycle-journal-v14";
const ASSETS = [
  "./",
  "index.html",
  "styles.css?v=14",
  "app.js?v=14",
  "cloud.js?v=14",
  "config.js?v=11",
  "vendor/lucide.min.js?v=11",
  "vendor/supabase.min.js?v=11",
  "vendor/LUCIDE-LICENSE",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(event.request, { signal: controller.signal });
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
        return response;
      } catch {
        return (await caches.match(event.request)) || caches.match("./");
      } finally { clearTimeout(timeout); }
    })());
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.length) return windows[0].focus();
    return self.clients.openWindow("./");
  })());
});
