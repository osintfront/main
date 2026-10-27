// Service worker: push notifications (also when the site is closed or installed as an app).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: event.data ? event.data.text() : '' }; }
  const title = d.title || 'OSINTFront';
  event.waitUntil((async () => {
    // Tell open pages (they play the site's own chime).
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((c) => c.postMessage({ type: 'push', ...d }));
    await self.registration.showNotification(title, {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      tag: d.tag || undefined,
      renotify: true,
      silent: false, // the device's notification sound
      vibrate: [200, 100, 200],
      data: { url: d.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) return c.navigate(url);
        return;
      }
    }
    return self.clients.openWindow(url);
  })());
});
