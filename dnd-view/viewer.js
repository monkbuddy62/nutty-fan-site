// dnd-view/viewer.js - the player map viewer. One WebGL canvas (MapLibre GL JS 6.12.0) drawing the
// pre-rendered WebP tile pyramid that map-build/ cuts from FMG. No tile is ever a DOM node: a pinch or a
// drag is a uniform change on the GPU. Geometry (map units, WORLD, zOffset, levels) is the build contract's;
// see specs/dnd-view.md.
//
// Load order (index.html): meta.js (window.DND_META) -> inline script (page-zoom guards, window.DND_CFG, LQIP
// placed at the initial view, window.DND_VIEW0, the first view's tiles fetched) -> inline module
// (window.maplibregl) -> this file (deferred, so it runs after the module in document order).

// === CONFIG ===
const CFG = window.DND_CFG;          // index.html's EARLY script: the constants it shares with this file
const MAX_S = CFG.MAX_S;             // deepest zoom, CSS px per map unit (level 5 is 32 device px/unit)
const VIEW_KEY = CFG.VIEW_KEY;       // localStorage: the last view {map, s, x, y}
const TILE_LOADER = CFG.TILES;       // "worker" (default) | "bitmap" (?bitmap) | "img" (?imgpath): see TILE LOADING
const TILE_PROTOCOL = "dndtile";     // the custom protocol the "bitmap" and "worker" loaders register
const IMAGE_PROTOCOL = "dndimg";     // the same loaders' protocol for the backdrop: decoded off the main thread, never closed
const DECODE_WORKERS = 2;            // "worker" loader: decode threads (a first view decodes ~24 tiles at once)
const DECODE_STALL_MS = 1000;        // a decode worker with work that has said nothing this long (page visible) is replaced:
                                     // iOS may kill a backgrounded page's workers without an event
const DECODE_RESPAWNS = 3;           // replacements in a row (no answer from any of them) before the main thread decodes for
                                     // good: a worker that fails on every start must not loop; one that answers resets it
const FETCH_RETRY_MS = 1000;         // a tile, backdrop or data.json fetch that failed outright (a network blip) is tried
                                     // once more after this: MapLibre never asks for an errored source or tile again
const STILL_FALLBACK_MS = 3000;      // whenStill: no idle this long after a moveend (a source that never loads) counts as still
const TILE_CACHE_TILES = 64;         // MapLibre's out-of-view tile cache (default ~120 on a phone, 1.33 MiB each): a zoom in
                                     // and back out finds the start view still here
const TEXTURE_POOL = 24;             // MapLibre's spare-texture pool (default 50 per size, never shrinks); with the cache
                                     // at 64 the worst case stays near the old 32 + 50
const UPLOADS_MOVING = 1;            // decoded tiles handed to MapLibre (each one a synchronous texture upload + mipmap)
const UPLOADS_STILL = 4;             // per frame while the view moves / while it is still: see UPLOAD PACING
const DECODED_AHEAD_MOVING = 3;      // while the view moves, decodes in flight + decoded tiles waiting for an upload slot
                                     // stay under this: uploads go at UPLOADS_MOVING per frame, so more would be thrown away
const CONTEXT_RESTORE_MS = 3000;     // a lost WebGL context not restored by then reloads the page (when visible)
const HASH_WRITE_MS = 400;           // at most one history.replaceState per this long (iOS caps them)
const HASH_DECIMALS = 2;             // #s/x/y precision
const RASTER_FADE_MS = 0;            // a crisp tile replaces its parent at once: no fade frames in the settle
const BOUNDS_INSET = 1e-3;           // map units; an edge exactly on a tile boundary must not ask for the next tile
const FULL_MAP_URL = "../dnd-map/?edit";
const MAP_FILE_URL = "../dnd-map/rugby.map";
const STALE_NOTE_MS = 1500;          // the "map was updated" note shows this long before the full map opens
const ETAG_RE = /^(?:W\/)?"([0-9a-f]+)-([0-9a-f]+)"$/i; // Pages: W/"<mtime hex>-<byte size hex>"
const PAGES_SERVER = "GitHub.com";   // the ETag is read only from Pages (Express's W/"<size>-<mtime>" is reversed)
const STALE_RELOAD_KEY = "dndView.staleReload"; // sessionStorage: the map size a fresh-meta reload was made for
const SW_URL = "sw.js";
const MAPLIBRE_WORKERS = 1;          // raster tiles never touch MapLibre's workers (they decode on the main thread,
                                     // or in TILE LOADING's own worker); the pool only serves the style. Each worker
                                     // imports maplibre-gl-shared.mjs (148 KB gz) again; Safari would start several.
const QUERY = new URLSearchParams(location.search);
const PERF = QUERY.has("perf");
const PACE_UPLOADS = !QUERY.has("nopace"); // ?nopace: tiles reach MapLibre as soon as decoded (the on-device A/B)
const PERF_HUD_MS = 250;             // the ?perf readout rewrites its text at most this often
const PERF_LONG_FRAME_MS = 34;       // a frame interval past this counts as a dropped frame
const TAP_DELAY_MS = 250;            // a touch tap's card waits this long; a zoom starting first (double-tap) cancels it
const DOUBLE_TAP_MS = 500;           // MapLibre's double-tap rule (TapRecognizer MAX_TAP_INTERVAL): a second tap
const DOUBLE_TAP_PX = 30;            // this soon and this near (MAX_DIST) zooms instead of picking
const TOUCH_CLICK_MS = 800;          // a click this soon after a touchstart came from a finger, not a mouse
const NEAR_PX = 22;                  // no box hit: the burg/marker whose box (label, icon or pin) is nearest, within this many CSS px
const GRID_UNITS = 16;               // tap-data bucket side, map units (~5 cell sites per bucket on rugby.map)
const GRID_SLICE_MS = 8;             // the bucket grid is built in tasks of at most about this long
const RING_PX = 14;                  // highlight ring: inner radius at the picked burg/marker, CSS px
const RING_STROKE_PX = 3;            // its width, outward from RING_PX
const RING_RGB = [1, 0.824, 0.247];  // #ffd23f
const HIT_SCALE = 10;                // data.json hit boxes are map units * 10
const WATER_H = 20;                  // FMG: a cell below this height is water

// === GEOMETRY ===
// A map point (ux, uy) in FMG map units is MercatorCoordinate(ux / WORLD, uy / WORLD).
// MapLibre zoom Z shows s = 2^Z * 512 / WORLD CSS px per map unit.
const META = window.DND_META;
const BASE_URL = new URL("./", location.href).href; // meta paths are relative to dnd-view/
const REV = META && META.rev ? "?r=" + META.rev : ""; // the build's content hash: new bytes, new URLs (caches)
let WORLD = 0, MAP_W = 0, MAP_H = 0;
let minZoom = 0, maxZoom = 0;
let DPR = 1;                         // clamp(devicePixelRatio, 1, 3) at boot: the raster source's tileSize used it

