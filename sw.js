const CACHE_VERSION = '16.0.0-essentials';
const CACHE = `minmax-${CACHE_VERSION}`;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  `/src/styles.css?v=${CACHE_VERSION}`,
  `/src/app.js?v=${CACHE_VERSION}`,
  `/program.json?v=${CACHE_VERSION}`,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];
const NETWORK_FIRST = new Set(['/', '/index.html', '/program.json', '/manifest.webmanifest', '/sw.js']);

const cacheable = response => response && response.ok && (response.type === 'basic' || response.type === 'cors');

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)).catch(() => {}));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return; // never intercept Supabase/CDN traffic
  const networkFirst = NETWORK_FIRST.has(url.pathname) || url.pathname.startsWith('/src/');
  if(networkFirst){
    event.respondWith(fetch(event.request, {cache:'no-store'}).then(response => {
      if(cacheable(response)){
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if(cacheable(response)){
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  })));
});
