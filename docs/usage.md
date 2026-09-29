# Usage

## Install

```sh
npx strudel-render track.js -o track.wav      # run without installing
npm install -g strudel-render                 # or install the command
npm install strudel-render                    # or use it as a library
```

Needs **Node 22+**, a **Chromium-based browser**, and **ffmpeg** for anything other than `.wav`
(the WAV is written first and ffmpeg encodes it).

### Which browser

strudel-render drives a browser with `playwright-core` and uses the first it finds: Google Chrome,
Microsoft Edge, Brave, then Chromium, wherever they're normally installed. To choose one, pass
`--chrome /path/to/browser` or set `STRUDEL_RENDER_CHROME`.

If it finds none, it offers to download a headless Chromium for itself (about 100 MB, once):

```
No Chromium-based browser found (looked for Chrome, Edge, Brave, Chromium).
Download a headless Chromium for strudel-render (about 100 MB, once)? [Y/n]
```

Say yes and the render carries on; later runs find it without asking. It only asks when it's
running in a terminal. In CI and scripts, where nobody can answer, it stops with an error instead
of downloading — add `--install-browser` to give the answer in advance:

```sh
npx strudel-render track.js -o track.wav --install-browser   # download one if none is found
npx strudel-render --install-browser                          # download one now, e.g. in a setup step
```

With a pattern, `--install-browser` downloads only if no browser is found. On its own it downloads
now, whatever else is installed; if that same Chromium is already downloaded, it does nothing.

That's Playwright's headless Chromium, about 100 MB, stored in Playwright's shared cache
(`~/Library/Caches/ms-playwright` on macOS, `~/.cache/ms-playwright` on Linux,
`%LOCALAPPDATA%\ms-playwright` on Windows). It isn't part of the npm package, which stays small.

Firefox and Safari can't be used: rendering pauses an offline audio render part-way to queue the
next notes, which only Chromium supports.

## Command

```
strudel-render <pattern.js> -o <out.wav|.mp3|.flac> [options]
strudel-render -e '<code>' -o <out> [options]

  -o, --out PATH   output file; anything but .wav is encoded with ffmpeg
  -e, --code CODE  render this code instead of a file
  --start N        first cycle (default 0)
  --end N          last cycle (default: the length of the top-level arrange())
  --seconds S      render S seconds from --start, instead of --end
  -j, --jobs N     parallel renderers (default: half the CPU cores)
  --chunks N       pieces to cut the span into (default: 2 x jobs)
  --rate HZ        sample rate (default 48000)
  --tail S         seconds rendered after --end so the last notes ring out (default 5)
  --normalize DB   scale so the peak sits at DB dBFS, e.g. -1
  --bits 16|24|32  WAV sample format; 32 is float and cannot clip (default 24)
  --chrome PATH    Chrome/Chromium binary
  -v, --verbose    print the browser console
  -h, --help
  --version

tuning:
  --preroll N      cycles rendered before each chunk and thrown away (default 8)
  --lookback N     how far back a chunk may reach for held notes, cycles (default 64)
  --window S       seconds of notes scheduled ahead at a time (default 0.2)
  --xfade S        crossfade at each seam, seconds (default 0.05)
  --polyphony N    max voices (default 1024, as strudel.cc's export)
  --seed N         Math.random seed (default 1)
```

### Length and the tail

A Strudel pattern has no end: `note("c e g")` loops forever, which is why strudel.cc plays until
you press stop and its Export tab asks for an end cycle. The one thing that declares a length is
a top-level `arrange()`, so strudel-render takes the length from that: the sum of its bar counts.

For code without one, say how much to render — `--end` in cycles, or `--seconds` counted from
`--start`. At Strudel's default tempo (no `setcpm`) one cycle is 2 seconds.

Strudel patterns loop, so rendering past the end would start the piece again. Instead, the
`--tail` (5 seconds by default) is rendered with no new notes — just the last ones ringing out.
Use `--tail 0` to stop exactly at the end, as strudel.cc's export does.

### Clipping

Strudel mixes are often hot. After rendering, strudel-render reports the peak level and how many
samples were clipped. If any were, re-render with `--normalize -1`, or write a float WAV with
`--bits 32`, which can't clip.

### The sample cache

Sample maps, samples and soundfonts are downloaded once and cached in `~/.cache/strudel-render`
(or `$XDG_CACHE_HOME/strudel-render`). Delete the folder to force a fresh download.

## Library

```js
import { render } from 'strudel-render';

const result = await render({
  file: 'track.js', // or code: '...'
  out: 'track.wav',
  // seconds: 30,   // for code without arrange(); or end: <cycle>
  normalize: -1,
  onProgress: ({ fraction, speed }) => console.log(`${(fraction * 100) | 0}% at ${speed.toFixed(1)}x`),
});
// { out, duration, cps, start, end, peakDb, clipped, elapsed }
```

Every command-line option is a `render()` option, camel-cased (`sampleRate`, `maxPolyphony`,
`chromePath`, …); see `RenderOptions` in the type definitions. `onLog` receives the plan and, with
`verbose`, the browser console.

## What Strudel code works

Code copied from strudel.cc renders as is: synths, samples, drum machines, the General MIDI
soundfonts, effects, AudioWorklet oscillators and effects (`supersaw`, `crush`, `distort`, …),
wavetables, `$:` labels, `samples()` calls, and `arrange()`.

Things that only matter in the editor are handled quietly:

- visuals (`._pianoroll()`, `.scope()`, `.punchcard()`, …) do nothing;
- a `slider()` holds the value it was written with;
- `.piano()` works as on strudel.cc.

Not supported:

- tempo changes partway through a piece — the tempo is read once, at the start;
- MIDI and OSC output, csound and hydra;
- samples loaded from local files, which strudel.cc keeps in the browser.
