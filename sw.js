/* ══════════════════════════════════════════════════════════════
   MapiBiBi Service Worker v4
   Niveau 1 : libs JS/CSS CDN cachées au premier chargement
   Niveau 2 : tuiles carte cachées à la demande (zone visible)
   ══════════════════════════════════════════════════════════════ */

const CACHE_APP   = "mapybibi-app-v4";
const CACHE_TILES = "mapybibi-tiles-v1";
const MAX_TILES   = 2000;

const APP_FILES = [
  "./", "./index.html", "./manifest.json",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

const LIB_FILES = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/togeojson/0.16.0/togeojson.min.js",
  "https://unpkg.com/togpx@0.5.0/togpx.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jquery/1.12.4/jquery.min.js",
  "https://upload.wikimedia.org/wikipedia/commons/e/ec/RedDot.svg",
];

const API_ORIGINS = [
  "nominatim.openstreetmap.org", "overpass-api.de",
  "api.openrouteservice.org", "www.ibpindex.com",
  "supabase.co", "tile.waymarkedtrails.org",
];

const TILE_ORIGINS = ["tile.openstreetmap.org", "tile.thunderforest.com"];

function isTile(url) {
  try { return TILE_ORIGINS.some(h => new URL(url).hostname.includes(h)); } catch(e) { return false; }
}
function isAPI(url) {
  try { return API_ORIGINS.some(h => new URL(url).hostname.includes(h)); } catch(e) { return false; }
}
function isLib(url) {
  return LIB_FILES.some(lib => url.split("?")[0] === lib);
}

/* INSTALL */
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_APP).then(async cache => {
      await cache.addAll(APP_FILES);
      const results = await Promise.allSettled(
        LIB_FILES.map(url => fetch(url, { cache: "no-cache" }).then(r => { if(r.ok) cache.put(url, r); }))
      );
      const ok = results.filter(r => r.status === "fulfilled").length;
      console.log(`[SW v4] Libs: ${ok}/${LIB_FILES.length} cachees`);
    })
  );
  self.skipWaiting();
});

/* ACTIVATE */
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => {
        if (key !== CACHE_APP && key !== CACHE_TILES) return caches.delete(key);
      }))
    ).then(() => self.clients.claim())
  );
});

/* FETCH */
self.addEventListener("fetch", event => {
  const url = event.request.url;
  if (event.request.method !== "GET") return;
  if (isAPI(url)) return;

  if (isTile(url)) {
    event.respondWith(cacheTile(event.request));
    return;
  }
  if (isLib(url)) {
    event.respondWith(
      caches.match(url).then(cached => cached || fetch(event.request).then(r => {
        if (r && r.ok) caches.open(CACHE_APP).then(c => c.put(url, r.clone()));
        return r;
      }).catch(() => new Response("", { status: 503 })))
    );
    return;
  }
  if (url.startsWith(self.location.origin)) {
    event.respondWith(
      caches.match(event.request).then(cached => cached ||
        fetch(event.request).then(r => {
          if (r && r.status === 200) caches.open(CACHE_APP).then(c => c.put(event.request, r.clone()));
          return r;
        }).catch(() => caches.match("./index.html"))
      )
    );
    return;
  }
});

/* Cache tuile individuelle */
async function cacheTile(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (!response || !response.ok) return response;
    const cache = await caches.open(CACHE_TILES);
    const keys  = await cache.keys();
    if (keys.length >= MAX_TILES) await cache.delete(keys[0]);
    cache.put(request, response.clone());
    return response;
  } catch(e) {
    return new Response(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII="),
      { headers: { "Content-Type": "image/png" } }
    );
  }
}

/* MESSAGES */
self.addEventListener("message", async event => {
  const { type, bounds, zoom } = event.data || {};

  if (type === "PRECACHE_TILES") {
    precacheTiles(bounds, zoom, event.source);
    return;
  }
  if (type === "TILES_INFO") {
    const cache = await caches.open(CACHE_TILES);
    const keys  = await cache.keys();
    event.source.postMessage({ type: "TILES_INFO_RESULT", count: keys.length, max: MAX_TILES });
    return;
  }
  if (type === "CLEAR_TILES") {
    await caches.delete(CACHE_TILES);
    event.source.postMessage({ type: "CLEAR_TILES_DONE" });
    return;
  }
});

/* Pré-cache d'une zone géographique */
async function precacheTiles(bounds, maxZoom, client) {
  const { north, south, east, west } = bounds;

  function lon2x(lon, z) { return Math.floor((lon + 180) / 360 * (1 << z)); }
  function lat2y(lat, z) {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z));
  }

  const MIN_Z = 10;
  let total = 0;
  for (let z = MIN_Z; z <= maxZoom; z++) {
    const dx = Math.abs(lon2x(east, z) - lon2x(west, z)) + 1;
    const dy = Math.abs(lat2y(south, z) - lat2y(north, z)) + 1;
    total += dx * dy;
  }

  if (total > 1500) {
    client && client.postMessage({ type: "PRECACHE_ERROR", msg: `Zone trop grande : ${total} tuiles estimées. Réduisez la zone ou le zoom max (actuel : ${maxZoom}).` });
    return;
  }

  client && client.postMessage({ type: "PRECACHE_START", total });

  const cache = await caches.open(CACHE_TILES);
  let fetched = 0, errors = 0;

  for (let z = MIN_Z; z <= maxZoom; z++) {
    const x0 = lon2x(west, z),  x1 = lon2x(east, z);
    const y0 = lat2y(north, z), y1 = lat2y(south, z);
    const yMin = Math.min(y0, y1), yMax = Math.max(y0, y1);
    const xMin = Math.min(x0, x1), xMax = Math.max(x0, x1);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
        try {
          if (!await cache.match(url)) {
            const r = await fetch(url);
            if (r.ok) {
              const keys = await cache.keys();
              if (keys.length >= MAX_TILES) await cache.delete(keys[0]);
              await cache.put(url, r);
            }
          }
          fetched++;
        } catch(e) { errors++; fetched++; }

        if (fetched % 20 === 0) {
          client && client.postMessage({ type: "PRECACHE_PROGRESS", fetched, total, errors });
          await new Promise(r => setTimeout(r, 5));
        }
      }
    }
  }
  client && client.postMessage({ type: "PRECACHE_DONE", fetched, total, errors });
}
