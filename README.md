# strudel-render

Render a [Strudel](https://strudel.cc) pattern file to audio from the command line — with
Strudel's own engine, several times faster than real time.

```sh
npx strudel-render track.js -o track.mp3
```

It runs superdough (Strudel's audio engine), its AudioWorklets, the General MIDI soundfonts and
the sample banks strudel.cc loads, inside your installed Google Chrome. So it sounds like
strudel.cc — distortion and all — rather than like a reimplementation. An hour-long piece renders
in about 8 minutes on a 12-core laptop.

## Install

```sh
npx strudel-render track.js -o track.wav      # run without installing
npm install -g strudel-render                 # or install the command
npm install strudel-render                    # or use it as a library
```

Needs **Node 22+** and **Google Chrome**. `playwright-core` drives Chrome and downloads no
browser of its own. To use a different Chrome or Chromium, pass `--chrome /path/to/binary` or set
`STRUDEL_RENDER_CHROME`. **ffmpeg** is needed for anything other than `.wav`.

## Command

```
strudel-render <pattern.js> -o <out.wav|.mp3|.flac> [options]

  --start N / --end N   cycle range (default: 0 to the length of the top-level arrange())
  -j, --jobs N          parallel renderers (default: CPU cores − 1)
  --rate HZ             sample rate (default 48000)
  --tail S              seconds rendered past --end so the last notes ring out (default 5)
  --normalize DB        scale so the peak sits at DB dBFS, e.g. --normalize -1
  --bits 16|24|32       WAV format; 32 is float and cannot clip (default 24)
  --chrome PATH         Chrome or Chromium binary
  -v                    print the browser console
```

`strudel-render --help` lists the tuning options as well.

The length comes from the file's top-level `arrange()`. For a file without one, pass `--end`.
Strudel patterns loop, so rendering past the end would start the piece again; the `--tail` is
rendered with no new notes, just the last ones ringing out.

Code copied from strudel.cc renders as is. Visuals (`._pianoroll()`, `.scope()`,
`.punchcard()`, …) do nothing here, a `slider()` holds the value it was written with, and
`.piano()` works as on strudel.cc. Not supported:

- tempo changes partway through a piece, since the tempo is read once;
- MIDI and OSC output, csound and hydra;
- samples loaded from local files, which strudel.cc keeps in the browser.

Strudel mixes are often hot. If the summary reports clipped samples, re-render with
`--normalize -1`, or write `--bits 32`.

## Library

```js
import { render } from 'strudel-render';

const result = await render({
  file: 'track.js', // or code: '...'
  out: 'track.wav',
  normalize: -1,
  onProgress: ({ fraction, speed }) => console.log(`${(fraction * 100) | 0}% at ${speed.toFixed(1)}x`),
});
// { out, duration, cps, start, end, peakDb, clipped, elapsed }
```

Every command-line option is a `render()` option; see `RenderOptions` in the type definitions.

## How it's faster than strudel.cc's Export

strudel.cc renders the whole piece in one `OfflineAudioContext`, on one CPU core, holding all of
it in memory (about 1.4 GB for an hour at 48 kHz). strudel-render cuts the piece into chunks,
renders them in parallel — one Chrome process each — and stitches them back together:

- **Pre-roll.** Each chunk starts 8 cycles early (further back if a long held note is still
  sounding), so notes, delays and reverb tails are already ringing when it begins. The pre-roll
  is discarded.
- **Sample-exact seams.** Each chunk's time zero is placed on the output's sample grid, and seams
  are crossfaded over 50 ms. A stitched render differs from a single-chunk render by about
  −53 dB, which is as close as two single-chunk renders are to each other.
- **Deterministic reverb.** superdough regenerates its reverb impulse (random noise)
  asynchronously whenever a note asks for different reverb settings. Here each impulse is seeded
  from its own settings, and rendering waits for it to be installed, so the same reverb lands in
  the same place in every chunk. Noise sources (`s("white")`, `s("brown")`) are still random in
  every render, as in the REPL.
- **Sample cache.** Sample maps, samples and soundfonts are cached in `~/.cache/strudel-render`,
  so only the first render downloads anything.

Short pieces gain less: every renderer loads the sample maps before it starts.

### Known cost: `.distort()`

Most of the render time in a distorted-guitar track goes to distortion. The cost isn't the
waveshaping — replacing the worklet with a native `WaveShaperNode`, or even a plain gain node,
was no faster — but having an extra node in each voice's chain. Removing `.distort()` from one
test track made rendering 2.6× faster. This one is superdough's to fix.

## Developing

```sh
npm install         # also builds dist/
npm run render -- track.js -o out.wav   # run from source (Node 24+)
npm run build       # dist/: the page bundle, the library and the CLI
```

### Tests

```sh
npm test            # builds, then runs everything in test/ (about 30 s)
```

| file | what it checks |
|---|---|
| `unit.test.ts` | the WAV writer, argument handling |
| `cli.test.ts` | the built command: options, output formats, `--normalize`, every error message |
| `features.test.ts` | one fixture per Strudel feature in `test/fixtures/features/` renders, isn't silent, and is the right length |
| `seams.test.ts` | a render is exactly repeatable, and a 6-chunk render matches a 1-chunk render (−81 dB at 0.1.0) |
| `reference.test.ts` | matches strudel.cc's own Export, sample for sample where strudel.cc is deterministic. `npm run references` re-exports the WAVs from strudel.cc; see `test/reference/README.md` |

To cover a new Strudel feature, add a pattern to `test/fixtures/features/`.

### Layout

`src/page.ts` runs in the browser and is bundled with Strudel into `dist/page.js`.
`src/render.ts` is the Node side: it serves the page, drives Chrome, and stitches the output.
`src/cli.ts` is the command.

## Licence

AGPL-3.0-or-later. `dist/page.js` bundles superdough and the `@strudel/*` packages, which are
AGPL-3.0-or-later, so this package is too. The audio you render is not covered by the licence.
