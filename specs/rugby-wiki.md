# rugby — Rugby's Roaming Wiki

## What it is

`/rugby/` is the players' wiki for Rugby's Roaming Campaign: campaign overviews, session recaps,
and pages for every PC, NPC, place, item, faction and quest, each fact citing the session and
timestamp it came from. Static HTML built by [Quartz 5](https://quartz.jzhao.xyz) (search, graph
view, backlinks, popovers, dark mode).

## Where it comes from

`rugby/` is **build output** — never hand-edit it. The source lives in the private repo
`~/projects/rugbys-roaming-wiki` (read its `CLAUDE.md`):

```
25 session recordings (Craig per-player tracks)
  -> Whisper transcripts            (private, never published)
  -> per-session notes + wiki/      (Claude canon passes, fact-checked)
  -> scripts/publish.py             builds Quartz and rsyncs into nutty-fan-site/rugby/
```

`publish.py` drops Quartz's `CNAME` from the output — the repo-root `CNAME` owns the domain.

## What is public

In-game lore, player first names, and in-game quotes. Never transcripts, audio, real-life talk, or
internal files (anything in `wiki/` starting with `_` or `.`).

## Updating

Rerun the pipeline in the source repo, run `scripts/publish.py`, then commit `rugby/` here and push.
The wiki is independent of the game, so **no build-number bump** — `index.html` is untouched.

## Links

The wiki home page links to the map viewer at `/dnd-view/`. The map does not link back yet.
