// build-map-tiles.mjs - pre-renders the campaign map into the player viewer's WebP tile pyramid.
//
// Drives FMG's own renderer (dnd-map/index.html?edit) in headless Chromium and writes, per the
// map build 4 contract:
//   dnd-view/t/<mapHash12>/<z>/<x>/<y>.webp   512 px tiles, WebP q 0.85, levels 0..5
//   dnd-view/t/<mapHash12>/backdrop.webp      the whole map at level 0
//   dnd-view/t/<mapHash12>/data.json          tap data (cells, names, burgs, markers, per-level hit boxes)
//   dnd-view/meta.js                          window.DND_META = {...}
//
//   node build-map-tiles.mjs                  full build, levels 0-5
//   node build-map-tiles.mjs --levels 2-3     quick run (data.json and backdrop are always complete)
//   node build-map-tiles.mjs --check          exit 0 when meta.js matches rugby.map and the renderer, and every
//                                             file exists with the bytes meta.rev hashed
//   node build-map-tiles.mjs --prune          delete dnd-view/t/<hash> dirs other than meta.js's and the map's
//   --map <file> (or DND_MAP_FILE)            use this .map instead of dnd-map/rugby.map (served in its place)
//   --out <dir>                               output dir instead of <repo>/dnd-view
//
// Render trick: FMG's global scale = K = 2^n / LABEL_DPR, invokeActiveZooming(), then #viewbox
// transform = translate(..) scale(2^n) at deviceScaleFactor 1, so labels and markers are FMG's own
// for zoom K (what a 3x phone shows) and every tile edge is a whole pixel. Each 2048 px window is
// captured with a 64 px margin so nothing is cut at a window seam.
// No timestamps are written anywhere: the same map, fonts and Chromium give the same bytes.
// Exit status: 0 done; 1 error or --check failed; 2 a build that could not write meta.js (a --levels run on a new map).
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// === CONFIG ===
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "..");
export const DEFAULT_MAP = path.join(REPO, "dnd-map", "rugby.map");
export const DEFAULT_OUT = path.join(REPO, "dnd-view");
export const FONT_DIR = path.join(HERE, "fonts");
export const TILE = 512;          // tile px
export const WIN = 2048;          // capture window px (4 x 4 tiles)
export const MARGIN = 64;         // overlap margin px around each window
export const VIEW = WIN + 2 * MARGIN;
export const LABEL_DPR = 3;       // labels and markers baked for a 3x phone
export const MAX_LEVEL = 5;
export const WEBP_Q = 0.85;
export const LQIP_W = 64;         // LQIP width px
export const FMG_PATH = "/dnd-map/index.html?edit"; // ?edit: never the viewer redirect
export const HASH_LEN = 12;
// parallel FMG tabs for the tile pass (--jobs / DND_TILE_JOBS): one per spare core, at most 6 (~1 GB each)
export const DEFAULT_JOBS = Math.max(1, Math.min(6, +(process.env.DND_TILE_JOBS || 0) || os.cpus().length - 1));
export const HASH_DIR_RE = /^[0-9a-f]{12}$/; // the only names under dnd-view/t/ that --prune may delete
// Cell sites at map units * 100: FMG stores them with 2 decimals, so these ints are exact and the viewer's
// nearest-site lookup equals findCell (500/500 sampled; at * 10 rounding flipped 6 near-ties in 500).
export const CELL_SCALE = 100;
export const HIT_SCALE = 10;      // hit boxes in map units * 10, floor/ceil outward (viewer.js HIT_SCALE)
// What draws the tiles besides the map: a change to any of these makes --check fail until a rebuild.
// dnd-map/ is FMG (minus the map itself); fonts/ are the vendored web fonts; the lockfile pins Chromium.
export const RENDERER_INPUTS = ["map-build/build-map-tiles.mjs", "map-build/package-lock.json", "map-build/fonts", "dnd-map"];
export const RENDERER_SKIP = ["dnd-map/rugby.map"];

// Everything that is not map content is hidden. Markers stay: they are baked into the tiles.
export const BUILD_CSS = `
body > *:not(#gestureClip) { display: none !important; }
#vignette, #scaleBar, #ruler, #debug, #legend { display: none !important; }
#gestureLayer { transform: none !important; }
`;
// Comfortaa (burg labels) is declared nowhere; pin it to a Times-metric serif, which is what iPhones show.
export const COMFORTAA_CSS = `@font-face { font-family: Comfortaa; src: local('Liberation Serif'); }`;

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff",
  ".ttf": "font/ttf", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".map": "application/octet-stream",
};

