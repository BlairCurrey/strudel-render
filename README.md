# strudel-render

Turn a [Strudel](https://strudel.cc) pattern into an audio file from the command line — several
times faster than exporting it from strudel.cc.

## Try it now

```sh
npx strudel-render -e 'note("<[e4 d4 c4 d4] [e4 e4 e4 ~] [d4 d4 d4 ~] [e4 g4 g4 ~] [e4 d4 c4 d4] [e4 e4 e4 e4] [d4 d4 e4 d4] [c4 ~ ~ ~]>").s("piano")' --end 8 --tail 2 -o lamb.mp3
```

It runs Strudel's own audio engine in your browser, headless, so the output is the same as the
strudel.cc export. It's several times faster because it splits the piece into chunks and renders
them in parallel, one per CPU core, where strudel.cc's export uses one. An hour-long piece renders
in about 2 minutes, against about 7.5 minutes in strudel.cc's Export.

## Requirements

- Node 22 or newer
- a Chromium-based browser: Chrome, Edge, Brave or Chromium. Without one, it offers to download
  one for itself.
- ffmpeg, for anything other than `.wav`

## Usage

```sh
npx strudel-render track.js -o track.wav               # the whole piece
npx strudel-render track.js -o track.mp3 --normalize -1  # louder mixes: avoid clipping
npx strudel-render track.js -o clip.wav --start 16 --end 32  # just some cycles
npx strudel-render track.js -o intro.wav --seconds 30   # the first 30 seconds
```

The length comes from the file's `arrange()`. Strudel patterns otherwise loop forever, so for a
file without one, say how much to render with `--end` (in cycles) or `--seconds`.

| option              |                                                                  |
| ------------------- | ---------------------------------------------------------------- |
| `-o, --out`         | output file: `.wav`, `.mp3`, `.flac`, …                          |
| `--start` / `--end` | cycles to render                                                 |
| `--seconds S`       | render S seconds, instead of `--end`                             |
| `--normalize DB`    | scale so the peak sits at DB dBFS, e.g. `-1`                     |
| `--rate HZ`         | sample rate (default 48000)                                      |
| `-j, --jobs N`      | how many renderers run in parallel (default: half the CPU cores) |

`strudel-render --help` lists everything.

Or from JavaScript:

```sh
npm install strudel-render
```

```js
import { render } from "strudel-render";

await render({ file: "track.js", out: "track.wav", normalize: -1 });
```

## More

- [Usage](docs/usage.md) — every option, the library API, what Strudel code is supported
- [How it works](docs/how-it-works.md) — why it's fast, and how closely it matches strudel.cc
- [Development](docs/development.md) — building, testing, and the project layout

## Licence

Licensed under the AGPL-3.0-or-later.

strudel-render is an independent project, not affiliated with or endorsed by
[Strudel](https://strudel.cc) or its maintainers.
