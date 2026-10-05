// Map build 6: the Squiyles split + Jessigath. Applies the changes to dnd-map/rugby.map inside FMG and
// saves with FMG's own prepareMapData(). `--preview <dir>` writes screenshots instead of saving.
// Usage: node lore/add-lore.mjs [--preview <dir>]
import fs from "node:fs";
import { startServer, launch, openFmg, prepare, DEFAULT_MAP } from "../build-map-tiles.mjs";

const args = process.argv.slice(2);
const PREVIEW = args.includes("--preview") ? args[args.indexOf("--preview") + 1] : null;

const CFG = {
  TERRITORIES: 5, TROLLS: 11, CHANGELINGS: 13,
  SPLIT_X: 955,                  // Territories east of this x (the Troll Mountains) become East Squiyles
  WEST_TAKES: 0.3,               // share of Changeling land West Squiyles has taken
  HOLDOUT_FEATURES: [47],        // islet off the old west coast: the New Republic's stronghold
  JESSIGATH_FEATURES: [14, 15, 16, 22, 25, 35, 37, 41, 46],
  WEST: { name: "West Squiyles", color: "#e2eef6", sub: "(New Republic)" },
  EAST: { name: "East Squiyles", color: "#ece9df", code: "ES", sub: "(Lawless)" },
  JESSIGATH: { name: "Jessigath", color: "#b9e2d6", code: "Je" },
  REGION_GROUP: "oldAddedLabels", // Changelings / Orc lands live here (data-size 26.5)
  SUB_RATIO: 0.5,                // subtitle size relative to its name
  SUB_DY: 2.0,                   // subtitle baseline below the name's, in subtitle em (≈ 0.92 name em)
  MAX_SAG: 0.04,                 // curve depth, as a share of the label path's length
  FIT_SCALES: [1.33, 1.33, 2.67], // FMG zooms of viewer levels 2 (twice: index 1 is the reference) and 3; level 1 is crowded by pins at any placement
  FIT_WEIGHTS: [0, 1, 0.5],        // level 2 is where region names are read
  STRONGHOLD: { name: "Republic Stronghold", legend: "The New Republic of Squiyles' island fortress off the west coast. It never fell when the old kingdom did." },
};

