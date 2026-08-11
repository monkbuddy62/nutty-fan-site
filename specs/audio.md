# Audio

## What it is

Three sounds. Two are synthesised in the browser with WebAudio and need no files; the third is a
pool of recorded Nutty voice clips, one played at random on every kill. The clips are the point of
the site — the shooting is the delivery mechanism for them.

> **The clip files are not in this repo.** See *Known gap* below before touching anything here.

## Synthesised SFX

Both are generated per-shot from an `AudioContext` created lazily on first use — browsers block
audio contexts until a user gesture, and the first gesture is always a click or tap, which is also
the first shot.

### `playPew()` — every shot

A sawtooth oscillator swept from `800–960 Hz` down to `130 Hz` over 120ms, with gain falling from
`0.14` to silence over the same window. The base frequency is randomised per shot; at the 90ms
autofire rate, a fixed pitch turns into a machine-gun drone, while the jitter keeps it reading as
distinct shots.

### `playBoom()` — every kill

A 350ms buffer of white noise with a linear amplitude ramp to zero, run through a **340 Hz lowpass**
so it lands as a thud rather than a hiss, at `0.5` gain. Also used when a boss panel is destroyed.

## Nutty voice clips

On every kill, one of 20 `.wav` clips is chosen at random and played via a fresh `Audio` element.

**One clip at a time.** The previous clip is paused and rewound before the new one starts, so rapid
fire produces a stutter of interrupted lines rather than a pile-up. This is deliberate: overlapping
clips are unintelligible, and the lines are the content.

Filenames are listed literally in the `audioFiles` array at the top of `script.js`, are
`encodeURIComponent`'d at play time (they contain spaces, commas and apostrophes), and are resolved
against `AUDIO_DIR`.

Playback failures are swallowed (`.catch(() => {})`) — a missing or blocked clip must never break
the shooting.

## Mute

The `🔊` button in the HUD toggles `muted`, which gates all three sound paths and stops any clip
already playing. It is the only interactive control on the page, and clicks on it are excluded from
firing.

## Constants

| Constant | Value | Controls |
|---|---|---|
| `AUDIO_DIR` | `audio/` | Clip directory, relative to site root. |
| `audioFiles` | 20 filenames | The clip pool. |
| pew sweep | 800–960 Hz → 130 Hz over 120 ms | Shot sound. |
| pew gain | 0.14 | Shot volume — quiet, since it fires ~11×/second. |
| boom | 350 ms noise, 340 Hz lowpass, gain 0.5 | Kill sound. |

## Known gap — the clips are missing

`AUDIO_DIR` and all 20 filenames are referenced by `script.js`, but **there is no `audio/`
directory in this repo, and none in the git history.** As committed, every clip request 404s and
`playNuttyClip()` silently swallows it. The game plays with pew and boom only.

Two possibilities, and it isn't recorded which:

1. The files were never committed — plausibly deliberate, since 20 `.wav` files would add to a repo
   already carrying ~267MB of media against a 1GB soft cap.
2. They are uploaded to the Pages host out of band and exist in production but not in source.

**Resolve this before changing the audio code.** If (2), the out-of-band step belongs in
[deployment.md](deployment.md) as a real deploy dependency. If (1), the clips need sourcing, and
whether they can be added at all is a repo-size question — see [media-pipeline.md](media-pipeline.md).

Until it is resolved, treat the `audioFiles` list as a spec of intent rather than a description of
what ships, and don't "fix" the missing sound by deleting the code path.

## Adding clips

Drop `.wav` files in `audio/` and add the exact filenames to the `audioFiles` array. Unlike media
targets, there is no manifest generator — the list is hand-maintained, and a typo is a silent 404.
