// Flip the skytrain already in dnd-map/rugby.map between "open" and "proposed" (see status.mjs), or switch it
// "off" (routes and stations hidden, their look and text kept for when it comes back), through FMG, then save
// with FMG's own prepareMapData(). Rebuild the tiles afterwards.
// Usage: node skytrain/set-status.mjs <open|proposed|off> [--preview <dir>]
import fs from "node:fs";
import { startServer, launch, openFmg, prepare, DEFAULT_MAP } from "../build-map-tiles.mjs";
import { MODES, STYLE, stationMarker } from "./status.mjs";

const args = process.argv.slice(2);
const mode = args[0];
if (![...MODES, "off"].includes(mode)) { console.error(`usage: set-status.mjs <${MODES.join("|")}|off> [--preview <dir>]`); process.exit(1); }
const PREVIEW = args.includes("--preview") ? args[args.indexOf("--preview") + 1] : null;
const net = JSON.parse(fs.readFileSync(new URL("./skytrain.json", import.meta.url), "utf8"));
const look = mode === "off" ? null : mode;
const stations = net.stations.map((s) => ({ x: s.x, y: s.y, ...(look ? stationMarker(s, look) : {}) }));
const GROUPS = Object.keys(STYLE.open);

const srv = await startServer();
const browser = await launch();
try {
  const { page, log } = await openFmg(browser, srv.origin, { viewport: { width: 1600, height: 731 }, dsf: PREVIEW ? 3 : 1 });
  if (PREVIEW) await prepare(page, log);
  const r = await page.evaluate(({ style, stations, look, groups }) => {
    for (const id of groups) {
      const g = document.getElementById(id);
      if (!g) throw new Error("no route group #" + id + ": run add-skytrain.mjs first");
      g.style.display = look ? "" : "none";
      if (!g.getAttribute("style")) g.removeAttribute("style");
      if (look) { for (const [k, v] of Object.entries(style[id])) g.setAttribute(k, v); g.dataset.skytrain = look; }
    }
    let matched = 0;
    for (const m of pack.markers.filter((m) => m.type === "skytrain")) {
      const s = stations.find((q) => Math.abs(q.x - m.x) < 0.02 && Math.abs(q.y - m.y) < 0.02);
      if (!s) continue;
      matched++;
      // FMG's convention for a hidden marker: the flag, and no element (tap data skips it too)
      if (!look) { m.hidden = true; document.getElementById("marker" + m.i)?.remove(); continue; }
      delete m.hidden;
      m.icon = s.icon;
      let note = notes.find((n) => n.id === "marker" + m.i);
      if (!note) { note = { id: "marker" + m.i }; notes.push(note); }
      note.name = s.name; note.legend = s.legend;
    }
    if (look) drawMarkers();
    invokeActiveZooming();
    return { matched, of: stations.length };
  }, { style: look ? STYLE[look] : null, stations, look, groups: GROUPS });
  if (r.matched !== r.of) throw new Error(`matched ${r.matched} of ${r.of} station markers`);
  console.log(`skytrain -> ${mode}: ${r.matched} stations, ${GROUPS.length} route groups${log.errors.length ? `; page errors: ${log.errors.join(" | ")}` : ""}`);
  if (PREVIEW) {
    await page.evaluate(() => zoomTo(380, 560, 3, 0));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${PREVIEW}/skytrain-${mode}.png` });
  } else {
    const data = await page.evaluate(() => { document.getElementById("map").removeAttribute("style"); return prepareMapData(); });
    fs.writeFileSync(DEFAULT_MAP, data);
    console.log(`wrote ${DEFAULT_MAP}`);
  }
} finally {
  await browser.close();
  await srv.close();
}