// === GEOMETRY ===
export const sha = buf => crypto.createHash("sha256").update(buf).digest("hex");

export function worldGeom(w, h) {
  const world = TILE * 2 ** Math.ceil(Math.log2(Math.max(w, h) / TILE));
  return { world, zOffset: Math.log2(world / TILE) };
}

// device px extents and tile / window grids of level n
export function levelGeom(n, mapW, mapH) {
  const s = 2 ** n, W = mapW * s, H = mapH * s;
  const tilesX = Math.ceil(W / TILE), tilesY = Math.ceil(H / TILE);
  return { n, s, W, H, tilesX, tilesY, tiles: tilesX * tilesY, winX: Math.ceil(W / WIN), winY: Math.ceil(H / WIN) };
}

export const tileRel = (hash, z, x, y) => `t/${hash}/${z}/${x}/${y}.webp`;

export function parseLevels(s) {
  const m = /^(\d)(?:-(\d))?$/.exec(String(s));
  if (!m) throw new Error(`--levels wants a-b within 0-${MAX_LEVEL}, got ${s}`);
  const a = +m[1], b = m[2] === undefined ? a : +m[2];
  if (a > b || b > MAX_LEVEL) throw new Error(`--levels wants a-b within 0-${MAX_LEVEL}, got ${s}`);
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export function mapInfo(mapFile) {
  const buf = fs.readFileSync(mapFile);
  return { mapHash: sha(buf).slice(0, HASH_LEN), mapBytes: buf.length };
}

// sha256 over (path, sha256(bytes)) of every file, sorted by path; dotfiles and node_modules skipped. Paths are
// relative to root with "/" separators, so the hash is the same on every checkout.
export function hashFiles(root, rels, skip = []) {
  const files = [];
  const walk = rel => {
    const abs = path.join(root, rel), st = fs.statSync(abs);
    if (!st.isDirectory()) { if (!skip.includes(rel)) files.push(rel); return; }
    for (const name of fs.readdirSync(abs)) if (!name.startsWith(".") && name !== "node_modules") walk(rel + "/" + name);
  };
  for (const rel of rels) walk(rel);
  const h = crypto.createHash("sha256");
  for (const rel of files.sort()) h.update(rel + "\0" + sha(fs.readFileSync(path.join(root, rel))) + "\n");
  return h.digest("hex").slice(0, HASH_LEN);
}

export const rendererHash = () => hashFiles(REPO, RENDERER_INPUTS, RENDERER_SKIP);

// The content hash of one map's published files (every tile, the backdrop, data.json): the viewer puts it on
// every tile URL as ?r=, so a re-render under the same map hash gets new URLs in every cache.
export function contentRev(outDir, meta) {
  return hashFiles(outDir, [meta.backdrop, meta.data, ...expectedTiles(meta).map(t => t.rel)]);
}

// === STATIC SERVER ===
// Serves the repo root on an ephemeral port; /dnd-map/rugby.map comes from mapFile.
export function startServer({ root = REPO, mapFile = DEFAULT_MAP } = {}) {
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400); return res.end(); }
    if (p.endsWith("/")) p += "index.html";
    const f = p === "/dnd-map/rugby.map" ? mapFile : path.join(root, p);
    if (f !== mapFile && !f.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://localhost:${server.address().port}`, close: () => new Promise(r => server.close(r)) }));
  });
}

// === BROWSER ===
// Chromium resolves localhost to 127.0.0.1; FMG's service worker only registers off localhost, and contexts block workers anyway.
// playwright is imported lazily so --check and --prune run before `npm ci`.
export async function launch() {
  const { chromium } = await import("playwright");
  return chromium.launch({ channel: "chromium", args: ["--host-resolver-rules=MAP localhost 127.0.0.1"] });
}

// Serve the vendored fonts FMG requests; abort every other off-origin request. Any font miss is fatal later.
export async function routeNetwork(ctx, origin, log) {
  await ctx.route(url => !url.href.startsWith(origin + "/"), async route => {
    const u = new URL(route.request().url());
    if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    if (u.hostname === "fonts.gstatic.com") {
      const p = path.join(FONT_DIR, "gstatic", u.pathname);
      if (p.startsWith(FONT_DIR + path.sep) && fs.existsSync(p)) { log.fonts.push(u.href); return route.fulfill({ body: fs.readFileSync(p), contentType: "font/woff2", headers: { "access-control-allow-origin": "*" } }); }
      log.missingFonts.push(u.href); return route.abort();
    }
    if (u.hostname === "fonts.googleapis.com") {
      const fam = u.searchParams.get("family") || "";
      const p = path.join(FONT_DIR, fam.split(":")[0].replace(/ /g, "_") + ".css");
      if (p.startsWith(FONT_DIR + path.sep) && fs.existsSync(p)) { log.fonts.push(u.href); return route.fulfill({ body: fs.readFileSync(p), contentType: "text/css" }); }
      log.missingFonts.push(u.href); return route.abort();
    }
    log.aborted.push(u.host); return route.abort();
  });
}

