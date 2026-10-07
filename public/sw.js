// Service worker: app shell works offline; news data always network-first.
const CACHE = 'sports-radar-v39'; // keep in step with the ?v= on the files in index.html
const SHELL = ['./', 'index.html', 'style.css?v=39', 'app.js?v=39', 'scores.js?v=39', 'learn.js?v=39', 'manifest.webmanifest', 'icon.svg'];

// Clicking a notification opens the story (or focuses the app)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      if (url && !url.startsWith(self.registration.scope)) return self.clients.openWindow(url);
      if (wins[0]) return wins[0].focus();
      return self.clients.openWindow(url || './');
    })
  );
});

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Network first for everything same-origin; fall back to cache when offline
  e.respondWith(
    // no-cache: always ask the server whether the file changed (a cheap 304 when it didn't), so a new version shows at once
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          const key = /\/data\/[\w-]+\.json$/.test(url.pathname) ? new Request(url.origin + url.pathname) : e.request;
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(/\/data\/[\w-]+\.json$/.test(url.pathname) ? new Request(url.origin + url.pathname) : e.request))
  );
});