function unitsToLngLat(x, y) { return new maplibregl.MercatorCoordinate(x / WORLD, y / WORLD).toLngLat(); }
function lngLatToUnits(ll) { const m = maplibregl.MercatorCoordinate.fromLngLat(ll); return { x: m.x * WORLD, y: m.y * WORLD }; }
function sToZoom(s) { return Math.log2(s * WORLD / 512); }
function zoomToS(z) { return 2 ** z * 512 / WORLD; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function mapBox() { const el = document.getElementById("map"); return { w: el.clientWidth || innerWidth, h: el.clientHeight || innerHeight }; }
function containS() { const b = mapBox(); return Math.min(b.w / MAP_W, b.h / MAP_H); }
function updateZoomRange() {
  minZoom = Math.max(-2, sToZoom(containS()));   // the whole map fits; -2 is MapLibre's floor
  maxZoom = Math.max(minZoom, sToZoom(MAX_S));
}

// The view centre stays on the map; zoom stays in [whole map, MAX_S]. Replaces MapLibre's Mercator constrain,
// which would forbid zooming out past "the world fills the screen" (a portrait phone could never see the map
// whole). MapLibre calls it 2-3 times per frame while the view moves; it allocates a few small objects each time
// (MercatorCoordinate, the result), and one LngLat more only when it clamps.
function constrainView(lngLat, zoom) {
  const z = clamp(zoom ?? minZoom, minZoom, maxZoom);
  const u = lngLatToUnits(lngLat);
  const x = clamp(u.x, 0, MAP_W), y = clamp(u.y, 0, MAP_H);
  return { center: x === u.x && y === u.y ? lngLat : unitsToLngLat(x, y), zoom: z };
}

// === BOOT ===
let map = null;
let firstIdle = false;
let styleReady = false;              // the style's 'load' fired: sources and layers may be added
const perf = PERF ? createPerf() : null;

function boot() {
  if (!META) return showNote("The quick map is missing its data.", true);
  if (!window.maplibregl) return showNote("This browser can't show the quick map.", true);
  WORLD = META.world; MAP_W = META.width; MAP_H = META.height;
  updateZoomRange();
  const v0 = window.DND_VIEW0 || { s: clamp(1, containS(), Math.max(mapBox().w / MAP_W, mapBox().h / MAP_H)), x: MAP_W / 2, y: MAP_H / 2 };
  const dpr = DPR = clamp(window.devicePixelRatio || 1, 1, 3);
  const nw = unitsToLngLat(BOUNDS_INSET, BOUNDS_INSET), se = unitsToLngLat(MAP_W - BOUNDS_INSET, MAP_H - BOUNDS_INSET);
  const style = {
    version: 8,
    sources: {
      tiles: {
        type: "raster",
        tiles: [tileTemplate()],
        tileSize: META.tileSize / dpr,  // MapLibre then picks z = round(Z + log2 dpr): texels match device px
        minzoom: META.zOffset,
        maxzoom: META.zOffset + META.maxLevel,
        bounds: [nw.lng, se.lat, se.lng, nw.lat],
      },
    },
    // No background layer: the canvas is transparent (alpha, premultiplied) and the page behind it is META.bg, so the
    // picture is the same, without a full-canvas blended fill, a second coveringTiles and ~23 KB of garbage per frame.
    // An opaque canvas (alpha: false) would need it back.
    layers: [
      { id: "tiles", type: "raster", source: "tiles", paint: { "raster-fade-duration": RASTER_FADE_MS } },
    ],
  };
  const c = unitsToLngLat(v0.x, v0.y);
  maplibregl.setWorkerCount(MAPLIBRE_WORKERS);
  installTileLoader();
  try {
    map = new maplibregl.Map({
      container: "map", style, center: [c.lng, c.lat], zoom: clamp(sToZoom(v0.s), minZoom, maxZoom),
      minZoom, maxZoom, maxPitch: 0, pitchWithRotate: false, dragRotate: false, touchPitch: false, rollEnabled: false,
      renderWorldCopies: false, attributionControl: false, fadeDuration: 0, validateStyle: false,
      refreshExpiredTiles: false, transformConstrain: constrainView, maxTileCacheSize: TILE_CACHE_TILES,
      trackResize: false,              // RESIZE below: MapLibre's own resize stops a pinch in progress
      canvasContextAttributes: { antialias: false },
    });
  } catch (e) {
    if (perf) perf.note("map: " + (e && e.name) + " " + (e && e.message));
    return showNote("This device can't draw the quick map (it needs WebGL 2).", true);
  }
  tuneMapLibre();
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  if (matchMedia("(pointer: fine)").matches) map.getCanvas().focus({ preventScroll: true }); // keyboard zoom works at once

  map.on("style.load", onStyleLoad);
  map.on("load", () => { styleReady = true; performance.mark("dnd-map-load"); });
  map.once("idle", onFirstIdle);
  map.on("resize", onResize);
  map.on("moveend", scheduleViewWrite);
  map.on("moveend", flushResize);
  map.on("moveend", pumpDecodes);
  new ResizeObserver(requestResize).observe(map.getContainer());
  followLqip();
  watchContext();
  map.on("click", onMapClick);
  map.on("zoomstart", onZoomStart);
  trackFingers();
  addEventListener("keydown", e => { if (e.key === "Escape") closeCard(); });
  map.on("error", e => { if (perf) perf.error(e); else console.warn("map:", e && e.error && e.error.message); });
  addEventListener("hashchange", onHashChange);
  if (perf) perf.attach(map);
}

// Two MapLibre internals, both re-checked on every MapLibre upgrade (specs/dnd-view.md > Implementation):
// - fadeDuration 0 makes Style._updatePlacement start a full symbol placement on every rendered frame, which builds two
//   CollisionIndex grids (~4,000 empty arrays at 390 x 844) although this style has no symbol layer: half of all
//   per-frame garbage. Once a placement exists (painter.render reads it) and no symbol layer does, it is skipped.
//   The prototype is patched, so a style rebuilt after a WebGL context restore is covered too.
// - Painter.MAX_TEXTURE_POOL_SIZE_PER_BUCKET: spare tile textures kept for reuse (TEXTURE_POOL).
function tuneMapLibre() {
  const P = map.style && Object.getPrototypeOf(map.style), place = P && P._updatePlacement;
  if (typeof place === "function") P._updatePlacement = function (...a) {
    return this.placement && !this._order.some(id => this._layers[id].type === "symbol") ? false : place.apply(this, a);
  };
  else if (perf) perf.note("placement skip not installed (MapLibre changed)");
  const Painter = map.painter && map.painter.constructor;
  if (Painter && typeof Painter.MAX_TEXTURE_POOL_SIZE_PER_BUCKET === "number") Painter.MAX_TEXTURE_POOL_SIZE_PER_BUCKET = TEXTURE_POOL;
  else if (perf) perf.note("texture pool cap not installed (MapLibre changed)");
}

// Every style MapLibre builds: the first, and the one it rebuilds from serialize() after a WebGL context restore (new
// source objects, and no custom layers). The protocol loaders hand over pixels already premultiplied (TILE LOADING),
// so the tile source must not premultiply them again; set before the first tile is asked for (renders come later).
function onStyleLoad() {
  const src = map.getSource("tiles");
  if (TILE_LOADER !== "img") {
    if (src && typeof src.setPremultiplyAlpha === "function") src.setPremultiplyAlpha(false);
    else if (perf) perf.note("setPremultiplyAlpha missing (MapLibre changed): edge tiles premultiplied twice");
  }
  syncRing();
}

function onFirstIdle() {
  firstIdle = true;
  performance.mark("dnd-first-idle");
  CFG.pre = {};                      // preloads MapLibre did not ask for are dropped, and their pre-decoded pixels
  for (const p of PREDECODED.values()) p.then(img => { if (img instanceof ImageBitmap) img.close(); });
  PREDECODED.clear();
  addBackdrop();
  checkStale();
  registerServiceWorker();
  loadTapData().catch(() => {});
  if (perf && TILE_LOADER === "worker") whenStill().then(() => setTimeout(perf.checkWorkerBitmaps, 2000));
}

// The whole map at level 0, under the tiles: a fast fling or a deep zoom-out shows it, never bare background.
// It also stands in below the tiles' minzoom (a 1x or 2x screen zoomed right out). With the protocol loaders it
// comes through IMAGE_PROTOCOL: WebKit decodes createImageBitmap(blob) on the main thread (a 49-79 ms stall at the
// first crisp view in WebKit here), the decode workers do not; their pixels become a main-thread ImageBitmap (2-8 ms
// once, while still). MapLibre keeps that bitmap as the image source's image and uploads it in a later render, so it
// is never closed (after a context restore it asks for the image again).
function addBackdrop() {
  const tl = unitsToLngLat(0, 0), tr = unitsToLngLat(MAP_W, 0), br = unitsToLngLat(MAP_W, MAP_H), bl = unitsToLngLat(0, MAP_H);
  const url = TILE_LOADER === "img" ? BASE_URL + META.backdrop + REV : IMAGE_PROTOCOL + "://" + META.backdrop + REV;
  map.addSource("backdrop", { type: "image", url,
    coordinates: [[tl.lng, tl.lat], [tr.lng, tr.lat], [br.lng, br.lat], [bl.lng, bl.lat]] });
  map.addLayer({ id: "backdrop", type: "raster", source: "backdrop", paint: { "raster-fade-duration": 0 } }, "tiles");
  const onData = e => {
    if (e.sourceId !== "backdrop" || !map.isSourceLoaded("backdrop")) return;
    map.off("sourcedata", onData);
    map.once("render", dropLqip);    // the frame that drew the backdrop; the LQIP goes before it is shown
  };
  map.on("sourcedata", onData);
}

// === LQIP ===
// The blurred whole map that index.html paints before MapLibre exists. It lies under the transparent canvas, so tiles
// land on top of it as they arrive, and it follows the camera: a drag or pinch before the first view is crisp (a fast
// finger on a slow link) moves the picture with it, and a rotation re-places it. One transform per frame, compositor
// only, and only until the backdrop (the same picture, sharper, inside the canvas) is drawn; then it is removed.
let lqip = null, lqipS0 = 0;

function followLqip() {
  lqip = document.getElementById("lqip");
  if (!lqip) return;
  lqipS0 = parseFloat(lqip.style.width) / MAP_W;    // the s it was sized for (EARLY)
  if (!(lqipS0 > 0)) return dropLqip();
  map.on("move", syncLqip);
  syncLqip();                        // MapLibre's container size may differ by a fraction of a px from EARLY's
}

function syncLqip() {
  const p = map.project(unitsToLngLat(0, 0)), k = zoomToS(map.getZoom()) / lqipS0;
  lqip.style.transform = `translate(${p.x}px,${p.y}px) scale(${k})`;
}

function dropLqip() {
  if (map) map.off("move", syncLqip);
  if (lqip) lqip.remove();
  lqip = null;
}

function onResize() {
  updateZoomRange();
  map.setMaxZoom(maxZoom);
  map.setMinZoom(minZoom);
}

// === RESIZE ===
// MapLibre's own trackResize calls map.resize(), which stops the camera: a viewport change mid-pinch (rotation,
// Safari's bottom bar) froze the zoom where it was. Here a resize waits until the view stops moving.
// The observer's first callback (it always fires once on observe) and any callback for a size the canvas already has
// are skipped: map.resize() re-sizes the canvas (clearing its drawing buffer) and fires movestart/moveend, which would
// count as a gesture and write the hash before any input.
let resizePending = false;

function requestResize() {
  if (!map) return;
  if (map.isMoving()) { resizePending = true; return; }
  resizePending = false;
  const el = map.getContainer(), c = map.getCanvas();
  if (Math.floor(el.clientWidth) === c.clientWidth && Math.floor(el.clientHeight) === c.clientHeight) return;
  map.resize();
}

function flushResize() { if (resizePending) requestResize(); }

// === WEBGL CONTEXT ===
// MapLibre restores a lost context itself (442 ms in WebKit, 1.1 s in Chromium here). If iOS drops it and never
// gives it back, the map would sit frozen on its last frame: once the page is visible and CONTEXT_RESTORE_MS
// have passed, a still-lost context reloads the page (the hash keeps the view).
let contextLostAt = 0;

function watchContext() {
  const canvas = map.getCanvas();
  canvas.addEventListener("webglcontextlost", () => {
    contextLostAt = performance.now();
    ringGL = null;                   // its program and buffers went with the context
    if (perf) perf.note("webgl context lost");
    setTimeout(checkContext, CONTEXT_RESTORE_MS);
  });
  canvas.addEventListener("webglcontextrestored", () => { contextLostAt = 0; if (perf) perf.note("webgl context restored"); });
  document.addEventListener("visibilitychange", () => setTimeout(checkContext, CONTEXT_RESTORE_MS));
}

function checkContext() {
  if (!contextLostAt || document.hidden || performance.now() - contextLostAt < CONTEXT_RESTORE_MS) return;
  const gl = map.getCanvas().getContext("webgl2");
  if (gl && !gl.isContextLost()) { contextLostAt = 0; return; }
  if (viewWriteTimer || viewWriteDue) { clearTimeout(viewWriteTimer); writeView(); }
  location.reload();
}

// === TILE LOADING ===
// How a tile's bytes become a texture. MapLibre's default for a plain URL (refreshExpiredTiles: false) is an
// <img> per tile ("img", ?imgpath). "worker" (default) and "bitmap" (?bitmap) register TILE_PROTOCOL and fetch the
// bytes themselves (no Cache-Control reaches MapLibre, so no expiry timers).
// - "worker": DECODE WORKERS turn the bytes into raw premultiplied RGBA, handed to MapLibre as a raw image (rawImage),
//   never as an ImageBitmap: in WebKit a bitmap transferred out of a worker kept its pixels only until that worker
//   made its next image, so tiles drew other tiles' pictures (specs/dnd-view.md > Tile loading). A worker that cannot
//   decode (no OffscreenCanvas, a failed start, too many stalls) hands every later tile to the main thread.
// - "bitmap", and that fallback: createImageBitmap on the main thread, premultiplied. MapLibre uploads it within the
//   same task (RasterTileSource.loadTile right after its await) and never closes it; an unclosed ImageBitmap keeps its
//   decoded pixels until GC (WebKit here: the web process swung up to 1.6 GB before a collection), so it is closed on
//   the next task.
// The tile source is told not to premultiply (onStyleLoad). The hand-off to MapLibre is paced (UPLOAD PACING). Every
// loader takes the EARLY script's preloaded first tiles. specs/dnd-view.md > Tile loading has the measurements.
function tileTemplate() {
  return TILE_LOADER === "img" ? BASE_URL + META.tiles + REV : TILE_PROTOCOL + "://" + META.tiles + REV;
}

// Every URL fetched with this carries ?r=<rev> (the content hash), so a cached copy is never stale: use it without
// asking the server, however old (Pages' max-age=600 would otherwise turn each revisit after 10 minutes into a 304
// round trip, and an offline moment into errored tiles). A cached error (a deploy race) gets one retry from the network;
// a request that failed outright (no response) one more FETCH_RETRY_MS later, unless aborted meanwhile.
function fetchImmutable(url, init) {
  const get = () => fetch(url, { ...init, cache: "force-cache" }).then(r => r.ok ? r : fetch(url, { ...init, cache: "reload" }));
  const signal = init && init.signal;
  return get().catch(e => {
    if (e.name === "AbortError" || (signal && signal.aborted)) throw e;
    return new Promise(r => setTimeout(r, FETCH_RETRY_MS)).then(() => { if (signal && signal.aborted) throw e; return get(); });
  });
}

const PREDECODED = new Map();        // tile path -> Promise<pixels | null>: the "worker" loader's decode of a preload

function tileBytes(rel, signal) {
  const pre = CFG.pre[rel];
  if (pre) { delete CFG.pre[rel]; return pre.catch(() => tileBytes(rel, signal)); }
  return fetchImmutable(BASE_URL + rel, { signal }).then(r => { if (!r.ok) throw new Error("tile HTTP " + r.status); return r.arrayBuffer(); });
}

function installTileLoader() {
  if (TILE_LOADER === "img") return;
  // pm: premultiplied (tiles; the source does not premultiply) or straight (the backdrop's image source does).
  const onMain = (buf, pm) => createImageBitmap(new Blob([buf], { type: "image/webp" }), pm ? { premultiplyAlpha: "premultiply" } : undefined);
  let inWorker = null, pool = [];
  if (TILE_LOADER === "worker") try {
    pool = Array.from({ length: DECODE_WORKERS }, (_, i) => createDecoder(i + 1));
    inWorker = (buf, signal, pm) => pool.reduce((a, b) => b.load() < a.load() ? b : a).decode(buf, signal, pm);
    // Back from the background: iOS may have killed the workers meanwhile (no event), and a dead one would hold every
    // tile for DECODE_STALL_MS. So each is replaced outright on the way back (a worker start, a few ms), not counted
    // as a stall; jobs it held are posted again.
    let away = false;
    const leave = () => { away = true; };
    const back = () => { if (away && !document.hidden) { away = false; for (const d of pool) d.restart(); } };
    document.addEventListener("visibilitychange", () => document.hidden ? leave() : back());
    addEventListener("pagehide", leave);
    addEventListener("pageshow", e => { if (e.persisted) back(); });
  } catch (e) { if (perf) perf.note("decode worker: " + e.message); }
  // Settles when the decoding is over: with the pixels, or null for a tile aborted meanwhile (a worker told to drop it).
  const decode = (buf, signal, pm) => {
    if (!inWorker) return onMain(buf, pm);
    return inWorker(buf, signal, pm).catch(e => {   // the decoder posts a copy, so buf is still whole here
      if (signal.aborted) throw e;
      if (perf && inWorker) perf.note("decode worker failed, main thread from now: " + e.message);
      inWorker = null;
      for (const d of pool) d.stop();
      return onMain(buf, pm);
    });
  };
  const aborted = () => new DOMException("tile aborted", "AbortError");
  // The first view's tiles (EARLY's preloads) go to the decode workers as their bytes arrive, during MapLibre's own
  // start-up, instead of when MapLibre asks for them (160-370 ms after the bytes were in, WebKit here): first crisp
  // view ~100 ms sooner in WebKit, no change in Chromium. MapLibre then takes the pixels straight to an upload slot.
  // A failed pre-decode takes the normal path; what MapLibre never asks for is dropped at the first idle.
  if (inWorker) {
    const never = new AbortController().signal;
    for (const rel of Object.keys(CFG.pre)) {
      const bytes = CFG.pre[rel];
      delete CFG.pre[rel];
      PREDECODED.set(rel, bytes.then(buf => decode(buf, never, true)).catch(() => null));
    }
  }
  maplibregl.addProtocol(TILE_PROTOCOL, (params, ac) => {
    const rel = params.url.slice(TILE_PROTOCOL.length + 3), z = +(TILE_Z_RE.exec(rel) || [0, -1])[1], signal = ac.signal;
    // Decoded pixels -> an upload slot (UPLOAD PACING) -> MapLibre's upload. done() gives the decode slot back once the
    // tile is in the upload queue (or dropped), so the two queues are counted together.
    const decoded = (img, done) => {
      const bmp = img instanceof ImageBitmap ? img : null;
      if (!img || signal.aborted) { if (bmp) bmp.close(); done(); throw aborted(); }
      const slot = uploadSlot(z, signal);
      done();
      return slot.then(() => {
        if (signal.aborted) { if (bmp) bmp.close(); throw aborted(); }
        if (!bmp) return { data: rawImage(img) };
        setTimeout(() => bmp.close(), 0);        // after MapLibre's upload, which runs in this task's microtasks
        return { data: bmp };
      });
    };
    // bytes -> a decode slot (DECODE PACING) -> decode -> decoded().
    const fresh = () => tileBytes(rel, signal).then(buf => decodeSlot(z, signal).then(() => decode(buf, signal, true)
      .then(img => decoded(img, decodeDone), e => { decodeDone(); throw e; })));
    const pre = PREDECODED.get(rel);
    if (!pre) return fresh();
    PREDECODED.delete(rel);
    return pre.then(img => img ? decoded(img, () => {}) : fresh());
  });
  // The backdrop: the same fetch and decode, straight alpha; handed over only while the view is still (its 1600 x 731
  // upload is the largest single one) as a main-thread ImageBitmap, never closed (addBackdrop).
  maplibregl.addProtocol(IMAGE_PROTOCOL, (params, ac) => {
    const rel = params.url.slice(IMAGE_PROTOCOL.length + 3);
    return fetchImmutable(BASE_URL + rel, { signal: ac.signal })
      .then(r => { if (!r.ok) throw new Error("image HTTP " + r.status); return r.arrayBuffer(); })
      .then(buf => decode(buf, ac.signal, false))
      .then(img => {
        if (!img) throw aborted();
        return whenStill().then(() => img instanceof ImageBitmap ? img : createImageBitmap(new ImageData(new Uint8ClampedArray(img.px), img.w, img.h)));
      })
      .then(bmp => ({ data: bmp }));
  });
}

// A decode worker's pixels as an image MapLibre uploads as is. Its image request passes through only an ImageBitmap or
// an HTMLImageElement (anything else is taken for encoded bytes), and its Texture uploads any object with a `data`
// field as raw pixels (texSubImage2D from the array, premultiplied by MapLibre only if the source asks). So: an object
// on HTMLImageElement's prototype, with its own width, height and data. A MapLibre internal (Implementation).
function rawImage(r) {
  return Object.create(HTMLImageElement.prototype, {
    width: { value: r.w }, height: { value: r.h }, data: { value: new Uint8Array(r.px) },
  });
}

// === FINGERS ===
// A finger on the map counts as moving for everything paced on it (busy()). A touch that catches a moving map (a
// fling's inertia, an ease) makes MapLibre stop the camera: 'moveend' fires at once with isMoving() false, and
// 'movestart' only once the finger passes the pan tolerance, 2 frames later. In between the view read as still, so
// the moveend released the whole paced decode queue (2-17 decodes posted), uploads went UPLOADS_STILL per frame and
// the view was written, all in the frames before the drag (round-4 hunter, both engines). Counted from the touches
// that began inside the map (a finger on the card is not one); the last one lifting from a map that is not moving
// lets the held work go at once. The cost: a finger resting on a still map sharpens at UPLOADS_MOVING per frame.
let fingers = 0;

function busy() { return fingers > 0 || map.isMoving(); }

function trackFingers() {
  const el = map.getCanvasContainer(), opt = { passive: true, capture: true };   // capture: before MapLibre's handlers
  const count = e => { let k = 0; for (let i = 0; i < e.touches.length; i++) if (el.contains(e.touches[i].target)) k++; fingers = k; };
  el.addEventListener("touchstart", e => { lastTouch = e.timeStamp; count(e); }, opt);
  const up = e => { count(e); if (!fingers && !map.isMoving()) onFingersOff(); };
  el.addEventListener("touchend", up, opt);
  el.addEventListener("touchcancel", up, opt);
  document.addEventListener("visibilitychange", () => { if (document.hidden) fingers = 0; });   // a lost touchend
}

// The last finger left a map that is not moving (a catch with no drag, a tap, a finger that rested). A finger that
// dragged ends in MapLibre's own moveend, which does the same.
function onFingersOff() {
  if (decodeQueue.length) pumpDecodes();
  if (uploadQueue.length) armUploadFrame();
  if (stillWaiters.length) checkStill();
  if (viewWriteDue) scheduleViewWrite();
}

// === UPLOAD PACING ===
// MapLibre uploads a raster tile (texStorage2D + texSubImage2D + generateMipmap, all synchronous on the main thread)
// in the continuation of the promise the protocol returns, with no per-frame cap: its request throttle limits
// fetches in flight, not uploads. The decode workers answer in clusters, so a zoom crossing a level landed 5-19
// uploads in one frame (Chromium here), and a zoom-out's settle 3-7 in one frame interval (WebKit). So each decoded
// tile waits for a slot: while the view moves (or a finger is on it: FINGERS), UPLOADS_MOVING per frame, released by a task posted from
// requestAnimationFrame (it runs after that frame is drawn, so the upload has the most time before the next one);
// while still, up to UPLOADS_STILL per frame at once. The first view (until the first idle, nothing moving) is not
// capped: nothing animates yet, and the crisp view is what is waited for. Tiles of the level MapLibre is drawing go
// first; a tile aborted while waiting (a level zoomed through) frees its slot and is never uploaded.
const TILE_Z_RE = /(?:^|\/)(\d+)\/\d+\/\d+\.webp/;
const uploadQueue = [];              // {z, signal, go} in arrival order
let uploadsThisFrame = 0, uploadFrame = 0;
const uploadPort = new MessageChannel();
uploadPort.port1.onmessage = releaseUploads;

function uploadsPerFrame() { return busy() ? UPLOADS_MOVING : firstIdle ? UPLOADS_STILL : Infinity; }

function uploadSlot(z, signal) {
  if (!map || !PACE_UPLOADS) return Promise.resolve();
  if (!uploadQueue.length && !busy() && uploadsThisFrame < uploadsPerFrame()) { uploadsThisFrame++; armUploadFrame(); return Promise.resolve(); }
  return new Promise(go => { uploadQueue.push({ z, signal, go }); armUploadFrame(); });
}

function armUploadFrame() { if (!uploadFrame) uploadFrame = requestAnimationFrame(onUploadFrame); }

function onUploadFrame() {
  uploadFrame = 0;
  uploadsThisFrame = 0;
  if (uploadQueue.length) uploadPort.port2.postMessage(0);
}

function releaseUploads() {
  const cap = uploadsPerFrame(), zNow = levelNow() + META.zOffset;
  for (let j = uploadQueue.length - 1; j >= 0; j--) if (uploadQueue[j].signal.aborted) uploadQueue.splice(j, 1)[0].go();
  while (uploadsThisFrame < cap && uploadQueue.length) {
    const j = Math.max(0, uploadQueue.findIndex(q => q.z === zNow));
    uploadQueue.splice(j, 1)[0].go();
    uploadsThisFrame++;
  }
  if (uploadQueue.length || uploadsThisFrame) armUploadFrame();
  if (decodeQueue.length) pumpDecodes();
}

// === DECODE PACING ===
// A decode is 1 MiB of pixels coming back to the main thread (and garbage once uploaded). Started as soon as its bytes
// arrived, a fast zoom (bytes from the HTTP cache) decoded 2-3x the tiles it uploaded: uploads go at UPLOADS_MOVING
// per frame while moving, the decoded tiles waited for a slot, and MapLibre aborted the levels zoomed through before
// they got one (WebKit here: 228 decoded / 75 uploaded over six fast zooms; a 1.5 s ease from the whole map to s 20
// posted 33-38 decodes, 24-32 of them for tiles already aborted, so the final level's decodes waited 0.4-1.2 s behind
// them). So while the view moves (or a finger is on it), a tile waits with its compressed bytes (20-30 KB) for a decode slot: decodes in
// flight plus decoded tiles waiting for an upload stay under DECODED_AHEAD_MOVING. Tiles of the level being drawn go
// first; a tile aborted while it waits never reaches a worker, and a worker drops one aborted mid-decode (DECODE
// WORKERS). While the view is still nothing waits: those tiles are all wanted, and a cap of 2 per worker made the first
// crisp view ~210 ms later in Chromium (its workers decode several images at once).
const decodeQueue = [];              // {z, signal, go, stop} in arrival order
let decoding = 0;

function decodeSlot(z, signal) {
  if (!map || !PACE_UPLOADS) { decoding++; return Promise.resolve(); }
  return new Promise((go, stop) => {
    decodeQueue.push({ z, signal, go, stop });
    signal.addEventListener("abort", pumpDecodes, { once: true });
    pumpDecodes();
  });
}

function decodeDone() { decoding--; if (decodeQueue.length) pumpDecodes(); }

function pumpDecodes() {
  for (let j = decodeQueue.length - 1; j >= 0; j--) {
    if (decodeQueue[j].signal.aborted) decodeQueue.splice(j, 1)[0].stop(new DOMException("tile aborted", "AbortError"));
  }
  if (!decodeQueue.length) return;
  const ahead = busy() ? DECODED_AHEAD_MOVING : Infinity;
  const zNow = levelNow() + META.zOffset;
  while (decodeQueue.length && decoding + uploadQueue.length < ahead) {
    const j = Math.max(0, decodeQueue.findIndex(q => q.z === zNow));
    decoding++;
    decodeQueue.splice(j, 1)[0].go();
  }
}

// Resolves at once while the view is still (busy() false); else, once it has stopped and the tile layer has its tiles (checked
// at moveend and after each render), in a task of its own after that render; a tap releases every waiter at once
// (TAPS: DATA). Not MapLibre's 'idle': it waits for every source, and the backdrop, which itself waits here, is one,
// so a gesture started before the backdrop arrived held both off until a fallback ran out (3 s after moveend, WebKit
// here). STILL_FALLBACK_MS after a moveend with the view still stopped counts as still too (tiles that never load).
let stillWaiters = [], stillTimer = 0;
function whenStill() {
  if (!map || !busy()) return Promise.resolve();
  return new Promise(go => {
    if (!stillWaiters.length) {
      map.on("render", checkStill); map.on("moveend", checkStill);
      if (map.isMoving()) map.once("moveend", armStillFallback); else armStillFallback();   // else: only a finger down
    }
    stillWaiters.push(go);
  });
}
function checkStill() {
  if (stillTimer || busy() || !map.isSourceLoaded("tiles")) return;
  stillTimer = setTimeout(() => { stillTimer = 0; if (!busy()) releaseStill(); }, 0);
}
function releaseStill() {
  map.off("render", checkStill); map.off("moveend", checkStill);
  const w = stillWaiters; stillWaiters = []; for (const go of w) go();
}
function armStillFallback() {
  setTimeout(() => {
    if (!stillWaiters.length) return;
    if (map.isMoving()) map.once("moveend", armStillFallback); else if (fingers) armStillFallback(); else releaseStill();
  }, STILL_FALLBACK_MS);
}

// === DECODE WORKERS ===
// One worker: webp bytes in (transferred), raw RGBA out (transferred): decoded, drawn on an OffscreenCanvas, read
// back, premultiplied if asked (only edge tiles have alpha). Never an ImageBitmap: WebKit reused a transferred bitmap's
// pixels for that worker's next image (Tile loading). The page keeps each job's bytes until it is answered.
// iOS may terminate a backgrounded page's workers with no event (WebKit bug 211018, MapLibre #8461); a dead worker
// takes messages and never answers, and every tile after it would stay loading. So a worker that has work and has
// said nothing for DECODE_STALL_MS while the page is visible is replaced and its jobs posted again; past
// DECODE_RESPAWNS replacements in a row with no answer between them, its jobs fail and decode() moves to the main
// thread (any answer resets the count: separate background kills hours apart are not a crash loop). Coming back to
// the page replaces every worker (restart, uncounted). A watchdog timer that itself ran late (a busy main thread:
// answers may be queued behind it) only re-arms.
// A tile MapLibre aborts mid-decode is cancelled ({cancel: id}): the worker skips the draw, the read-back and the 1 MiB
// transfer and answers with no pixels. Every job is answered exactly once, so the page knows what a worker still holds
// (load(), DECODE PACING's in-flight count).
const DECODE_SRC = "let c=null,g=null;const live=new Set(),cut=new Set();onmessage=async e=>{const{id,buf,pm,cancel}=e.data;" +
  "if(cancel){if(live.has(cancel))cut.add(cancel);return}if(!buf)return postMessage({id});live.add(id);try{" +
  "const b=await createImageBitmap(new Blob([buf],{type:'image/webp'})),w=b.width,h=b.height;" +
  "if(cut.has(id)){b.close();return postMessage({id})}" +
  "if(!c){c=new OffscreenCanvas(w,h);g=c.getContext('2d',{willReadFrequently:true})}" +
  "else if(c.width!==w||c.height!==h){c.width=w;c.height=h}else g.clearRect(0,0,w,h);" +
  "g.drawImage(b,0,0);b.close();const d=g.getImageData(0,0,w,h).data;" +
  "if(pm)for(let i=3;i<d.length;i+=4){const a=d[i];if(a<255){d[i-3]=d[i-3]*a/255;d[i-2]=d[i-2]*a/255;d[i-1]=d[i-1]*a/255}}" +
  "postMessage({id,w,h,px:d.buffer},[d.buffer])}catch(err){postMessage({id,err:String(err)})}finally{live.delete(id);cut.delete(id)}}";
let decodeURL = "";

function createDecoder(n) {
  decodeURL ||= URL.createObjectURL(new Blob([DECODE_SRC], { type: "text/javascript" }));
  const jobs = new Map();                        // id -> {buf, pm, resolve, reject, cut}: posted, not yet answered; cut
                                                 // once its tile was aborted
  let w = null, seq = 0, heard = 0, timer = 0, respawns = 0, dead = false;
  const post = (id, j) => { const copy = j.buf && j.buf.slice(0); w.postMessage({ id, buf: copy, pm: j.pm }, copy ? [copy] : []); };
  const stop = why => {
    dead = true; clearTimeout(timer); timer = 0;
    if (w) { w.onmessage = w.onerror = null; w.terminate(); }
    for (const j of jobs.values()) j.reject(new Error(why));
    jobs.clear();
  };
  const start = () => {
    w = new Worker(decodeURL);
    w.onerror = () => stop("worker error");   // failed to start; the source catches everything else
    w.onmessage = e => {
      heard = performance.now();
      respawns = 0;                              // it answers: a later stall is a new failure, not this one again
      const j = jobs.get(e.data.id);
      if (!j) return;                            // a job of a worker replaced meanwhile
      jobs.delete(e.data.id);
      if (j.cut) j.resolve(null);
      else if (e.data.err) j.reject(new Error(e.data.err));
      else j.resolve(e.data.px ? e.data : null);
    };
  };
  const watch = () => {
    if (timer || dead || !jobs.size) return;
    const due = performance.now() + DECODE_STALL_MS;
    timer = setTimeout(() => {
      timer = 0;
      const now = performance.now();
      if (dead || !jobs.size) return;
      if (document.hidden || now - due > 250 || now - heard < DECODE_STALL_MS) return watch();
      if (++respawns > DECODE_RESPAWNS) return stop("decode worker stalled " + respawns + " times");
      if (perf) perf.note(`decode worker ${n} replaced: silent ${(now - heard).toFixed(0)} ms with ${jobs.size} jobs`);
      replace();
    }, DECODE_STALL_MS);
  };
  // A new worker from the same blob URL, given every job the old one held (a cut job is answered here instead).
  // probe (?perf, on the way back from the background): ask the old worker once before it goes, and note whether it
  // answered, which is how the device tells whether iOS really kills them.
  const replace = probe => {
    w.onmessage = w.onerror = null;
    if (probe) {
      const old = w, t = setTimeout(() => { old.terminate(); perf.note(`decode worker ${n} dead on return`); }, DECODE_STALL_MS);
      old.onmessage = () => { clearTimeout(t); old.onmessage = null; old.terminate(); perf.note(`decode worker ${n} alive on return`); };
      old.postMessage({ id: 0 });
    } else w.terminate();
    start();
    heard = performance.now();
    for (const [id, j] of jobs) if (j.cut) { jobs.delete(id); j.resolve(null); } else post(id, j);
    watch();
  };
  const add = (j, signal) => {
    if (signal && signal.aborted) return j.resolve(null);
    const id = ++seq;
    if (!jobs.size) heard = performance.now();   // the silence is counted from the first job of a busy spell
    jobs.set(id, j);
    if (signal) signal.addEventListener("abort", () => { if (jobs.has(id) && !j.cut) { j.cut = true; w.postMessage({ cancel: id }); } }, { once: true });
    post(id, j);
    watch();
  };
  start();
  return {
    decode: (buf, signal, pm) => new Promise((resolve, reject) => dead ? reject(new Error("worker error")) : add({ buf, pm, resolve, reject }, signal)),
    restart: () => { if (!dead) replace(!!perf); },
    load: () => dead ? Infinity : jobs.size,
    stop: () => { if (!dead) stop("decoding moved to the main thread"); },
  };
}

// === VIEW: HASH + LAST VIEW ===
let viewWriteTimer = 0, lastViewWrite = 0, viewWriteDue = false;   // due: the timer found a gesture under way

function currentView() {
  const u = lngLatToUnits(map.getCenter());
  return { s: zoomToS(map.getZoom()), x: u.x, y: u.y };
}

// At most one write per HASH_WRITE_MS, and never while a finger is down or the view moves (a next stroke started
// within HASH_WRITE_MS of the last one's end): it waits for that gesture's end (its moveend, or onFingersOff).
function scheduleViewWrite() {
  if (viewWriteTimer) return;
  const wait = Math.max(0, lastViewWrite + HASH_WRITE_MS - performance.now());
  viewWriteTimer = setTimeout(() => { viewWriteTimer = 0; if (busy()) viewWriteDue = true; else writeView(); }, wait);
}

function writeView() {
  viewWriteTimer = 0;
  viewWriteDue = false;
  lastViewWrite = performance.now();
  const v = currentView(), d = HASH_DECIMALS;
  v.x = clamp(v.x, 0, MAP_W); v.y = clamp(v.y, 0, MAP_H);   // float noise must not write "-0.00"
  const f = n => (Math.abs(n) < 0.5 * 10 ** -d ? 0 : n).toFixed(d);
  const hash = "#" + f(v.s) + "/" + f(v.x) + "/" + f(v.y);
  if (hash !== location.hash) history.replaceState(history.state, "", location.pathname + location.search + hash);
  try { localStorage.setItem(VIEW_KEY, JSON.stringify({ map: META.mapHash, s: v.s, x: v.x, y: v.y })); } catch (e) { /* private mode */ }
}

function onHashChange() {
  const v = CFG.parseHash(location.hash);   // the EARLY script's parser: s > 0, all three finite
  if (!v || !map) return;
  const c = unitsToLngLat(clamp(v.x, 0, MAP_W), clamp(v.y, 0, MAP_H));
  map.jumpTo({ center: c, zoom: clamp(sToZoom(v.s), minZoom, maxZoom) });
}

// === TAPS: DATA ===
// data.json (cells, names, burgs, markers, per-level hit boxes) loads after the first crisp view, at low
// priority, or at once on a tap that beats it. Its parse (one task, 3-14 ms) and each slice of the bucket grid (at
// most GRID_SLICE_MS) wait while the view moves (whenStill), unless a tap is waiting for them (tapWaiting). The
// nearest site in the grid is FMG's findCell.
let tapData = null, tapDataPromise = null, tapWaiting = false;
const tapLoad = { parseMs: 0, slices: [], gridMs: 0 };   // measured; the ?perf HUD shows it

function loadTapData() {
  if (!tapDataPromise) {
    tapDataPromise = fetchImmutable(BASE_URL + META.data + REV, { priority: "low" })
      .then(r => { if (!r.ok) throw new Error("data.json HTTP " + r.status); return r.text(); })
      .then(text => tapStill().then(() => text))
      .then(text => { const t0 = performance.now(); const d = JSON.parse(text); tapLoad.parseMs = performance.now() - t0; return d; })
      .then(prepareTapData)
      .then(d => {
        tapData = d;
        if (perf) perf.note(`tap data: parse ${tapLoad.parseMs.toFixed(1)} ms, grid ${tapLoad.slices.length} slices, worst ${Math.max(...tapLoad.slices).toFixed(1)} ms`);
        return d;
      });
    tapDataPromise.catch(e => { tapDataPromise = null; if (perf) perf.note("tap data: " + e.message); });
  }
  return tapDataPromise;
}

const nextTask = () => new Promise(r => setTimeout(r, 0));
const tapStill = () => tapWaiting ? Promise.resolve() : whenStill();

async function prepareTapData(d) {
  const c = d.cells, N = c.n, k = c.scale || 10, G = GRID_UNITS * k;
  const cols = Math.ceil(MAP_W * k / G) + 1, rows = Math.ceil(MAP_H * k / G) + 1;
  const bucket = new Int32Array(N), start = new Int32Array(cols * rows + 1), order = new Int32Array(N);
  const bx = v => clamp(Math.floor(v / G), 0, cols - 1), by = v => clamp(Math.floor(v / G), 0, rows - 1);
  // Three passes (bucket of each site, counts -> offsets, fill), each resumable, sliced on the clock.
  let t = performance.now(), i = 0, pass = 0;
  const slice = async () => { const now = performance.now(); if (now - t < GRID_SLICE_MS) return; tapLoad.slices.push(now - t); await nextTask(); await tapStill(); t = performance.now(); };
  for (; i < N; i++) { const b = by(c.y[i]) * cols + bx(c.x[i]); bucket[i] = b; start[b + 1]++; if ((i & 1023) === 1023) await slice(); }
  for (let b = 0; b < cols * rows; b++) start[b + 1] += start[b];
  const fill = start.slice(0, cols * rows);
  for (i = 0; i < N; i++) { order[fill[bucket[i]]++] = i; if ((i & 1023) === 1023) await slice(); }
  tapLoad.slices.push(performance.now() - t);
  tapLoad.gridMs = tapLoad.slices.reduce((a, b) => a + b, 0);
  d.grid = { k, G, cols, rows, start, order };
  d.markerById = new Map(d.markers.map(m => [m.i, m]));
  d.riverById = new Map(d.rivers.map(r => [r.i, r]));
  return d;
}

// Nearest cell site to map point (ux, uy): FMG's findCell. Ring search outward from the point's bucket; stop
// once the examined square's nearest edge is farther than the best site.
function nearestCell(ux, uy) {
  const { k, G, cols, rows, start, order } = tapData.grid, cx = tapData.cells.x, cy = tapData.cells.y;
  const px = ux * k, py = uy * k;
  const bx = clamp(Math.floor(px / G), 0, cols - 1), by = clamp(Math.floor(py / G), 0, rows - 1);
  let best = -1, bd = Infinity;
  const visit = (x, y) => {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return;
    const b = y * cols + x;
    for (let j = start[b]; j < start[b + 1]; j++) {
      const i = order[j], dx = cx[i] - px, dy = cy[i] - py, dd = dx * dx + dy * dy;
      if (dd < bd || (dd === bd && i < best)) { bd = dd; best = i; }
    }
  };
  for (let r = 0; r <= cols + rows; r++) {
    const x0 = bx - r, x1 = bx + r, y0 = by - r, y1 = by + r;
    for (let x = x0; x <= x1; x++) { visit(x, y0); if (r) visit(x, y1); }
    for (let y = y0 + 1; y < y1; y++) { visit(x0, y); visit(x1, y); }
    const edge = Math.min(px - x0 * G, (x1 + 1) * G - px, py - y0 * G, (y1 + 1) * G - py);
    if (best >= 0 && edge > 0 && bd <= edge * edge) break;
  }
  return best;
}

// What MapLibre is drawing now: the level its covering rule picked (tileSize = 512 / DPR).
function levelNow() { return clamp(Math.round(map.getZoom() + Math.log2(DPR)) - META.zOffset, 0, META.maxLevel); }

// FMG's order: the topmost burg label/icon or marker box at the point, else the burg or marker shown at this level
// whose nearest box edge is within NEAR_PX, else the cell (water or land). Distance is to the boxes, not the site:
// a label sits to one side of its burg, so a tap just off a label's edge can be nearer another burg's site (3 of 8
// such misses picked a neighbour). Returns {kind:"burg"|"marker"|"lake"|"area"|"ocean", ...}.
function pickAt(ux, uy, s, n) {
  const D = tapData, hx = ux * HIT_SCALE, hy = uy * HIT_SCALE, hits = D.hits[n] || [];
  for (let j = hits.length - 1; j >= 0; j--) {
    const h = hits[j];
    if (hx >= h[2] && hx <= h[4] && hy >= h[3] && hy <= h[5] && (!h[0] || inPin(h, hx, hy))) return pickOf(h[0], h[1], "box");
  }
  let best = null, bd = (NEAR_PX / s * HIT_SCALE) ** 2;
  for (const h of hits) {                        // forward, "<=": of equal distances the topmost wins
    const dx = Math.max(h[2] - hx, 0, hx - h[4]), dy = Math.max(h[3] - hy, 0, hy - h[5]), dd = dx * dx + dy * dy;
    if (dd <= bd && (h[0] ? D.markerById.has(h[1]) : D.burgs[h[1]])) { bd = dd; best = h; }
  }
  if (best) return pickOf(best[0], best[1], "near");
  if (ux < 0 || uy < 0 || ux > MAP_W || uy > MAP_H) return { kind: "ocean", cell: -1 };   // off the map
  const cell = nearestCell(ux, uy), f = D.features[D.cells.f[cell]];
  if (f && f.type === "lake") return { kind: "lake", cell, feature: f };
  if (D.cells.h[cell] < WATER_H || (f && f.type === "ocean")) return { kind: "ocean", cell };
  return { kind: "area", cell };
}

// A marker's box is its pin's bounding box (FMG's bubble: a round head over a point); the corners are empty and
// FMG's own hit test falls through them to what lies below. The ellipse inscribed in the box stands in for the pin.
function inPin(h, hx, hy) {
  const rx = (h[4] - h[2]) / 2, ry = (h[5] - h[3]) / 2, dx = (hx - h[2] - rx) / rx, dy = (hy - h[3] - ry) / ry;
  return dx * dx + dy * dy <= 1;
}

function pickOf(kind, id, how) {
  return kind ? { kind: "marker", id, how, item: tapData.markerById.get(id) } : { kind: "burg", id, how, item: tapData.burgs[id] };
}

// === TAPS: GESTURES ===
// A finger's card waits TAP_DELAY_MS; a zoom starting first (double-tap, pinch, keys) drops it. MapLibre starts a
// double-tap zoom only on its next render frame, and browsers may or may not fire 'click' for the second tap, so
// two more rules key off the touches themselves (MapLibre's own double-tap rule: DOUBLE_TAP_MS, DOUBLE_TAP_PX):
// a second tap's click shows nothing, and a zoom whose touch began within DOUBLE_TAP_MS of a card's tap closes
// that card (a slow double-tap). Times are event timestamps, as MapLibre's: a busy main thread dispatches late,
// not apart. A mouse click shows its card at once.
let lastTouch = -1e9, tapSeq = 0, cardTapAt = -1e9, lastTap = null;

function onMapClick(e) {
  const u = lngLatToUnits(e.lngLat);
  onMapTap(u.x, u.y, e.point.x, e.point.y, zoomToS(map.getZoom()), e.originalEvent ? e.originalEvent.timeStamp : performance.now());
}

function onMapTap(ux, uy, px, py, s, now) {
  const touch = now - lastTouch < TOUCH_CLICK_MS;
  const seq = ++tapSeq;
  if (touch) {
    const prev = lastTap;
    lastTap = { t: now, px, py };
    if (map.isZooming() || (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(px - prev.px, py - prev.py) < DOUBLE_TAP_PX)) {
      lastTap = null;                            // the second tap of a double-tap: MapLibre zooms, no card
      if (prev && cardTapAt === prev.t) closeCard();
      return;
    }
  }
  const n = levelNow();
  const wait = touch ? new Promise(r => setTimeout(r, TAP_DELAY_MS)) : null;
  if (!tapData) { tapWaiting = true; releaseStill(); }   // the data is wanted now: no more waiting for a still view
  Promise.all([tapData || loadTapData(), wait]).then(() => {
    if (seq !== tapSeq) return;                  // cancelled by a zoom, a second tap, or a newer tap
    showPick(pickAt(ux, uy, s, n));
    cardTapAt = touch ? now : -1e9;
  }, () => {});
}

function onZoomStart() {
  tapSeq++;                                      // a pending card is dropped
  if (lastTouch > cardTapAt && lastTouch - cardTapAt < DOUBLE_TAP_MS) closeCard();   // a slow double-tap's first card
}

// === TAPS: CARD ===
// One element, built once; content is textContent only (names and notes are data, never markup). A bottom sheet
// on a narrow screen, a small panel top-left on a wide one (viewer.css). It sits beside #map, so it never takes a
// gesture outside its own box and never resizes the canvas.
let card = null, cardBody = null;
const DEC = new Intl.NumberFormat("en-US");

function ensureCard() {
  if (card) return;
  card = document.createElement("div");
  card.id = "card";
  card.setAttribute("role", "dialog");
  card.hidden = true;
  const x = document.createElement("button");
  x.type = "button"; x.className = "x"; x.setAttribute("aria-label", "Close"); x.textContent = "\u00d7";
  x.addEventListener("click", closeCard);
  cardBody = document.createElement("div");
  card.append(x, cardBody);
  document.body.append(card);
}

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function nameOf(list, i) { const o = list[i]; return o ? o.name : ""; }
function stateLabel(i) { const st = tapData.states[i]; return i && st ? st.fullName || st.name : "No state"; }
function title(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
function humanType(t) { return title(String(t || "").replace(/[_-]+/g, " ")); }
function htmlToText(h) { return h ? new DOMParser().parseFromString(h, "text/html").body.textContent.trim() : ""; }

function showPick(p) {
  if (p.kind === "ocean") return closeCard();
  ensureCard();
  const D = tapData, rows = [];
  let head = "", sub = "", link = "", ring = null;
  if (p.kind === "burg") {
    const b = p.item, cell = nearestCell(b.x, b.y);
    head = b.name;
    sub = b.capital ? "Capital of " + (nameOf(D.states, b.state) || "no state") : title(b.group) + " (" + b.type + ")";
    rows.push(["Population", DEC.format(b.population)], ["Culture", nameOf(D.cultures, b.culture)], ["State", stateLabel(b.state)]);
    const prov = D.provinces[D.cells.province[cell]];
    if (prov) rows.push(["Province", prov.fullName || prov.name]);
    link = b.link;
    ring = [b.x, b.y];
  } else if (p.kind === "marker") {
    const m = p.item;
    head = m.icon + " " + (m.name || humanType(m.type));
    if (m.name) sub = humanType(m.type);
    const legend = htmlToText(m.legend);
    if (legend) rows.push(["", legend]);
    ring = [m.x, m.y];
  } else if (p.kind === "lake") {
    head = p.feature.name || "Lake";
    if (p.feature.name) sub = "Lake";
  } else {
    const c = D.cells, i = p.cell;
    head = stateLabel(c.state[i]);
    const prov = D.provinces[c.province[i]];
    if (prov) rows.push(["Province", prov.fullName || prov.name]);
    rows.push(["Culture", nameOf(D.cultures, c.culture[i])], ["Religion", nameOf(D.religions, c.religion[i])], ["Biome", D.biomes[c.biome[i]] || ""]);
    const r = c.river[i] && D.riverById.get(c.river[i]);
    if (r) rows.push(["River", r.name + " " + r.type]);
  }
  const parts = [el("div", "h", head)];
  if (sub) parts.push(el("div", "sub", sub));
  if (rows.length) {
    const dl = el("dl");
    for (const [k, v] of rows) {
      if (!v) continue;
      if (k) dl.append(el("dt", "", k), el("dd", "", v)); else dl.append(el("dd", "wide", v));
    }
    parts.push(dl);
  }
  if (link) {
    const a = el("a", "link", "City map");
    a.href = link; a.target = "_blank"; a.rel = "noopener";
    parts.push(a);
  }
  cardBody.replaceChildren(...parts);
  card.dataset.kind = p.kind;
  card.setAttribute("aria-label", head);
  card.hidden = false;
  setRing(ring);
}

function closeCard() {
  tapSeq++;
  if (!card || card.hidden) return;
  card.hidden = true;
  setRing(null);
}

// The ring marks the picked place itself: a burg's site, a marker's point (its pin's tip). It is a custom WebGL layer,
// one quad drawn at map.project(point) while a card is open, removed when it closes. It was a GeoJSON circle layer,
// which needs MapLibre's worker: a worker iOS killed in the background left the source loading for good (no ring, and
// no idle ever again), and while a card was open the source added a tiled layer to every frame and a worker tile at
// every zoom crossed. A custom layer has no source and is not serialized, so a style rebuilt after a context restore
// comes back without it; onStyleLoad adds it again if a card is open. Not isStyleLoaded(): a quick second tap or a
// close must still land. The program is built once per GL context.
let ringAt = null;                   // LngLat of the open card's place, or null
let ringGL = null;                   // {prog, vao, u: uniform locations} for the current context

function setRing(at) {
  ringAt = at ? unitsToLngLat(at[0], at[1]) : null;
  syncRing();
}

function syncRing() {
  if (!map || !styleReady) return;
  const has = !!map.getLayer("pick");
  try {
    if (ringAt && !has) map.addLayer(RING_LAYER);
    else if (!ringAt && has) map.removeLayer("pick");
    else if (ringAt) map.triggerRepaint();
  } catch (e) { /* a style still being rebuilt (context restore): its style.load calls this again */ }
}

const RING_LAYER = {
  id: "pick", type: "custom", renderingMode: "2d",
  onAdd(m, gl) { if (!ringGL) ringGL = buildRing(gl); },
  render(gl) {
    if (!ringAt || !ringGL) return;
    const p = map.project(ringAt), k = map.getPixelRatio(), W = gl.canvas.width, H = gl.canvas.height, r1 = RING_PX + RING_STROKE_PX, u = ringGL.u;
    gl.useProgram(ringGL.prog);
    gl.bindVertexArray(ringGL.vao);
    gl.uniform2f(u.c, p.x * k / W * 2 - 1, 1 - p.y * k / H * 2);
    gl.uniform2f(u.s, 2 * k / W, -2 * k / H);
    gl.uniform3f(u.r, RING_PX, r1, r1 + 1);
    gl.uniform1f(u.k, k);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  },
};

// A quad around the point, CSS px offsets in v; the fragment keeps r.x <= |v| <= r.y, antialiased over a device px,
// premultiplied (MapLibre's blend is ONE, ONE_MINUS_SRC_ALPHA).
function buildRing(gl) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec2 a;uniform vec2 c,s;uniform vec3 r;varying vec2 v;" +
    "void main(){v=a*r.z;gl_Position=vec4(c+v*s,0.,1.);}"));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, "precision highp float;uniform vec3 r;uniform float k;varying vec2 v;" +
    `void main(){float d=length(v),a=clamp((d-r.x)*k+.5,0.,1.)*clamp((r.y-d)*k+.5,0.,1.);gl_FragColor=vec4(${RING_RGB.join(",")},1.)*a;}`));
  gl.bindAttribLocation(prog, 0, "a");
  gl.linkProgram(prog);
  const vao = gl.createVertexArray(), buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const u = {};
  for (const name of ["c", "s", "r", "k"]) u[name] = gl.getUniformLocation(prog, name);
  return { prog, vao, u };
}