// Open FMG (?edit) with the campaign map; wait for burg labels, rivers and fonts.
export async function openFmg(browser, origin, { viewport = { width: VIEW, height: VIEW }, dsf = 1 } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf, serviceWorkers: "block" });
  const log = { fonts: [], missingFonts: [], aborted: [], errors: [] };
  await routeNetwork(ctx, origin, log);
  const page = await ctx.newPage();
  page.on("pageerror", e => log.errors.push(e.message));
  const t0 = Date.now();
  await page.goto(origin + FMG_PATH, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.pack?.burgs?.length > 1 && document.querySelector("#burgLabels text") && document.querySelectorAll("#rivers path").length > 0,
    null, { timeout: 180000, polling: 100 });
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page, log, loadMs: Date.now() - t0 };
}

// Assert FMG's globals, inject the build CSS and the Comfortaa pin, force-load both web fonts. Throws on any miss.
export async function prepare(page, log, { css = BUILD_CSS } = {}) {
  const missing = await page.evaluate(() => {
    const need = {
      scale: typeof scale, viewbox: typeof viewbox, svg: typeof svg, zoom: typeof zoom, d3: typeof d3, invokeActiveZooming: typeof invokeActiveZooming,
      commitZoom: typeof commitZoom, pack: typeof pack, findCell: typeof findCell, "Burgs.getPreview": typeof Burgs?.getPreview,
      populationRate: typeof populationRate, urbanization: typeof urbanization, graphWidth: typeof graphWidth, graphHeight: typeof graphHeight,
      biomesData: typeof biomesData, notes: typeof notes,
      "#labels": document.getElementById("labels") ? "ok" : "undefined", "#markers": document.getElementById("markers") ? "ok" : "undefined",
      "#burgLabels": document.getElementById("burgLabels") ? "ok" : "undefined", "#burgIcons": document.getElementById("burgIcons") ? "ok" : "undefined",
    };
    return Object.entries(need).filter(([, t]) => t === "undefined").map(([k]) => k);
  });
  if (missing.length) throw new Error("FMG globals missing: " + missing.join(", "));
  if (css) await page.addStyleTag({ content: css });
  await page.addStyleTag({ content: COMFORTAA_CSS });
  const fonts = await page.evaluate(async () => {
    await document.fonts.load('16px "Almendra SC"', "The World of Rugby");
    await document.fonts.load('16px "Gloria Hallelujah"', "Isle of Death");
    await document.fonts.load("16px Comfortaa", "Town");
    await document.fonts.ready;
    return { almendra: document.fonts.check('16px "Almendra SC"'), gloria: document.fonts.check('16px "Gloria Hallelujah"'), comfortaa: document.fonts.check("16px Comfortaa"),
      width: graphWidth, height: graphHeight };
  });
  const bad = Object.entries(fonts).filter(([, v]) => v === false).map(([k]) => k);
  if (bad.length) throw new Error("font check false: " + bad.join(", "));
  if (log.missingFonts.length) throw new Error("font requests not vendored: " + log.missingFonts.join(" "));
  if (!(fonts.width > 0 && fonts.height > 0)) throw new Error("bad graph size " + fonts.width + "x" + fonts.height);
  return fonts;
}

// The platform fonts Chromium used for every marker icon; throws if an emoji-presentation icon fell back to a
// non-emoji font (text-presentation symbols such as ⚙ U+2699 legitimately take a text font).
export async function checkMarkerFonts(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "#markers > svg text" });
  const icons = await page.evaluate(() => [...document.querySelectorAll("#markers > svg text")].map(t => t.textContent));
  const used = {}, bad = [];
  for (let k = 0; k < nodeIds.length; k++) {
    const fams = (await cdp.send("CSS.getPlatformFontsForNode", { nodeId: nodeIds[k] })).fonts.map(f => f.familyName);
    const icon = icons[k];
    used[icon] = [...new Set([...(used[icon] || []), ...fams])];
    if (/\p{Emoji_Presentation}|\uFE0F/u.test(icon) && !fams.some(f => /emoji/i.test(f))) bad.push(`${icon}:${fams.join("/")}`);
  }
  await cdp.detach();
  if (bad.length) throw new Error("marker emoji without an emoji font: " + bad.join(" "));
  return used;
}

