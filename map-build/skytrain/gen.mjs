// Skytrain network generator: picks stations from the viewer's data.json and builds a
// hub-centred network. Output: skytrain.json (stations + segments) in map units.
import fs from "node:fs";

const REPO = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const meta = fs.readFileSync(`${REPO}/dnd-view/meta.js`, "utf8");
const hash = meta.match(/[0-9a-f]{12}/)[0];
const data = JSON.parse(fs.readFileSync(`${REPO}/dnd-view/t/${hash}/data.json`, "utf8"));
const allBurgs = data.burgs.filter((b) => b && b.name);
// region = culture of the map cell the town stands in (what the map paints), not the town's own culture
const C = data.cells;
for (const b of allBurgs) {
  const bx = b.x * C.scale, by = b.y * C.scale;
  let best = 0, bd = Infinity;
  for (let k = 0; k < C.n; k++) { const d = (C.x[k] - bx) ** 2 + (C.y[k] - by) ** 2; if (d < bd) { bd = d; best = k; } }
  b.ownCulture = b.culture;
  b.culture = C.culture[best];
}
const BANNED = new Set([1, 2, 10, 12]); // Suenth, Sawyen, Free Isles, Lich influenced (Isle of Death)
const burgs = allBurgs.filter((b) => !BANNED.has(b.culture) && !BANNED.has(b.ownCulture));
const cname = (i) => data.cultures[i].name;

const HUB = "Ka";
const TURGYTHE = 7;
// majors per culture (sums to 20); Suenth(1), Sawyen(2), Free Isles(10), Lich influenced(12) = Isle of Death excluded
const MAJORS = { 4: 4, 6: 4, 8: 3, 13: 3, 5: 2, 3: 2, 9: 2 };
const MAJOR_SPACING = 45;      // map units between picked majors
const LOCAL_BIG = 10000;       // every Turgythe city at/above this is a stop
const LOCAL_SMALL = 16;        // plus this many small towns, spread out
const LOCAL_SPACING = 28;
const DIR_TOL = 0.6;           // radians: a node may feed through a parent within this angle
const DETOUR_W = 0.5;          // weight on riders' detour when choosing which station to branch from

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const hub = burgs.find((b) => b.name === HUB && b.culture === TURGYTHE);
if (!hub) throw new Error("hub not found");

const st = new Map(); // burg id -> station
const add = (b, role) => { if (!st.has(b.i)) st.set(b.i, { id: b.i, name: b.name, x: b.x, y: b.y, culture: cname(b.culture), population: b.population, role }); };
add(hub, "hub");
hub.id = hub.i;

// --- majors: biggest per culture, kept apart so they spread over the culture
for (const [c, n] of Object.entries(MAJORS)) {
  const picked = [];
  for (const b of burgs.filter((b) => b.culture === +c).sort((a, b) => b.population - a.population)) {
    if (picked.length >= n) break;
    if (picked.every((p) => dist(p, b) >= MAJOR_SPACING)) picked.push(b);
  }
  picked.forEach((b) => add(b, "major"));
}
// --- extensions under construction: next major-sized city in cultures at the network's edge
const EXT = [];
for (const c of [3, 5, 13, 9]) {
  const b = burgs.filter((b) => b.culture === c && !st.has(b.i) && [...st.values()].every((s) => dist(s, b) >= MAJOR_SPACING))
    .sort((a, b) => b.population - a.population)[0];
  if (b) { add(b, "planned"); EXT.push(b.i); }
}

// --- Turgythe local stops: all big cities + spread-out small towns (farthest-point sampling)
const turg = burgs.filter((b) => b.culture === TURGYTHE && b.i !== hub.i);
turg.filter((b) => b.population >= LOCAL_BIG).forEach((b) => add(b, "local"));
const small = turg.filter((b) => b.population < 5000);
for (let k = 0; k < LOCAL_SMALL; k++) {
  const stops = [...st.values()].filter((s) => s.culture === cname(TURGYTHE));
  let best = null, bestD = 0;
  for (const b of small) {
    if (st.has(b.i)) continue;
    const d = Math.min(...stops.map((s) => dist(s, b)));
    if (d > bestD && d >= LOCAL_SPACING) { best = b; bestD = d; }
  }
  if (!best) break;
  add(best, k >= LOCAL_SMALL - 3 ? "planned-local" : "local");
}

