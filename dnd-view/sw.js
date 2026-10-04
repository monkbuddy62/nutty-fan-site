// dnd-view/sw.js - cache-first for the tile and library paths (t/<mapHash>/**?r=<rev>, libs/<name-version>/**);
// everything else goes straight to the network (index.html, meta.js, viewer.js, the stale guard's HEAD).
// Registered by viewer.js only on https in a secure context, so it is inert on the live http-only hosts.
// A tile URL is immutable only with its ?r= (the build's content hash, meta.rev): a re-render under the same map
// hash changes r, so the cache can never mix old and new bytes. Bump CACHE with the build number: activate
// deletes every other dnd-view cache.

// === CONFIG ===
const CACHE = "dnd-view-4";          // libs/; each tile version has its own cache, CACHE + "/t/" + version
const CACHE_PREFIX = "dnd-view-";
const TILE_CACHE_PREFIX = CACHE + "/t/";
const SCOPE_PATH = new URL("./", self.location.href).pathname;   // .../dnd-view/
const TILES_PATH = SCOPE_PATH + "t/";
const IMMUTABLE = [TILES_PATH, SCOPE_PATH + "libs/"];

// === LIFECYCLE ===
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(CACHE_PREFIX) && k !== CACHE && !k.startsWith(CACHE + "/")) await caches.delete(k);
    await self.clients.claim();
  })());
});

// === FETCH ===
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !IMMUTABLE.some(p => url.pathname.startsWith(p))) return;
  let name = CACHE;
  if (url.pathname.startsWith(TILES_PATH)) {
    if (!url.searchParams.get("r")) return;      // an unversioned tile URL is not immutable: network only
    name = TILE_CACHE_PREFIX + versionOf(url);
    evictOtherVersions(e, name);
  }
  e.respondWith(cacheFirst(e, req, name));
});

async function cacheFirst(e, req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  // Only a whole, same-origin, successful response is kept: never opaque, never an error or a partial. The write
  // is held by waitUntil so the worker is not stopped before it lands.
  if (res.status === 200 && res.type === "basic") e.waitUntil(cache.put(req, res.clone()).catch(() => {}));
  return res;
}

// === EVICTION ===
// One cache per tile version (t/<hash>/ + r): the first tile request of a worker's life deletes the caches of every
// other version (one map's pyramid is ~38 MB). That is one caches.keys() over cache names, not a scan of every cached
// tile, so a worker restarting mid-session (it does, often) costs nothing a tile's cache.match has to wait behind.
let currentCache = "";

function versionOf(url) {
  const hash = url.pathname.slice(TILES_PATH.length).split("/")[0];
  return hash + "?r=" + (url.searchParams.get("r") || "");
}

function evictOtherVersions(e, name) {
  if (name === currentCache) return;
  currentCache = name;
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(TILE_CACHE_PREFIX) && k !== name) await caches.delete(k);
  })());
}