export async function setLevel(page, n) {
  return page.evaluate(K => { scale = K; invokeActiveZooming(); return scale; }, 2 ** n / LABEL_DPR);
}

const raf2 = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

export async function placeWindow(page, n, wx, wy) {
  const S = 2 ** n, a = -(wx * WIN) + MARGIN, b = -(wy * WIN) + MARGIN;
  await page.evaluate(({ a, b, S }) => viewbox.attr("transform", `translate(${a} ${b}) scale(${S})`), { a, b, S });
  await raf2(page);
}

// Position #viewbox for window (wx, wy) at level n (setLevel first) and capture the VIEW x VIEW px window as PNG.
export async function captureWindow(page, n, wx, wy) {
  await placeWindow(page, n, wx, wy);
  return page.screenshot({ clip: { x: 0, y: 0, width: VIEW, height: VIEW }, type: "png" });
}

// === DATA EXPORT ===
export async function exportData(page) {
  return page.evaluate(({ CELL_SCALE }) => {
    const c = pack.cells, N = c.i.length, q = v => Math.round(v * CELL_SCALE), arr = a => Array.from(a, v => v ?? 0);
    const live = x => x && !x.removed;
    const note = id => notes.find(n => n.id === id);
    return {
      v: 1,
      cells: { n: N, scale: CELL_SCALE, x: c.p.map(p => q(p[0])), y: c.p.map(p => q(p[1])), h: arr(c.h), f: arr(c.f), state: arr(c.state), province: arr(c.province),
        culture: arr(c.culture), religion: arr(c.religion), biome: arr(c.biome), river: arr(c.r) },
      features: pack.features.map(f => f ? { i: f.i, type: f.type, ...(f.name ? { name: f.name } : {}) } : null),
      states: pack.states.map(s => live(s) ? { i: s.i, name: s.name, fullName: s.fullName || s.name } : null),
      provinces: pack.provinces.map(p => live(p) ? { i: p.i, name: p.name, fullName: p.fullName || p.name } : null),
      cultures: pack.cultures.map(x => live(x) ? { i: x.i, name: x.name } : null),
      religions: pack.religions.map(x => live(x) ? { i: x.i, name: x.name } : null),
      biomes: Array.from(biomesData.name),
      rivers: pack.rivers.map(r => ({ i: r.i, name: r.name, type: r.type })).sort((a, b) => a.i - b.i),
      burgs: pack.burgs.map(b => !live(b) || !b.i ? null : {
        i: b.i, name: b.name, x: b.x, y: b.y, population: Math.round(b.population * populationRate * urbanization),
        type: b.type, group: b.group, culture: b.culture, state: b.state, capital: b.capital ? 1 : 0, port: b.port ? 1 : 0,
        link: Burgs.getPreview(b)?.link || "",
      }),
      markers: pack.markers.filter(m => !m.hidden).map(m => {
        const nt = note(`marker${m.i}`);
        return { i: m.i, type: m.type, icon: m.icon, x: m.x, y: m.y, name: nt?.name || "", legend: nt?.legend || "" };
      }),
    };
  }, { CELL_SCALE });
}

// Hit boxes of what is visible at the current FMG scale: burg label text + burg icon (kind 0), marker pins (kind 1),
// in document (paint) order, in map units * HIT_SCALE (floor/ceil outward). The level must be set and a window placed.
export async function exportHits(page) {
  return page.evaluate(({ k }) => {
    const inv = document.querySelector("#viewbox").getScreenCTM().inverse();
    const toMap = (x, y) => new DOMPoint(x, y).matrixTransform(inv);
    const out = [];
    // checkVisibility() is not reliable for SVG (it reports text inside a display:none <g> as visible): walk the ancestors
    const shown = el => { for (let e = el; e && e.id !== "viewbox"; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false; } return true; };
    for (const el of document.querySelectorAll("#burgIcons > g > *, #burgLabels > g > text, #markers > svg")) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      const marker = el.closest("#markers");
      const id = marker ? +el.id.replace(/^marker/, "") : +el.dataset.id;
      if (!Number.isFinite(id) || (!marker && !id)) continue;
      const a = toMap(r.left, r.top), b = toMap(r.right, r.bottom);
      out.push([marker ? 1 : 0, id, Math.floor(Math.min(a.x, b.x) * k), Math.floor(Math.min(a.y, b.y) * k), Math.ceil(Math.max(a.x, b.x) * k), Math.ceil(Math.max(a.y, b.y) * k)]);
    }
    return out;
  }, { k: HIT_SCALE });
}

