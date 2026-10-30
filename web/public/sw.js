// Service Worker: App offline startbar machen + Push-Mitteilungen anzeigen.
const CACHE = 'stella-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Bilder aus dem Chat offline verfügbar halten (privat, daher nur im Gerätespeicher)
  if (url.pathname.startsWith('/api/files/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(url.pathname);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(url.pathname, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) return;

  // Seiten: erst Netz, sonst Cache. Assets (mit Hash im Namen): erst Cache.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { caches.open(CACHE).then((c) => c.put('/', res.clone())); return res; })
        .catch(() => caches.match('/')),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
      if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
      return res;
    })),
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Stella', body: '' };
  try { data = { ...data, ...event.data.json() }; } catch { data.body = event.data?.text() ?? ''; }
  event.waitUntil((async () => {
    await self.registration.showNotification(data.title, {
      body: data.body, tag: data.tag, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url ?? '/' },
    });
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.postMessage('sync'));
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (clients.length) { await clients[0].focus(); clients[0].postMessage('sync'); return; }
    await self.clients.openWindow(event.notification.data?.url ?? '/');
  })());
});
