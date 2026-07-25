const CACHE_VERSION = '17.3.2';
const CACHE = `minmax-${CACHE_VERSION}`;
const BASE_URL = new URL('./', self.location.href);
const assetUrl = path => new URL(path, BASE_URL).toString();
const STATIC_ASSETS = [
  '',
  'index.html',
  `src/styles.css?v=${CACHE_VERSION}`,
  `src/app.js?v=${CACHE_VERSION}`,
  `program.json?v=${CACHE_VERSION}`,
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png'
].map(assetUrl);
// Only unversioned entry points need to hit the network first. App assets carry a
// ?v= cache-buster in their URL, so serving them cache-first is always correct and
// makes repeat startups instant even on slow connections.
const NETWORK_FIRST = new Set(['', 'index.html', 'program.json', 'manifest.webmanifest', 'sw.js'].map(path => new URL(path, BASE_URL).pathname));

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
    await Promise.all(keys.filter(key => key.startsWith('minmax-') && key !== CACHE).map(key => caches.delete(key)));
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
