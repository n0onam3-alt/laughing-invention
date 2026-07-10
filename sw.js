const CACHE_VERSION = '17.4.0';
const CACHE = `minmax-${CACHE_VERSION}`;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  `/src/styles.css?v=${CACHE_VERSION}`,
  `/src/app.js?v=${CACHE_VERSION}`,
  `/program.json?v=${CACHE_VERSION}`,
  '/manifest.webmanifest',
  '/icons/icon-192.png?v=2',
  '/icons/icon-512.png?v=2',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];
// Only unversioned entry points need to hit the network first. App assets carry a
// ?v= cache-buster in their URL, so serving them cache-first is always correct and
// makes repeat startups instant even on slow connections.
const NETWORK_FIRST = new Set(['/', '/index.html', '/program.json', '/manifest.webmanifest', '/sw.js']);

const cacheable = response => response && response.ok && (response.type === 'basic' || response.type === 'cors');

const putInCache = (request, response) => {
  const copy = response.clone();
  caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
};

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

// Network-first, but when a cached copy exists don't let a flaky connection stall
// startup: abort the fetch after a short timeout and fall back to cache.
async function networkFirst(request){
  const cached = await caches.match(request);
  try{
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cached ? 3500 : 10000);
    const response = await fetch(request, {cache: 'no-store', signal: controller.signal});
    clearTimeout(timer);
    if(cacheable(response)) putInCache(request, response);
    return response;
  }catch(e){
    if(cached) return cached;
    // Offline navigations with a query string (/?source=pwa) must still get the app shell.
    if(request.mode === 'navigate'){
      const shell = await caches.match(request, {ignoreSearch: true}) || await caches.match('/index.html') || await caches.match('/');
      if(shell) return shell;
    }
    throw e;
  }
}

async function cacheFirst(request){
  const cached = await caches.match(request);
  if(cached) return cached;
  const response = await fetch(request);
  if(cacheable(response)) putInCache(request, response);
  return response;
}

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin) return; // never intercept Supabase/CDN traffic
  if(NETWORK_FIRST.has(url.pathname) || event.request.mode === 'navigate'){
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});