// === ENCODER ===
// A blank page in the same browser that cuts window PNGs into WebP tiles (Chromium's own encoder, off the FMG page).
export async function openEncoder(browser) {
  const ctx = await browser.newContext({ viewport: { width: 64, height: 64 }, serviceWorkers: "block" });
  const store = new Map(); let seq = 0;
  await ctx.route("http://enc.local/**", r => {
    const u = new URL(r.request().url());
    if (u.pathname === "/") return r.fulfill({ body: "<!doctype html><title>enc</title>", contentType: "text/html" });
    const buf = store.get(u.pathname); store.delete(u.pathname);
    return buf ? r.fulfill({ body: buf, contentType: "application/octet-stream" }) : r.fulfill({ status: 404 });
  });
  const page = await ctx.newPage();
  await page.goto("http://enc.local/");
  await page.evaluate(() => {
    window.toB64 = async blob => { const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode(...u8.subarray(k, k + 0x8000)); return btoa(s); };
    window.loadBmp = async key => createImageBitmap(await (await fetch(key)).blob());
  });
  const put = buf => { const k = `/b${seq++}`; store.set(k, buf); return k; };
  return { ctx, page, put, close: () => ctx.close() };
}

// Chromium's canvas encoder tags every WebP with a 456 B sRGB ICC profile (7% of the pyramid). Untagged images
// are sRGB to every browser, so drop it: a lossy tile without alpha becomes a plain VP8 file, one with alpha keeps
// VP8X + ALPH with the ICC flag cleared.
export function stripIcc(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") throw new Error("not a WebP");
  const chunks = [];
  for (let o = 12; o + 8 <= buf.length;) {
    const id = buf.toString("ascii", o, o + 4), size = buf.readUInt32LE(o + 4), end = o + 8 + size + (size & 1);
    chunks.push({ id, raw: buf.subarray(o, end) }); o = end;
  }
  let keep = chunks.filter(c => c.id !== "ICCP");
  if (keep.length === chunks.length) return buf;
  if (keep.length === 2 && keep[0].id === "VP8X" && (keep[1].id === "VP8 " || keep[1].id === "VP8L")) keep = [keep[1]];
  else { const x = keep.find(c => c.id === "VP8X"); if (x) { const r = Buffer.from(x.raw); r[8] &= ~0x20; x.raw = r; } }
  const body = Buffer.concat(keep.map(c => c.raw)), head = Buffer.alloc(12);
  head.write("RIFF", 0, "ascii"); head.writeUInt32LE(4 + body.length, 4); head.write("WEBP", 8, "ascii");
  return Buffer.concat([head, body]);
}

// -> [{tx, ty, webp}] for the tiles of window (wx, wy) at level n that touch the map; pixels beyond the map cleared.
export async function encodeWindow(enc, png, n, wx, wy, mapW, mapH) {
  const g = levelGeom(n, mapW, mapH);
  const out = await enc.page.evaluate(async ({ key, wx, wy, W, H, TILE, MARGIN, q }) => {
    const bmp = await loadBmp(key), res = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const tx = wx * 4 + i, ty = wy * 4 + j;
      if (tx * TILE >= W || ty * TILE >= H) continue;
      const c = new OffscreenCanvas(TILE, TILE), x = c.getContext("2d");
      x.drawImage(bmp, MARGIN + i * TILE, MARGIN + j * TILE, TILE, TILE, 0, 0, TILE, TILE);
      const ex = W - tx * TILE, ey = H - ty * TILE; // clear everything beyond the map (drops FMG's stray 'Map Rev. 3')
      if (ex < TILE) x.clearRect(ex, 0, TILE - ex, TILE);
      if (ey < TILE) x.clearRect(0, ey, TILE, TILE - ey);
      res.push({ tx, ty, b64: await toB64(await c.convertToBlob({ type: "image/webp", quality: q })) });
    }
    bmp.close();
    return res;
  }, { key: enc.put(png), wx, wy, W: g.W, H: g.H, TILE, MARGIN, q: WEBP_Q });
  return out.map(t => ({ tx: t.tx, ty: t.ty, webp: stripIcc(Buffer.from(t.b64, "base64")) }));
}