// === STALE GUARD ===
// The tiles are cut from one rugby.map; if the live save differs in size, these tiles are out of date and the
// full map is the truth. One HEAD request, after the first crisp view. Only Pages' ETag is read (Server:
// GitHub.com): other servers order or encode it differently. A size mismatch may also mean this page's meta.js
// is an HTTP-cached copy (Pages: max-age=600) from before new tiles landed, so meta.js is fetched once more past
// the cache; if that copy matches, the page reloads onto it (once per map size), else the editor opens.
async function checkStale() {
  const say = s => { if (perf) { perf.stale = s; perf.refresh(); } };
  let res;
  try { res = await fetch(MAP_FILE_URL, { method: "HEAD", cache: "no-store" }); } catch (e) { return say("fetch failed"); }
  const etag = res.ok ? res.headers.get("etag") : null, server = res.headers.get("server");
  if (!res.ok) return say("skipped (HTTP " + res.status + ")");
  if (server !== PAGES_SERVER) return say("skipped (server " + (server || "absent") + ")");
  const m = etag && ETAG_RE.exec(etag);
  if (!m) return say("skipped (etag " + (etag || "absent") + ")");
  const bytes = parseInt(m[2], 16);
  if (bytes === META.mapBytes) { try { sessionStorage.removeItem(STALE_RELOAD_KEY); } catch (e) { /* private mode */ } return say("current (" + bytes + " B)"); }
  say("STALE " + bytes + " != " + META.mapBytes);
  const fresh = await freshMeta();
  let reloaded = null;
  try { reloaded = sessionStorage.getItem(STALE_RELOAD_KEY); } catch (e) { /* private mode */ }
  if (fresh && fresh.mapBytes === bytes && reloaded !== String(bytes)) {
    try { sessionStorage.setItem(STALE_RELOAD_KEY, String(bytes)); } catch (e) { /* private mode */ }
    return location.reload();
  }
  showNote("The map was updated - opening the full version", false);
  setTimeout(() => location.replace(FULL_MAP_URL), STALE_NOTE_MS);
}

