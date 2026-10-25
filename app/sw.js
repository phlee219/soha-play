// Offline cache. Bump VERSION when voice clips change (app files refresh from the network).
const VERSION = 'soha-v2';
const CORE = ['./', 'index.html', 'style.css', 'app.js', 'clips.js', 'content.json',
  'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
importScripts('clips.js');

self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(VERSION);
  await cache.addAll(CORE);
  const content = await (await fetch('content.json', { cache: 'no-store' })).json();
  await cache.addAll(clipNames(content).map(n => `audio/${n}.mp3`));
  await self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Voice clips: cache first. App files: network first so updates arrive, cache when offline.
  if (url.pathname.includes('/audio/')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    return;
  }
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
