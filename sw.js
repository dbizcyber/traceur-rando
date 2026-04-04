const CACHE_NAME = "mapybibi-pwa-v3";

const FILES_TO_CACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

/* Origines CDN externes — ne jamais intercepter, laisser passer directement */
const CDN_ORIGINS = [
  "cdnjs.cloudflare.com",
  "unpkg.com",
  "code.jquery.com",
  "cdn.jsdelivr.net",
  "tile.openstreetmap.org",
  "tile.thunderforest.com",
  "tile.waymarkedtrails.org",
  "nominatim.openstreetmap.org",
  "overpass-api.de",
  "api.openrouteservice.org",
  "www.ibpindex.com",
  "supabase.co",
  "upload.wikimedia.org"
];

function isCDN(url) {
  try {
    const host = new URL(url).hostname;
    return CDN_ORIGINS.some(cdn => host.includes(cdn));
  } catch(e) { return false; }
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (key !== CACHE_NAME) return caches.delete(key);
      }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const url = event.request.url;

  /* Laisser passer les CDN et API externes sans interception */
  if (isCDN(url) || !url.startsWith(self.location.origin)) {
    return; /* pas de respondWith = comportement réseau normal */
  }

  /* Pour les fichiers locaux : cache-first, fallback réseau */
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match("./index.html"))
  );
});
