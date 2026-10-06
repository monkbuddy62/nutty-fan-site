# map-build/skytrain — the Turgythe skytrain

One-off tooling that added the skytrain network to `dnd-map/rugby.map` (map build 5). It is kept so
the network can be regenerated or tuned; nothing runs it automatically.

| File | What |
|---|---|
| `gen.mjs` | Picks stations and builds the network from the viewer's `data.json`; writes `skytrain.json` |
| `skytrain.json` | The network as committed: stations (burg id, name, x/y in map units, region, role, links) and segments |
| `add-skytrain.mjs` | Loads FMG headless, adds the route groups, routes and station markers, saves with FMG's own `prepareMapData()` |

## The network

- **Hub:** Ka (Turgythe), "Skytrain Central".
- **Regions are map-cell cultures**, the regions the map paints and the campaign calls kingdoms, not a
  town's own `culture` field (Bului is an Orc town standing in Turgythe).
- **Excluded:** Suenth (1), Sawyen (2), Free Isles (10) and Lich influenced (12, the Isle of Death),
  by either the town's culture or its cell's.
- **20 majors** (`MAJORS`): the biggest towns per region, at least `MAJOR_SPACING` apart.
- **Turgythe local web:** every Turgythe town of `LOCAL_BIG`+ people, plus `LOCAL_SMALL` small towns
  spread by farthest-point sampling, plus up to 5 short loop links.
- **Topology:** a tree grown out from Ka: each station joins the connected station that minimises new
  track plus `DETOUR_W` × the riders' detour, only via a station that lies toward Ka (`DIR_TOL`). Trunks
  therefore share corridors instead of all leaving Ka.
- **Under construction:** 4 extensions abroad and the last 3 small Turgythe towns picked.

## In the map

| Route group | Width | Opacity | Dash |
|---|---|---|---|
| `skytrain` (trunk) | 0.8 | 0.85 | — |
| `skytrainLocal` | 0.5 | 0.85 | — |
| `skytrainBuilding` | 0.5 | 0.55 | 2.5 2 |

All `#9ff3ff`. Each segment is a quadratic arc (`BEND` 12% of its length) sampled into route points.
Every station gets a `skytrain` marker (🚉 hub, 🚝 station, 🚧 under construction) whose note lists its
lines, which is what the player viewer's tap card shows.

## Running it

`add-skytrain.mjs` refuses a map that already has skytrain routes, so start from the pre-skytrain save
(`git show 25fff79:dnd-map/rugby.map`).

```bash
cd map-build
node skytrain/gen.mjs                                  # rewrites skytrain/skytrain.json
node skytrain/add-skytrain.mjs skytrain/skytrain.json  # rewrites ../dnd-map/rugby.map
```

Then rebuild the tiles (`specs/deployment.md`). Both scripts need the pinned Chromium, which Playwright
does not ship for Ubuntu 20.04 arm64 (OR-01); build 5 ran both in
`mcr.microsoft.com/playwright:v1.63.0-noble` on OR-02.

The save happens in a headless page, so `add-skytrain.mjs` opens it at the map's own 1600 × 731 and strips
the inline `style` that dnd-map patch 2 pins on `<svg id="map">`. Saved marker sizes reflect the zoom at
save time; FMG recomputes them on every zoom.

## Open or proposed

The network has two looks, defined once in `status.mjs`:

| Mode | Lines | Stops |
|---|---|---|
| `open` (build 5) | solid, under-construction extensions dashed | 🚉 hub, 🚝 stations, 🚧 under construction; "Lines to …" |
| `proposed` (build 7) | every line dashed, trunks still heavier | 🚉 hub, 🚧 everywhere else; "(proposed)", "Proposed lines to …" |
| `off` (build 8, live) | route groups `display: none` | markers `hidden: true`, elements removed (FMG's convention; tap data skips them) |

`off` keeps whatever look and text the stations had, so `off` then `proposed` gives back build 7. One FMG quirk:
toggling the Markers layer in the editor redraws every marker, hidden ones included, so don't save the map
from the editor after doing that while the skytrain is off.

To flip the map already in `dnd-map/rugby.map`:

```bash
cd map-build
node skytrain/set-status.mjs open        # or: proposed, off   (add --preview <dir> for a screenshot instead)
```

It restyles the three route groups (stamping `data-skytrain="<mode>"` on them) and rewrites each station
marker's icon and note, matched to `skytrain.json` by position, then saves through FMG. Then rebuild the
tiles and bump the map build number as usual: about 15 minutes end to end. `add-skytrain.mjs` builds in
`open`; both scripts take their text from `status.mjs`, so a flip back to `open` restores build 5's cards
character for character (checked: 52 of 52).
