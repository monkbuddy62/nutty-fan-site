// Flip the skytrain already in dnd-map/rugby.map between "open" and "proposed" (see status.mjs), through FMG,
// then save with FMG's own prepareMapData(). Rebuild the tiles afterwards.
// Usage: node skytrain/set-status.mjs <open|proposed> [--preview <dir>]
import fs from "node:fs";
import { startServer, launch, openFmg, prepare, DEFAULT_MAP } from "../build-map-tiles.mjs";
import { MODES, STYLE, stationMarker } from "./status.mjs";

const args = process.argv.slice(2);
const mode = args[0];
if (!MODES.includes(mode)) { console.error(`usage: set-status.mjs <${MODES.join("|")}> [--preview <dir>]`); process.exit(1); }
const PREVIEW = args.includes("--preview") ? args[args.indexOf("--preview") + 1] : null;
const net = JSON.parse(fs.readFileSync(new URL("./skytrain.json", import.meta.url), "utf8"));
const stations = net.stations.map((s) => ({ x: s.x, y: s.y, ...stationMarker(s, mode) }));

const srv = await startServer();
const browser = await launch();
try {
  const { page, log } = await openFmg(browser, srv.origin, { viewport: { width: 1600, height: 731 }, dsf: PREVIEW ? 3 : 1 });
  if (PREVIEW) await prepare(page, log);
  const r = await page.evaluate(({ style, stations, mode }) => {
    for (const [id, attrs] of Object.entries(style)) {
      const g = document.getElementById(id);
      if (!g) throw new Error("no route group #" + id + ": run add-skytrain.mjs first");
      for (const [k, v] of Object.entries(attrs)) g.setAttribute(k, v);
      g.dataset.skytrain = mode;
    }
    let matched = 0;
    for (const m of pack.markers.filter((m) => m.type === "skytrain")) {
      const s = stations.find((q) => Math.abs(q.x - m.x) < 0.02 && Math.abs(q.y - m.y) < 0.02);
      if (!s) continue;
      m.icon = s.icon;
      let note = notes.find((n) => n.id === "marker" + m.i);
      if (!note) { note = { id: "marker" + m.i }; notes.push(note); }
      note.name = s.name; note.legend = s.legend;
      matched++;
    }
    drawMarkers();
    invokeActiveZooming();
    return { matched, of: stations.length };
  }, { style: STYLE[mode], stations, mode });
  if (r.matched !== r.of) throw new Error(`matched ${r.matched} of ${r.of} station markers`);
  console.log(`skytrain -> ${mode}: ${r.matched} stations, 3 route groups${log.errors.length ? `; page errors: ${log.errors.join(" | ")}` : ""}`);
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