// Level-0 window -> backdrop (w x h), LQIP (LQIP_W wide, data URI) and bg (most common colour on the map's 1 px rim).
export async function encodeBackdrop(enc, png, mapW, mapH) {
  const r = await enc.page.evaluate(async ({ key, W, H, M, LW, q }) => {
    const bmp = await loadBmp(key);
    const c = new OffscreenCanvas(W, H), x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(bmp, M, M, W, H, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data, count = new Map();
    const add = (px, py) => { const o = (py * W + px) * 4; const k = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2]; count.set(k, (count.get(k) || 0) + 1); };
    for (let px = 0; px < W; px++) { add(px, 0); add(px, H - 1); }
    for (let py = 1; py < H - 1; py++) { add(0, py); add(W - 1, py); }
    let best = 0, bn = -1; for (const [k, v] of count) if (v > bn || (v === bn && k < best)) { best = k; bn = v; }
    const LH = Math.max(1, Math.round(LW * H / W));
    const l = new OffscreenCanvas(LW, LH), lx = l.getContext("2d");
    lx.imageSmoothingQuality = "high"; lx.drawImage(c, 0, 0, W, H, 0, 0, LW, LH);
    bmp.close();
    return { backdrop: await toB64(await c.convertToBlob({ type: "image/webp", quality: q })), lqip: await toB64(await l.convertToBlob({ type: "image/webp", quality: q })),
      bg: "#" + best.toString(16).padStart(6, "0"), rimShare: bn / (2 * W + 2 * H - 4), lqipSize: [LW, LH] };
  }, { key: enc.put(png), W: mapW, H: mapH, M: MARGIN, LW: LQIP_W, q: WEBP_Q });
  return { backdrop: stripIcc(Buffer.from(r.backdrop, "base64")), lqip: "data:image/webp;base64," + stripIcc(Buffer.from(r.lqip, "base64")).toString("base64"), bg: r.bg, rimShare: r.rimShare, lqipSize: r.lqipSize };
}

// === FILES ===
function writeIfChanged(file, buf) {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buf)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return true;
}

export function expectedTiles(meta) {
  const out = [];
  for (let n = 0; n <= meta.maxLevel; n++) {
    const g = levelGeom(n, meta.width, meta.height);
    for (let y = 0; y < g.tilesY; y++) for (let x = 0; x < g.tilesX; x++) out.push({ n, rel: tileRel(meta.mapHash, n + meta.zOffset, x, y) });
  }
  return out;
}

export function readMeta(outDir) {
  const f = path.join(outDir, "meta.js");
  if (!fs.existsSync(f)) return null;
  const m = /^window\.DND_META = (\{.*\});\s*$/s.exec(fs.readFileSync(f, "utf8"));
  return m ? JSON.parse(m[1]) : null;
}

export function check({ mapFile = DEFAULT_MAP, outDir = DEFAULT_OUT } = {}) {
  const meta = readMeta(outDir);
  if (!meta) return { ok: false, reason: `no parsable ${path.join(outDir, "meta.js")}` };
  const { mapHash, mapBytes } = mapInfo(mapFile);
  if (meta.mapHash !== mapHash) return { ok: false, reason: `mapHash ${meta.mapHash} != ${mapHash} (sha256 of ${mapFile})` };
  if (meta.mapBytes !== mapBytes) return { ok: false, reason: `mapBytes ${meta.mapBytes} != ${mapBytes}` };
  const renderer = rendererHash();
  if (meta.renderer !== renderer) return { ok: false, reason: `renderer ${meta.renderer} != ${renderer} (${RENDERER_INPUTS.join(", ")} changed since the build)` };
  const tiles = expectedTiles(meta);
  for (let n = 0; n <= meta.maxLevel; n++) {
    const want = tiles.filter(t => t.n === n).length;
    if (meta.tileCounts?.[n] !== want) return { ok: false, reason: `tileCounts[${n}] ${meta.tileCounts?.[n]} != ${want}` };
  }
  for (const rel of [meta.backdrop, meta.data, ...tiles.map(t => t.rel)]) if (!fs.existsSync(path.join(outDir, rel))) return { ok: false, reason: `missing ${rel}` };
  const rev = contentRev(outDir, meta);
  if (meta.rev !== rev) return { ok: false, reason: `rev ${meta.rev} != ${rev}: the files changed since meta.js was written` };
  return { ok: true, reason: `meta.js matches ${mapHash} (${mapBytes} B) and renderer ${renderer}; ${tiles.length} tiles + backdrop + data.json, rev ${rev}` };
}