// meta.js from the network (cache: "reload" also stores it, so a reload then runs on it), parsed; null on failure.
async function freshMeta() {
  const tag = document.querySelector('script[src^="meta.js"]');
  try {
    const text = await (await fetch(tag ? tag.src : "meta.js", { cache: "reload" })).text();
    const m = /^window\.DND_META = (\{.*\});\s*$/s.exec(text);
    return m ? JSON.parse(m[1]) : null;
  } catch (e) { return null; }
}

// === NOTES ===
function showNote(text, withLink) {
  let el = document.getElementById("note");
  if (!el) { el = document.createElement("div"); el.id = "note"; document.body.append(el); }
  el.className = withLink ? "big" : "";
  el.textContent = text;
  if (withLink) {
    const a = document.createElement("a");
    a.href = FULL_MAP_URL; a.textContent = "Open the full map";
    el.append(document.createElement("br"), a);
    const lqip = document.getElementById("lqip");
    if (lqip) lqip.style.opacity = ".5";
  }
}

// === SERVICE WORKER ===
// Cache-first for the tile and library paths (sw.js). Only on https in a secure context: never a dev server, and
// never the live http-only hosts (pnutsuxnuts.com has no certificate of its own), where Pages' max-age=600 and
// ETag revalidation are the only cache.
function registerServiceWorker() {
  if (!window.isSecureContext || location.protocol !== "https:" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register(SW_URL).catch(e => { if (perf) perf.note("sw: " + e.message); });
}

// === PERF HUD === (?perf only)
// Per gesture (movestart..moveend): frames and rAF intervals; the settle (moveend -> next idle) and its worst
// interval; load marks; WebGL; tiles and bytes. The rAF loop runs only while the view moves or settles, and the
// text is rewritten at most every PERF_HUD_MS, never mid-gesture.
function createPerf() {
  const box = document.createElement("div");
  box.id = "perf";
  document.body.append(box);
  const p = { stale: "pending", errors: 0, notes: [], longTasks: 0, worstLongTask: 0, tiles: 0, tileBytes: 0, gl: "" };
  let lines = { gesture: "no gesture yet", settle: "", load: "" };
  let moving = false, settling = false, rafOn = false, last = 0, intervals = [], tEnd = 0, settleWorst = 0, n = 0;
  let renderTimer = 0, lastRender = 0, text = "";

  function tick(t) {
    if (last) { const d = t - last; if (moving) intervals.push(d); else if (settling && d > settleWorst) settleWorst = d; }
    last = t;
    if (moving || settling) requestAnimationFrame(tick); else { rafOn = false; last = 0; }
  }
  function startRaf() { if (!rafOn) { rafOn = true; last = 0; requestAnimationFrame(tick); } }
  function stats(a) {
    if (!a.length) return "0 frames";
    const s = a.slice().sort((x, y) => x - y), q = f => s[Math.min(s.length - 1, Math.floor(f * s.length))];
    return `${a.length + 1} frames, median ${q(0.5).toFixed(1)} p90 ${q(0.9).toFixed(1)} worst ${s[s.length - 1].toFixed(1)} ms, >${PERF_LONG_FRAME_MS}ms: ${a.filter(d => d > PERF_LONG_FRAME_MS).length}`;
  }
  function mark(name) { const e = performance.getEntriesByName(name)[0]; return e ? Math.round(e.startTime) + "" : "-"; }
  function render() {
    renderTimer = 0;
    if (moving) return;                // a timer set before the gesture began: the next idle schedules again
    lastRender = performance.now();
    lines.load = `load: lqip ${mark("dnd-lqip")} map ${mark("dnd-map-load")} crisp ${mark("dnd-first-idle")} ms`;
    const t = [`dnd-view ?perf  ${innerWidth}x${innerHeight}@${devicePixelRatio}  ${p.gl}`, lines.load,
      `gesture ${n}: ${lines.gesture}`, lines.settle,
      `tiles ${p.tiles} (${(p.tileBytes / 1024).toFixed(0)} KB)  errors ${p.errors}  stale: ${p.stale}`,
      p.longTasks ? `long tasks ${p.longTasks}, worst ${p.worstLongTask.toFixed(0)} ms` : "",
      ...p.notes].filter(Boolean).join("\n");
    if (t !== text) { text = t; box.textContent = t; }
  }
  function schedule() {
    if (renderTimer || moving) return;
    renderTimer = setTimeout(render, Math.max(0, lastRender + PERF_HUD_MS - performance.now()));
  }
  p.refresh = schedule;
  p.note = s => { p.notes.push(s); schedule(); };
  // Is this browser affected by the WebKit bug the raw-pixel decode works around? One throwaway worker decodes 6 level-1
  // tiles and transfers the ImageBitmaps (the old way), fingerprinting each before it lets go; 50 ms after the last
  // arrives, the page fingerprints them again. Any difference: CROSSED. ?perf only, once, while still.
  p.checkWorkerBitmaps = async () => {
    try {
      // An unscaled 128 px crop from the middle, hashed: no filtering, so both threads read the same bytes.
      const fp = b => {
        const c = new OffscreenCanvas(128, 128), g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(b, 192, 192, 128, 128, 0, 0, 128, 128);
        const d = g.getImageData(0, 0, 128, 128).data;
        let h = 0;
        for (let i = 0; i < d.length; i++) h = Math.imul(h, 31) + d[i] | 0;
        return h;
      };
      const src = `const fp=${fp};onmessage=async e=>{const{id,buf}=e.data;const b=await createImageBitmap(new Blob([buf],{type:'image/webp'}));` +
        "postMessage({id,b,fp:fp(b)},[b])}";
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" })), w = new Worker(url);
      const rels = [0, 1, 2, 3, 4, 5].map(x => META.tiles.replace("{z}", 1 + META.zOffset).replace("{x}", x).replace("{y}", 1) + REV);
      const bufs = await Promise.all(rels.map(rel => fetchImmutable(BASE_URL + rel).then(r => r.arrayBuffer())));
      const got = await new Promise((done, fail) => {
        const out = []; w.onerror = () => fail(new Error("worker"));
        w.onmessage = e => { out[e.data.id] = e.data; if (out.filter(Boolean).length === bufs.length) done(out); };
        bufs.forEach((b, id) => w.postMessage({ id, buf: b }, [b]));
      });
      await new Promise(r => setTimeout(r, 50));
      let crossed = 0;
      for (const m of got) { if (fp(m.b) !== m.fp) crossed++; m.b.close(); }
      w.terminate(); URL.revokeObjectURL(url);
      p.note(crossed ? `worker bitmaps CROSSED ${crossed}/${got.length} (raw decode needed)` : `worker bitmaps ok ${got.length}/${got.length}`);
    } catch (e) { p.note("worker bitmap check: " + e.message); }
  };
  p.error = e => { p.errors++; if (p.errors <= 3) p.notes.push("error: " + (e && e.error && e.error.message || e)); schedule(); };
  p.attach = m => {
    try {
      const gl = m.getCanvas().getContext("webgl2");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      p.gl = gl ? "WebGL2 " + (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : "no WebGL2";
    } catch (e) { p.gl = "gl?"; }
    m.on("movestart", () => { moving = true; settling = false; intervals = []; startRaf(); });
    m.on("moveend", () => {
      moving = false; n++;
      lines.gesture = stats(intervals);
      settling = true; settleWorst = 0; tEnd = performance.now(); startRaf();
    });
    m.on("idle", () => {
      if (settling) { settling = false; lines.settle = `settle ${(performance.now() - tEnd).toFixed(0)} ms, worst frame ${settleWorst.toFixed(1)} ms`; }
      schedule();
    });
  };
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) if (e.name.indexOf("/t/") >= 0 && /\.webp(\?|$)/.test(e.name)) { p.tiles++; p.tileBytes += e.encodedBodySize || e.transferSize || 0; }
      schedule();
    }).observe({ type: "resource", buffered: true });
  } catch (e) { /* no resource timing */ }
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) { p.longTasks++; if (e.duration > p.worstLongTask) p.worstLongTask = e.duration; }
    }).observe({ type: "longtask", buffered: true });
  } catch (e) { /* WebKit has no longtask entries */ }
  schedule();
  return p;
}

// The module that defines window.maplibregl runs before this deferred script in document order; if it failed
// (an old browser, a network error) wait for the window's load event before calling it unsupported.
if (window.maplibregl || document.readyState === "complete") boot();
else addEventListener("load", boot, { once: true });
