// KEEP IN SYNC with APP_VERSION in src/app.js and the ?v= URLs in index.html.
// Deliberately a literal: deriving it from the registration URL (`sw.js?v=`) poisons the
// LIVE cache when the browser's soft update check runs the new SW body under the previous
// registration URL — it would install v-next assets under v-previous cache keys.
const CACHE_VERSION = '17.4.0';
const CACHE = `minmax-${CACHE_VERSION}`;
// Base-relative paths: the app works from a subpath deploy (e.g. GitHub Pages /repo/) too.
const BASE = new URL('./', self.location).pathname;
const CORE_ASSETS = [
  BASE,
  `${BASE}index.html`,
  `${BASE}src/styles.css?v=${CACHE_VERSION}`,
  `${BASE}src/app.js?v=${CACHE_VERSION}`,
  `${BASE}program.json?v=${CACHE_VERSION}`,
  `${BASE}manifest.webmanifest`
];
const OPTIONAL_ASSETS = [
  `${BASE}icons/icon-192.png`,
  `${BASE}icons/icon-512.png`,
  `${BASE}icons/icon-512-maskable.png`
];
// Only unversioned entry points need to hit the network first. App assets carry a
// ?v= cache-buster in their URL, so serving them cache-first is always correct and
// makes repeat startups instant even on slow connections.
const NETWORK_FIRST = new Set([BASE, `${BASE}index.html`, `${BASE}program.json`, `${BASE}manifest.webmanifest`, `${BASE}sw.js`]);
// The Supabase SDK comes from a CDN the page injects on demand; runtime-caching it keeps
// signed-in users signed in when the app starts offline.
const SDK_HOST = 'cdn.jsdelivr.net';

const cacheable = response => response && response.ok && (response.type === 'basic' || response.type === 'cors');

const putInCache = (request, response) => {
  const copy = response.clone();
  caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
};

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(async cache => {
    // cache:'reload' bypasses the HTTP cache so the precached HTML always matches the
    // precached ?v= assets. Core failures reject the install (the old SW keeps serving);
    // icons are best-effort.
    await cache.addAll(CORE_ASSETS.map(u => new Request(u, {cache: 'reload'})));
    await Promise.all(OPTIONAL_ASSETS.map(u => cache.add(new Request(u, {cache: 'reload'})).catch(() => {})));
  }));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    // Start the HTML request in parallel with SW boot on navigations.
    try{ await self.registration.navigationPreload?.enable(); }catch(e){}
    await self.clients.claim();
  })());
});

// Network-first, but when a cached copy exists don't let a flaky connection stall
// startup: abort the fetch after a short timeout and fall back to cache. Navigations
// additionally fall back to the canonical app shell, so any entry URL works offline.
async function networkFirst(event, request){
  const cached = await caches.match(request);
  const budget = cached ? 3500 : 10000;
  try{
    // The preload promise has no timeout of its own — race it against the same budget, or
    // a stalling connection would hang startup past the cached-shell fallback.
    const preload = event.preloadResponse
      ? await Promise.race([event.preloadResponse, new Promise(res => setTimeout(res, budget, undefined))])
      : undefined;
    if(preload){
      if(cacheable(preload)) putInCache(request, preload.clone());
      return preload;
    }
    if(event.preloadResponse && cached) return cached; // preload timed out and we have a shell — don't wait for a second fetch
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);
    const response = await fetch(request, {cache: 'no-store', signal: controller.signal});
    clearTimeout(timer);
    if(cacheable(response)) putInCache(request, response);
    return response;
  }catch(e){
    if(cached) return cached;
    if(request.mode === 'navigate'){
      const shell = await caches.match(`${BASE}index.html`);
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

// Cache-then-refresh for the CDN SDK: serve instantly (or offline) from cache while a
// background fetch keeps the copy current.
async function cacheThenRefresh(request){
  const cached = await caches.match(request);
  const net = fetch(request).then(r => { if(cacheable(r)) putInCache(request, r); return r; }).catch(() => null);
  if(cached) return cached;
  const fresh = await net;
  if(fresh) return fresh;
  throw new Error('offline');
}

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if(url.origin !== self.location.origin){
    if(url.hostname === SDK_HOST && url.pathname.includes('@supabase/supabase-js')){
      event.respondWith(cacheThenRefresh(event.request));
    }
    return; // never intercept other Supabase/CDN traffic
  }
  if(NETWORK_FIRST.has(url.pathname) || event.request.mode === 'navigate'){
    event.respondWith(networkFirst(event, event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});
