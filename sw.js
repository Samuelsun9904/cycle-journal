const CACHE_NAME = "cycle-journal-v4";
const ASSETS = [
  "./",
  "index.html",
  "styles.css?v=4",
  "app.js?v=4",
  "vendor/lucide.min.js?v=4",
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
    const hadPreviousVersion = keys.some(key => key.startsWith("cycle-journal-") && key !== CACHE_NAME);
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
    if (hadPreviousVersion) {
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map(client => client.navigate(client.url)));
    }
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone());
        return response;
      } catch {
        return (await caches.match(event.request)) || caches.match("./");
      }
    })());
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
