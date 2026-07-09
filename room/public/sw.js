// Tombstone service worker. The site no longer uses a service worker; this
// exists only to cleanly retire the previous crate PWA on returning visitors.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const c of clients) { try { c.navigate(c.url) } catch (e) {} }
    } catch (e) { /* best effort */ }
  })())
})
