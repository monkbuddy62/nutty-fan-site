// Writes the skytrain network (skytrain.json from gen.mjs) into dnd-map/rugby.map through FMG
// itself: route groups + routes, station markers + notes, then FMG's own prepareMapData().
// Usage: node add-skytrain.mjs <skytrain.json> [--out <file.map>]   (default: overwrite rugby.map)
import fs from "node:fs";
import path from "node:path";
import { startServer, launch, openFmg } from "../build-map-tiles.mjs";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const MAP = path.join(REPO, "dnd-map/rugby.map");
const args = process.argv.slice(2);
const net = JSON.parse(fs.readFileSync(args[0], "utf8"));
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : MAP;

const BEND = 0.12;      // arc control-point offset, fraction of segment length
const SAMPLES_PER_UNIT = 0.25; // route points per map unit along the arc
const STYLE = {
  skytrain: { opacity: 0.85, stroke: "#9ff3ff", "stroke-width": 0.8, "stroke-dasharray": "", "stroke-linecap": "round" },
  skytrainLocal: { opacity: 0.85, stroke: "#9ff3ff", "stroke-width": 0.5, "stroke-dasharray": "", "stroke-linecap": "round" },
  skytrainBuilding: { opacity: 0.55, stroke: "#9ff3ff", "stroke-width": 0.5, "stroke-dasharray": "2.5 2", "stroke-linecap": "butt" },
};
const ICON = { hub: "🚉", major: "🚝", local: "🚝", planned: "🚧", "planned-local": "🚧" };
const SIZE = { hub: 34, major: 26, local: 18, planned: 22, "planned-local": 16 };

const S = new Map(net.stations.map((s) => [s.id, s]));
function arc(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const cx = (a.x + b.x) / 2 - dy * BEND, cy = (a.y + b.y) / 2 + dx * BEND;
  const n = Math.max(3, Math.round(len * SAMPLES_PER_UNIT));
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    pts.push([u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y]);
  }
  return pts;
}
const routes = net.segments.map((g) => ({
  group: g.status === "construction" ? "skytrainBuilding" : g.kind === "local" ? "skytrainLocal" : "skytrain",
  points: arc(S.get(g.from), S.get(g.to)),
  name: `Skytrain: ${S.get(g.from).name} – ${S.get(g.to).name}${g.status === "construction" ? " (under construction)" : ""}`,
}));
const markers = net.stations.map((s) => {
  const open = s.links.filter((l) => l.status === "open").map((l) => l.to);
  const building = s.links.filter((l) => l.status !== "open").map((l) => l.to);
  const planned = s.role.startsWith("planned");
  const name = s.role === "hub" ? `${s.name} — Skytrain Central` : `${s.name} Skytrain ${planned ? "Station (under construction)" : "Station"}`;
  let legend = s.role === "hub"
    ? "The heart of Turgythe's skytrain network, ten years in the building and still growing. "
    : planned ? "A station still under construction on the expanding skytrain network. " : "";
  if (open.length) legend += `Lines to ${open.join(", ")}. `;
  if (building.length) legend += `Under construction: ${building.join(", ")}.`;
  return { x: s.x, y: s.y, icon: ICON[s.role], size: SIZE[s.role], name, legend: legend.trim() };
});

const srv = await startServer();
const browser = await launch();
try {
  // the map's own size, so the saved scale bar and marker sizes match a normal editor session
  const { page, log } = await openFmg(browser, srv.origin, { viewport: { width: 1600, height: 731 } });
  const res = await page.evaluate(({ STYLE, ROUTES, MARKERS }) => {
    if (pack.routes.some((r) => r.group.startsWith("skytrain"))) throw new Error("map already has skytrain routes");
    // route groups: after searoutes, so the skytrain draws on top
    for (const [id, attrs] of Object.entries(STYLE)) {
      const g = routes.append("g").attr("id", id);
      for (const [k, v] of Object.entries(attrs)) g.attr(k, v);
    }
    for (const r of ROUTES) {
      const i = Routes.getNextId();
      const points = r.points.map(([x, y]) => [rn(x, 2), rn(y, 2), findCell(x, y)]);
      pack.routes.push({ i, group: r.group, feature: pack.cells.f[points[0][2]], points, name: r.name });
    }
    drawRoutes();
    let mi = (last(pack.markers)?.i ?? -1) + 1;
    for (const m of MARKERS) {
      const cell = findCell(m.x, m.y);
      pack.markers.push({ i: mi, icon: m.icon, type: "skytrain", x: rn(m.x, 2), y: rn(m.y, 2), cell, size: m.size, pin: "bubble", fill: "#0b2b3a", stroke: "#9ff3ff" });
      notes.push({ id: "marker" + mi, name: m.name, legend: m.legend });
      mi++;
    }
    drawMarkers();
    invokeActiveZooming(); // re-apply the zoom-dependent marker/label sizes drawMarkers reset
    // dnd-map patch 2 pins inline px offsets on <svg id="map">; the original save has no style there
    document.getElementById("map").removeAttribute("style");
    return { routes: pack.routes.length, markers: pack.markers.length, data: prepareMapData() };
  }, { STYLE, ROUTES: routes, MARKERS: markers });
  fs.writeFileSync(out, res.data);
  console.log(`wrote ${out}: ${res.routes} routes, ${res.markers} markers${log.errors.length ? `; page errors: ${log.errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
  await srv.close();
}
