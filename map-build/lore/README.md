# map-build/lore — the Squiyles split and Jessigath

One-off tooling that made map build 6. Kept so the change can be re-run or tuned; nothing runs it
automatically. `add-lore.mjs` refuses a map that already has East Squiyles, so start from the build-5
save (`git show 9e2eca9:dnd-map/rugby.map`).

```bash
cd map-build
node lore/add-lore.mjs --preview <dir>   # screenshots (world, region, close, Jessigath); saves nothing
node lore/add-lore.mjs                   # rewrites ../dnd-map/rugby.map
```

Like `skytrain/`, it needs the pinned Chromium (not available on OR-01): build 6 ran in
`mcr.microsoft.com/playwright:v1.63.0-noble` on OR-02.

## What it changes

Regions are FMG cultures (the painted regions the campaign calls kingdoms).

- **West Squiyles (New Republic)**: culture 5 (was *Territories*) renamed, west of `SPLIT_X`, plus
  `WEST_TAKES` (30%) of the Changelings' land, grown by BFS from the shared frontier, plus the islet
  feature 47 with a 🏰 **Republic Stronghold** marker.
- **East Squiyles (Lawless)**: a new culture for the Territories east of `SPLIT_X` (the Troll Mountains).
- **Jessigath**: a new culture over the lower-right island chain (features in `JESSIGATH_FEATURES`).
- Towns standing on changed cells take the new culture, so their tap cards name the new region.

## Labels

FMG-native labels (`<text><textPath>` with the path in `defs #textPaths`), so they stay editable in
`/dnd-map/?edit` and rescale with zoom. Region names go in `#oldAddedLabels` (data-size 26.5, the
group of *Orc lands* and *Changelings*), sized in percent of it: West 95%, East 80%, Jessigath 80%,
Changelings 70%, Troll Mountains 50% (the search may step a label down to 90% of that). Subtitles share their name's path and drop below it with
`dy="2em"` at half size, so the gap holds at every zoom.

Placement, per label: the region's long axis by PCA of its cell sites (angle capped at 20° for
country names), a curve with a gentle hint of the land's medial bend (`MAX_SAG`), then a search over
offsets along and across the axis, scored by overlap with town labels, other labels (per-character
boxes, including the new labels placed before it) and marker pins (weighted 3×), plus the share of
characters outside the region. Scoring runs at the FMG zooms of player-viewer levels 2 and 3
(`FIT_SCALES`, `FIT_WEIGHTS`), because FMG draws labels and pins larger the further out you zoom; at
level 1 the pins blanket these small regions whatever the placement, so it is not scored. Paths are
drawn longer than their text, because textPath clips what runs off the end.

**Changelings is placed by hand** (`at: [911, 489]`, 70%): pins cover every part of what is left of
their land and its centroid sits low, so the search kept pushing the name onto a coast or into
Binneth. At level 2 it now runs along the river band between the Conopimalis and Godoy pins.

**FMG's label layer is not in map space** here: `#labels` renders at about 0.83× of `#viewbox`, so
paths are written through `toVb(group).inverse()`. Anything placed by raw map coordinates inside
`#labels` lands up and to the left of where it was meant.