// Deletes every 12-hex directory under t/ except the one meta.js names and the current map's (a build in
// progress). Anything else there (a README, a scratch dir) is left alone.
export function prune({ mapFile = DEFAULT_MAP, outDir = DEFAULT_OUT } = {}) {
  const keep = new Set([mapInfo(mapFile).mapHash, readMeta(outDir)?.mapHash].filter(Boolean));
  const tdir = path.join(outDir, "t"), removed = [];
  if (!fs.existsSync(tdir)) return removed;
  for (const d of fs.readdirSync(tdir)) {
    if (keep.has(d) || !HASH_DIR_RE.test(d) || !fs.statSync(path.join(tdir, d)).isDirectory()) continue;
    fs.rmSync(path.join(tdir, d), { recursive: true, force: true }); removed.push(d);
  }
  return removed;
}

// === BUILD ===
export async function build({ levels = parseLevels(`0-${MAX_LEVEL}`), mapFile = DEFAULT_MAP, outDir = DEFAULT_OUT, jobs = DEFAULT_JOBS, say = console.log } = {}) {
  const tStart = Date.now();
  const { mapHash, mapBytes } = mapInfo(mapFile);
  const rendererAtStart = rendererHash();   // read before rendering: an edit during the run fails the next --check
  const hashDir = path.join(outDir, "t", mapHash);
  const srv = await startServer({ mapFile });
  const browser = await launch();
  try {
    const fmg = await openFmg(browser, srv.origin);
    const fonts = await prepare(fmg.page, fmg.log);
    const markerFonts = await checkMarkerFonts(fmg.page);
    const { width, height } = fonts, { world, zOffset } = worldGeom(width, height);
    say(`map ${mapHash} ${mapBytes} B, ${width}x${height}, world ${world}, zOffset ${zOffset}; FMG ready in ${fmg.loadMs} ms; ${jobs} tab${jobs > 1 ? "s" : ""}`);
    say(`fonts served: ${[...new Set(fmg.log.fonts)].join(" ")}; aborted hosts: ${[...new Set(fmg.log.aborted)].join(" ") || "none"}`);
    say(`marker icon fonts: ${Object.entries(markerFonts).map(([k, v]) => `${k}=${v.join("/")}`).join(" ")}`);
    if (fmg.log.errors.length) say(`page errors: ${fmg.log.errors.join(" | ")}`);
    const enc = await openEncoder(browser);

    // data.json: level-independent data + hit boxes at every level's baked K (always complete)
    const data = await exportData(fmg.page);
    data.hits = {};
    for (let n = 0; n <= MAX_LEVEL; n++) {
      await setLevel(fmg.page, n);
      await placeWindow(fmg.page, n, 0, 0);
      data.hits[n] = await exportHits(fmg.page);
    }
    const dataBuf = Buffer.from(JSON.stringify(data));
    writeIfChanged(path.join(hashDir, "data.json"), dataBuf);
    say(`data.json ${dataBuf.length} B; hits per level ${Object.values(data.hits).map(h => h.length).join(" ")}`);

    // backdrop / LQIP / bg from the level-0 window
    await setLevel(fmg.page, 0);
    const bd = await encodeBackdrop(enc, await captureWindow(fmg.page, 0, 0, 0), width, height);
    writeIfChanged(path.join(hashDir, "backdrop.webp"), bd.backdrop);
    say(`backdrop ${bd.backdrop.length} B; lqip ${bd.lqipSize.join("x")} ${bd.lqip.length} chars; bg ${bd.bg} (${(100 * bd.rimShare).toFixed(1)}% of the rim)`);

    // tiles: windows of every level go on one queue, drained by `jobs` FMG tabs in parallel. A capture depends
    // only on (level, window): setLevel fixes the zoom state, captureWindow re-places #viewbox, so the bytes
    // are the same whichever tab draws a window and in what order.
    // Each extra tab gets its own Chromium: tabs of one browser share its compositor, which capped 6 tabs at ~2.3x.
    const workers = [{ page: fmg.page, enc }];
    const extra = await Promise.all(Array.from({ length: jobs - 1 }, async () => {
      const b = await launch(), w = await openFmg(b, srv.origin);
      await prepare(w.page, w.log);
      return { page: w.page, enc: await openEncoder(b), browser: b };
    }));
    workers.push(...extra);
    const queue = [];
    for (const n of levels) { const g = levelGeom(n, width, height); for (let wy = 0; wy < g.winY; wy++) for (let wx = 0; wx < g.winX; wx++) queue.push({ n, wx, wy }); }
    const per = new Map(levels.map(n => [n, { tiles: 0, bytes: 0, written: 0, t0: Infinity, t1: 0 }]));
    await Promise.all(workers.map(async w => {
      let cur = -1;
      for (let job = queue.shift(); job; job = queue.shift()) {
        const { n, wx, wy } = job, L = per.get(n);
        L.t0 = Math.min(L.t0, Date.now());
        if (n !== cur) { await setLevel(w.page, n); cur = n; }
        const png = await captureWindow(w.page, n, wx, wy);
        for (const t of await encodeWindow(w.enc, png, n, wx, wy, width, height)) {
          if (writeIfChanged(path.join(outDir, tileRel(mapHash, n + zOffset, t.tx, t.ty)), t.webp)) L.written++;
          L.tiles++; L.bytes += t.webp.length;
        }
        L.t1 = Date.now();
      }
    }));
    const stats = [];
    for (const n of levels) {
      const g = levelGeom(n, width, height), L = per.get(n), s = (L.t1 - L.t0) / 1000;
      if (L.tiles !== g.tiles) throw new Error(`level ${n}: ${L.tiles} tiles, expected ${g.tiles}`);
      stats.push({ n, z: n + zOffset, windows: g.winX * g.winY, tiles: L.tiles, bytes: L.bytes, written: L.written, s });
      say(`L${n} (z${n + zOffset}): ${g.winX * g.winY} windows, ${L.tiles} tiles, ${(L.bytes / 1e6).toFixed(2)} MB, ${L.written} files written, ${s.toFixed(1)} s`);
    }
    for (const w of extra) await w.browser.close();
    await enc.close();

    const meta = { v: 1, mapHash, mapBytes, width, height, world, zOffset, maxLevel: MAX_LEVEL, labelDpr: LABEL_DPR, tileSize: TILE,
      tiles: `t/${mapHash}/{z}/{x}/{y}.webp`, backdrop: `t/${mapHash}/backdrop.webp`, data: `t/${mapHash}/data.json`,
      lqip: bd.lqip, bg: bd.bg, tileCounts: Array.from({ length: MAX_LEVEL + 1 }, (_, n) => levelGeom(n, width, height).tiles),
      renderer: rendererAtStart, rev: "" };
    const missing = expectedTiles(meta).filter(t => !fs.existsSync(path.join(outDir, t.rel)));
    if (missing.length) say(`meta.js NOT written: ${missing.length} tiles of ${mapHash} do not exist yet (first ${missing[0].rel}); run all levels`);
    else {
      meta.rev = contentRev(outDir, meta);
      writeIfChanged(path.join(outDir, "meta.js"), Buffer.from(`window.DND_META = ${JSON.stringify(meta)};\n`));
      say(`meta.js written: renderer ${meta.renderer}, rev ${meta.rev}`);
    }
    say(`total ${((Date.now() - tStart) / 1000).toFixed(1)} s`);
    return { meta, stats, data, metaWritten: !missing.length };
  } finally {
    await browser.close();
    await srv.close();
  }
}

