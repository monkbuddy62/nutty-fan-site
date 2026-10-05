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

Sources: 26 session transcripts plus all 15 issues of *Rugby's Roaming Gazette* (the DM's in-world
newspaper, `monkbuddy62/rugbys-gazette`), whose page scans are shown on each issue's page.

`publish.py` also fixes presentation on a staging copy: date-first titles for sessions and Gazette
issues (so the explorer sorts chronologically), an "Also heard as" line from aliases, muted
timestamps, The Table page (players → characters) and the home page. Dates are hidden by CSS
except on sessions and Gazette issues, because Quartz otherwise shows the build date.

## What is public

In-game lore, player first names, Gazette issues, and in-game quotes. Never transcripts, audio, real-life talk, or
internal files (anything in `wiki/` starting with `_` or `.`).

## Updating

Rerun the pipeline in the source repo, run `scripts/publish.py`, then commit `rugby/` here and push.
The wiki is independent of the game, so **no build-number bump** — `index.html` is untouched.

## Links

The wiki home page links to the map viewer at `/dnd-view/`. The map does not link back yet.
