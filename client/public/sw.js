// The service worker a browser wants before it will offer to install a page as
// an app. stickie is a local tool talking to a server on the same machine, so
// there is nothing worth caching and pretending otherwise would serve a stale
// review: every request goes to the network, and this file exists to be
// registered rather than to do anything.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request))
})