// === CLI ===
function parseArgs(argv) {
  const a = { levels: `0-${MAX_LEVEL}`, jobs: DEFAULT_JOBS, check: false, prune: false, map: process.env.DND_MAP_FILE || DEFAULT_MAP, out: DEFAULT_OUT };
  const value = i => { const v = argv[i + 1]; if (v === undefined || v.startsWith("--")) throw new Error(`missing value for ${argv[i]}`); return v; };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--check") a.check = true;
    else if (k === "--prune") a.prune = true;
    else if (k === "--levels") a.levels = value(i++);
    else if (k === "--jobs") a.jobs = Math.max(1, parseInt(value(i++), 10) || 1);
    else if (k === "--map") a.map = path.resolve(value(i++));
    else if (k === "--out") a.out = path.resolve(value(i++));
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.check) {
    const r = check({ mapFile: a.map, outDir: a.out });
    console.log(`${r.ok ? "check ok" : "check FAILED"}: ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  }
  if (a.prune) {
    const removed = prune({ mapFile: a.map, outDir: a.out });
    console.log(`pruned ${removed.length ? removed.join(" ") : "nothing"}`);
    return;
  }
  const r = await build({ levels: parseLevels(a.levels), mapFile: a.map, outDir: a.out, jobs: a.jobs });
  if (!r.metaWritten) process.exit(2);   // nothing published: a following --prune or --check must not run
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(e => { console.error(e); process.exit(1); });
