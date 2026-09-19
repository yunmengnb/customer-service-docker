// 忆梦云团队开发
const CACHE_PREFIX = 'client-web-'
const CACHE_NAME = `${CACHE_PREFIX}shell-v5`
const APP_SHELL = ['/account', '/', '/favicon.svg', '/pwa-192.png', '/pwa-512.png', '/manifest.webmanifest']
const HASHED_ASSET_PATTERN = /^\/assets\/.*-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|svg|png|jpe?g|gif|webp|ico)$/i

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map(key => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return

  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/account').then(response => response || caches.match('/'))))
    return
  }

  if (HASHED_ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(caches.match(event.request).then(cachedResponse => cachedResponse || fetch(event.request).then(async response => {
      if (response.ok) await caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()))
      return response
    })))
  }
})