// --- topology: directional tree grown outward from the hub. Each station links to the
// already-connected node that minimises (path length via it), but only if that node lies
// roughly toward the hub; trunks therefore share corridors and fan out like real lines.
const nodes = [...st.values()];
const parent = new Map([[hub.id, null]]);
const pathLen = new Map([[hub.id, 0]]);
const order = nodes.filter((n) => n.id !== hub.id).sort((a, b) => dist(a, hub) - dist(b, hub));
const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const angDiff = (p, q) => Math.abs(((p - q + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
for (const n of order) {
  const local = n.culture === cname(TURGYTHE);
  let best = hub, bestCost = Infinity;
  for (const [pid] of parent) {
    const p = st.get(pid);
    if (p.role.startsWith("planned")) continue;
    // trunks only ride other trunk stations (or the hub); locals ride locals/hub
    if (!local && p.id !== hub.id && p.culture === cname(TURGYTHE)) continue;
    if (local && p.culture !== cname(TURGYTHE)) continue;
    if (p.id !== hub.id && (dist(p, hub) >= dist(n, hub) || angDiff(ang(hub, p), ang(hub, n)) > DIR_TOL)) continue;
    // short new track wins; a small charge for the detour riders take vs. a direct line
    const detour = pathLen.get(pid) + dist(p, n) - dist(hub, n);
    const cost = dist(p, n) + DETOUR_W * detour;
    if (cost < bestCost) { bestCost = cost; best = p; }
  }
  parent.set(n.id, best.id);
  pathLen.set(n.id, pathLen.get(best.id) + dist(best, n));
}
const segments = [];
for (const [id, pid] of parent) {
  if (pid === null) continue;
  const a = st.get(pid), b = st.get(id);
  const kind = a.culture === cname(TURGYTHE) && b.culture === cname(TURGYTHE) ? "local" : "trunk";
  segments.push({ from: pid, to: id, kind, status: b.role.startsWith("planned") ? "construction" : "open" });
}
// a few loop links inside Turgythe so it reads as a web, not just a tree
const locals = nodes.filter((n) => n.culture === cname(TURGYTHE) && !n.role.startsWith("planned"));
const linked = new Set(segments.map((s) => [s.from, s.to].sort().join("-")));
const cands = [];
for (let i = 0; i < locals.length; i++) for (let j = i + 1; j < locals.length; j++) {
  const a = locals[i], b = locals[j], key = [a.id, b.id].sort().join("-");
  if (!linked.has(key)) cands.push({ a, b, d: dist(a, b), key });
}
cands.sort((p, q) => p.d - q.d);
let loops = 0;
for (const c of cands) {
  if (loops >= 5 || c.d > 60) break;
  // skip if a third station sits between them (Gabriel-ish test)
  const mx = (c.a.x + c.b.x) / 2, my = (c.a.y + c.b.y) / 2;
  if (locals.some((s) => s !== c.a && s !== c.b && Math.hypot(s.x - mx, s.y - my) < c.d / 2)) continue;
  segments.push({ from: c.a.id, to: c.b.id, kind: "local", status: "open" }); linked.add(c.key); loops++;
}

// line listing per station (for the tappable marker cards)
for (const s of nodes) {
  s.links = segments.filter((g) => g.from === s.id || g.to === s.id)
    .map((g) => ({ to: st.get(g.from === s.id ? g.to : g.from).name, status: g.status }));
}
const out = { hub: hub.id, stations: nodes, segments };
fs.writeFileSync(new URL("./skytrain.json", import.meta.url), JSON.stringify(out, null, 1));
const count = (r) => nodes.filter((n) => n.role === r).length;
console.log(`stations ${nodes.length}: hub 1, major ${count("major")}, local ${count("local")}, planned ${count("planned") + count("planned-local")}; segments ${segments.length} (construction ${segments.filter((s) => s.status === "construction").length}); hub degree ${segments.filter((s) => s.from === hub.id || s.to === hub.id).length}`);
for (const r of ["major", "planned"]) console.log(r + ":", nodes.filter((n) => n.role === r).map((n) => `${n.name} (${n.culture})`).join(", "));