const srv = await startServer();
const browser = await launch();
try {
  const { page, log } = await openFmg(browser, srv.origin, { viewport: { width: 1600, height: 731 }, dsf: PREVIEW ? 3 : 1 });
  if (PREVIEW) await prepare(page, log);
  const report = await page.evaluate((CFG) => {
    const { cells, cultures, burgs } = pack;
    const land = (k) => cells.h[k] >= 20;
    const changed = new Set();
    const setCulture = (k, c) => { if (cells.culture[k] !== c) { cells.culture[k] = c; changed.add(k); } };
    const newCulture = ({ name, color, code }) => {
      const c = structuredClone(cultures[CFG.TERRITORIES]);
      Object.assign(c, { i: cultures.length, name, color, code, removed: false });
      cultures.push(c);
      return c;
    };
    if (cultures.some((c) => c.name === CFG.EAST.name)) throw new Error("map already has the Squiyles split");

    // === REGIONS ===
    const west = cultures[CFG.TERRITORIES];
    Object.assign(west, { name: CFG.WEST.name, color: CFG.WEST.color });
    const east = newCulture(CFG.EAST);
    const jess = newCulture(CFG.JESSIGATH);
    for (const k of cells.i) if (cells.culture[k] === west.i && cells.p[k][0] > CFG.SPLIT_X) setCulture(k, east.i);
    // West annexes ~30% of Changeling land: multi-source BFS out from the shared frontier
    const target = Math.round([...cells.i].filter((k) => cells.culture[k] === CFG.CHANGELINGS && land(k)).length * CFG.WEST_TAKES);
    let frontier = [...cells.i].filter((k) => cells.culture[k] === west.i && cells.c[k].some((n) => cells.culture[n] === CFG.CHANGELINGS && land(n)));
    let taken = 0;
    while (taken < target && frontier.length) {
      const next = [];
      for (const k of frontier) for (const n of cells.c[k]) {
        if (taken >= target) break;
        if (cells.culture[n] === CFG.CHANGELINGS && land(n)) { setCulture(n, west.i); taken++; next.push(n); }
      }
      frontier = next;
    }
    let hx = 0, hy = 0, hn = 0;
    for (const k of cells.i) {
      if (!land(k)) continue;
      if (CFG.HOLDOUT_FEATURES.includes(cells.f[k])) { setCulture(k, west.i); hx += cells.p[k][0]; hy += cells.p[k][1]; hn++; }
      if (CFG.JESSIGATH_FEATURES.includes(cells.f[k])) setCulture(k, jess.i);
    }
    const centre = (c) => {
      const ks = [...cells.i].filter((k) => cells.culture[k] === c.i && land(k));
      const x = ks.reduce((s, k) => s + cells.p[k][0], 0) / ks.length, y = ks.reduce((s, k) => s + cells.p[k][1], 0) / ks.length;
      c.center = findCell(x, y);
    };
    [west, east, jess, cultures[CFG.CHANGELINGS]].forEach(centre);
    // towns follow the land they stand on, so their tap cards name the new region
    let townsMoved = 0;
    for (const b of burgs) if (b && b.i && !b.removed && changed.has(b.cell)) { b.culture = cells.culture[b.cell]; townsMoved++; }
    drawCultures();

    // === STRONGHOLD MARKER ===
    const mi = (last(pack.markers)?.i ?? -1) + 1;
    const sx = hx / hn, sy = hy / hn;
    pack.markers.push({ i: mi, icon: "🏰", type: "stronghold", x: rn(sx, 2), y: rn(sy, 2), cell: findCell(sx, sy), size: 30, pin: "bubble", fill: "#ffffff", stroke: "#3e3e4b" });
    notes.push({ id: "marker" + mi, name: CFG.STRONGHOLD.name, legend: CFG.STRONGHOLD.legend });
    drawMarkers();

    // === LABELS ===
    const vb = document.getElementById("viewbox");
    const toVb = (el) => vb.getCTM().inverse().multiply(el.getCTM());
    const rectOf = (m, r) => {
      const pts = [[r.x, r.y], [r.x + r.width, r.y], [r.x, r.y + r.height], [r.x + r.width, r.y + r.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    };
    const charRects = (text) => {
      const m = toVb(text), out = [];
      const n = text.getNumberOfChars();
      for (let i = 0; i < n; i++) { try { const r = text.getExtentOfChar(i); if (r.width) out.push(rectOf(m, r)); } catch {} }
      return out;
    };
    const hidden = (el) => !!el.closest(".hidden") || getComputedStyle(el).display === "none";
    const mine = new Set();
    const obstacles = (self) => {
      const out = [];
      for (const t of document.querySelectorAll("#burgLabels text")) if (!hidden(t)) { const r = t.getBBox(); if (r.width) out.push(rectOf(toVb(t), r)); }
      // pins are tap targets: a label under one costs three times as much
      for (const s of document.querySelectorAll("#markers > svg")) out.push({ x0: +s.getAttribute("x"), y0: +s.getAttribute("y"), x1: +s.getAttribute("x") + +s.getAttribute("width"), y1: +s.getAttribute("y") + +s.getAttribute("height"), w: 3 });
      for (const t of document.querySelectorAll("#labels text")) if (!t.closest("#burgLabels") && !self.has(t) && !hidden(t)) out.push(...charRects(t));
      return out;
    };
    const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

    // the region's long axis and medial curve, from its cell sites
    const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))]; };
    const axisOf = (pts, maxDeg) => {
      const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
      let sxx = 0, syy = 0, sxy = 0;
      for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
      let th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
      if (Math.cos(th) < 0) th += Math.PI;
      if (th > (60 * Math.PI) / 180) th -= Math.PI; // steep text reads bottom-to-top
      const lim = (maxDeg * Math.PI) / 180;
      th = Math.max(-lim, Math.min(lim, ((th + Math.PI / 2) % Math.PI) - Math.PI / 2));
      const u = [Math.cos(th), Math.sin(th)], nrm = [-u[1], u[0]]; // th in [-90, 90): vertical text reads upward
      const t = pts.map(([x, y]) => (x - mx) * u[0] + (y - my) * u[1]);
      const v = pts.map(([x, y]) => (x - mx) * nrm[0] + (y - my) * nrm[1]);
      const t0 = pct(t, 0.08), t1 = pct(t, 0.92);
      // least squares v = a t^2 + c over the core (medial bend)
      let s4 = 0, s2 = 0, s0 = 0, sv2 = 0, sv = 0;
      t.forEach((ti, i) => { if (ti < t0 || ti > t1) return; s4 += ti ** 4; s2 += ti ** 2; s0++; sv2 += v[i] * ti ** 2; sv += v[i]; });
      const det = s4 * s0 - s2 * s2;
      const a = det ? (sv2 * s0 - sv * s2) / det : 0, c = det ? (s4 * sv - s2 * sv2) / det : 0;
      return { mx, my, u, nrm, tmid: (t0 + t1) / 2, L: t1 - t0, a, c };
    };
    const group = document.getElementById(CFG.REGION_GROUP);
    const toGroup = toVb(group).inverse();
    // quadratic path along the axis: centre shifted by (du along, dv across), half-length h, bend a
    const pathD = (ax, du, dv, h, a) => {
      const sag = Math.max(-CFG.MAX_SAG * 2 * h, Math.min(CFG.MAX_SAG * 2 * h, 0.5 * a * h * h)); // a gentle hint of the land's bend
      const P = (t, v) => [ax.mx + (ax.tmid + du + t) * ax.u[0] + (ax.c + dv + v) * ax.nrm[0], ax.my + (ax.tmid + du + t) * ax.u[1] + (ax.c + dv + v) * ax.nrm[1]];
      // map units -> the label group's own coordinates (FMG's label layer is not in map space)
      const [p0, p1, p2] = [P(-h, sag), P(0, -sag), P(h, sag)].map(([x, y]) => { const q = new DOMPoint(x, y).matrixTransform(toGroup); return [q.x, q.y]; });
      return `M${p0.map((q) => q.toFixed(2)).join(",")} Q${p1.map((q) => q.toFixed(2)).join(",")} ${p2.map((q) => q.toFixed(2)).join(",")}`;
    };
    const defsPaths = document.querySelector("#textPaths");
    const makeLabel = (id, text, fill, sub = false) => {
      let t = document.getElementById(id);
      if (!t) {
        t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.id = id;
        t.innerHTML = `<textPath xlink:href="#textPath_${id}" startOffset="50%" font-size="100%"></textPath>`;
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.id = "textPath_" + id; defsPaths.appendChild(p);
      }
      group.appendChild(t);
      t.removeAttribute("transform");
      t.setAttribute("text-rendering", "optimizeSpeed");
      if (fill) t.setAttribute("fill", fill);
      const tp = t.querySelector("textPath");
      tp.textContent = text;
      if (sub) tp.innerHTML = `<tspan dy="${CFG.SUB_DY}em">${text}</tspan>`; // perpendicular to the path, in its own em
      tp.setAttribute("startOffset", "50%");
      tp.setAttribute("text-anchor", "middle");
      mine.add(t);
      return { t, tp, path: document.getElementById("textPath_" + id) };
    };
    const regionPts = (pred) => [...cells.i].filter((k) => land(k) && pred(k)).map((k) => cells.p[k]);
    const inside = (rects, pred) => {
      let ok = 0, n = 0;
      for (const r of rects) { n++; const k = findCell((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2); if (pred(k)) ok++; }
      return n ? ok / n : 1;
    };
    const placed = [];
    // fit one label (and an optional subtitle under it) to a region, choosing the least-colliding candidate
    const fit = ({ id, text, pts, where, size, fill = 0.62, maxDeg = 20, sub, offsetOut = 0, spread = 6, slide = 4, at = null }) => {
      const ax = axisOf(pts, maxDeg);
      const L = makeLabel(id, text);
      const S = sub ? makeLabel(id + "_sub", sub.text, "#000", true) : null;
      const self = new Set([L.t, S?.t].filter(Boolean));
      const setScale = (k) => { scale = k; invokeActiveZooming(); };
      const obsAt = CFG.FIT_SCALES.map((k) => { setScale(k); return obstacles(self); });
      setScale(CFG.FIT_SCALES[1]);
      let best = null;
      const h = (ax.L / 2) * 1.15;
      const steps = (n, d) => Array.from({ length: 2 * n + 1 }, (_, i) => (i - n) * d);
      if (at) { // hand placement: express the chosen centre as offsets along/across the axis
        const ox = ax.mx + ax.tmid * ax.u[0] + ax.c * ax.nrm[0], oy = ax.my + ax.tmid * ax.u[1] + ax.c * ax.nrm[1];
        const du0 = (at[0] - ox) * ax.u[0] + (at[1] - oy) * ax.u[1], dv0 = (at[0] - ox) * ax.nrm[0] + (at[1] - oy) * ax.nrm[1];
        offsetOut = dv0; spread = 0; slide = 0; ax.tmid += du0;
      }
      for (const dv of steps(spread, 0.045).map((f) => offsetOut + f * ax.L))
        for (const du of steps(slide, 0.06).map((f) => f * ax.L))
          for (const k of [1, 0.9]) {
            L.path.setAttribute("d", pathD(ax, du, dv, h, ax.a));
            L.tp.removeAttribute("letter-spacing");
            const pctSize = size * k;
            L.tp.setAttribute("font-size", pctSize.toFixed(1) + "%");
            let w = L.tp.getComputedTextLength(), fontPx = parseFloat(getComputedStyle(L.tp).fontSize);
            // text longer than its path is clipped: make the path outrun the text (at the largest zoom font, ~2x)
            const need = w * 1.2 + 2 * fontPx;
            if (need > 2 * h) { L.path.setAttribute("d", pathD(ax, du, dv, need, ax.a * (h / need) ** 2)); w = L.tp.getComputedTextLength(); }
            const spare = fill * ax.L * k - w;
            const ls = spare > 0 ? Math.min(0.3, spare / Math.max(1, text.length - 1) / fontPx) : 0;
            L.tp.setAttribute("letter-spacing", ls.toFixed(3) + "em");
            if (S) {
              S.path.setAttribute("d", L.path.getAttribute("d")); // same curve; the tspan's dy drops it below
              S.tp.setAttribute("font-size", (pctSize * CFG.SUB_RATIO).toFixed(1) + "%");
              S.tp.setAttribute("letter-spacing", "0.08em");
            }
            // score at every viewer zoom where region labels show: fonts grow as the zoom shrinks
            let hit = 0, out = 0;
            CFG.FIT_SCALES.forEach((k, si) => {
              setScale(k);
              if (hidden(L.t)) return;
              const rects = S ? charRects(L.t).concat(charRects(S.t)) : charRects(L.t);
              const area = rects.reduce((s, r) => s + (r.x1 - r.x0) * (r.y1 - r.y0), 0) || 1;
              hit += CFG.FIT_WEIGHTS[si] * rects.reduce((s, r) => s + obsAt[si].reduce((q, o) => q + overlap(r, o) * (o.w || 1), 0), 0) / area;
              if (si === 1) out = 1 - inside(rects, where);
            });
            setScale(CFG.FIT_SCALES[1]);
            const score = hit * 2 + out * 4 + (Math.abs(dv - offsetOut) + Math.abs(du)) / ax.L * 0.8 + (1 - k) * 1.5;
            if (!best || score < best.score) best = { score, hit, out, du, dv, k, pctSize, ls, d: L.path.getAttribute("d"), sd: S?.path.getAttribute("d") };
          }
      // apply the winner
      L.path.setAttribute("d", best.d);
      L.tp.setAttribute("font-size", best.pctSize.toFixed(1) + "%");
      L.tp.setAttribute("letter-spacing", best.ls.toFixed(3) + "em");
      if (S) { S.path.setAttribute("d", best.sd); S.tp.setAttribute("font-size", (best.pctSize * CFG.SUB_RATIO).toFixed(1) + "%"); }
      placed.push({ text, hit: +best.hit.toFixed(3), outside: +best.out.toFixed(2), size: Math.round(best.pctSize) + "%", spacing: best.ls.toFixed(2) + "em", angle: Math.round((Math.atan2(ax.u[1], ax.u[0]) * 180) / Math.PI) });
    };

    // score at a mid zoom, where region labels and town names are both on screen
    const scale0 = scale;
    scale = CFG.FIT_SCALES[1]; invokeActiveZooming();
    const byText = (s) => [...document.querySelectorAll("#labels textPath")].find((e) => e.textContent.replace(/\s+/g, " ").trim().toLowerCase() === s.toLowerCase())?.closest("text")
      || [...document.querySelectorAll("#labels textPath")].find((e) => e.textContent.toLowerCase().includes(s.toLowerCase().split(" ")[0]))?.closest("text");
    const reuse = (s) => { const t = byText(s); if (!t) throw new Error("label not found: " + s); return t.id; };
    const isC = (c) => (k) => cells.culture[k] === c;
    const notHoldout = (k) => !CFG.HOLDOUT_FEATURES.includes(cells.f[k]);
    fit({ id: reuse("Troll Mountains"), text: "Troll Mountains", pts: regionPts(isC(CFG.TROLLS)), where: isC(CFG.TROLLS), size: 50, fill: 0.75, maxDeg: 70 });
    fit({ id: reuse("Western Territories"), text: CFG.WEST.name, pts: regionPts((k) => isC(west.i)(k) && notHoldout(k)), where: isC(west.i), size: 95, sub: { text: CFG.WEST.sub } });
    // pins cover every part of the Changelings' land, and its centroid sits low: placed by hand across the Erepec-Ezaso band
    fit({ id: reuse("Changelings"), text: "Changelings", pts: regionPts(isC(CFG.CHANGELINGS)), where: isC(CFG.CHANGELINGS), size: 70, at: [911, 489] });
    fit({ id: reuse("Eastern Territories"), text: CFG.EAST.name, pts: regionPts(isC(east.i)), where: isC(east.i), size: 80, sub: { text: CFG.EAST.sub } });
    // Jessigath sits in the water beside its chain, along the chain's axis
    const jpts = regionPts(isC(jess.i));
    const jax = axisOf(jpts, 90);
    fit({ id: "labelJessigath", text: CFG.JESSIGATH.name, pts: jpts, where: (k) => !land(k) || isC(jess.i)(k), maxDeg: 90, fill: 0.55, size: 80, offsetOut: Math.sign(jax.nrm[0]) * -0.34 * jax.L });
    scale = scale0; invokeActiveZooming();

    return { townsMoved, cellsChanged: changed.size, annexed: taken, stronghold: [rn(sx, 1), rn(sy, 1)], placed, cultures: [west.name, east.name, jess.name] };
  }, CFG);
  console.log(JSON.stringify(report, null, 1));
  if (log.errors.length) console.log("page errors:", log.errors.join(" | "));

  if (PREVIEW) {
    await page.evaluate(() => document.fonts.ready);
    const views = [["world", 800, 365, 1], ["v2", 950, 450, 1.33], ["squiyles", 940, 440, 2.6], ["close", 880, 420, 5], ["jessigath", 1405, 410, 3.2]];
    for (const [name, x, y, k] of views) {
      await page.evaluate(([x, y, k]) => zoomTo(x, y, k, 0), [x, y, k]);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${PREVIEW}/lore-${name}.png` });
    }
  } else {
    const data = await page.evaluate(() => {
      document.getElementById("map").removeAttribute("style"); // dnd-map patch 2's inline offsets
      return prepareMapData();
    });
    fs.writeFileSync(DEFAULT_MAP, data);
    console.log(`wrote ${DEFAULT_MAP} (${data.length} chars)`);
  }
} finally {
  await browser.close();
  await srv.close();
}
