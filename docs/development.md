# Development

```sh
npm install                               # also builds dist/
npm run render -- track.js -o out.wav     # run from source (Node 24+)
npm run build                             # dist/: the page bundle, the library and the CLI
npm run typecheck
npm test                                  # builds, then runs everything in test/ (about 30 s)
```

## Layout

| file | |
|---|---|
| `src/page.ts` | runs in the browser. Bundled with Strudel and superdough into `dist/page.js`. Loads strudel.cc's sounds, evaluates the pattern, renders one chunk into an `OfflineAudioContext`, uploads it as raw float32 |
| `src/render.ts` | the Node side, and the library's `render()`. Serves the page, caches samples, runs one Chrome process per renderer, plans the chunks, stitches them, writes the WAV |
| `src/cli.ts` | the command |
| `src/protocol.ts` | what passes between the two sides |
| `src/browser.ts` | finding a Chromium-based browser, and `--install-browser` |
| `src/wav.ts`, `src/args.ts` | the WAV header; argument handling |
| `src/dirt-samples.json` | strudel.cc's subset of Dirt-Samples, copied from its `website/src/repl/prebake.mjs` |
| `scripts/build.mjs` | builds `dist/` with esbuild |
| `scripts/make-references.mjs` | exports the reference WAVs from strudel.cc |

`src/page.ts` copies strudel.cc's start-up (`prebake.mjs`) closely. Keep it in step:
`reference.test.ts` catches drift.

## Tests

| file | what it checks |
|---|---|
| `unit.test.ts` | the WAV writer, argument handling |
| `browser.test.ts` | the browser search order, falling back past a missing browser, the error when there's none |
| `cli.test.ts` | the built command: options, output formats, `--normalize`, every error message |
| `features.test.ts` | one fixture per Strudel feature in `test/fixtures/features/` renders, isn't silent, and is the right length |
| `seams.test.ts` | a render is exactly repeatable, and a 6-chunk render matches a 1-chunk render |
| `reference.test.ts` | matches strudel.cc's own Export — see [`test/reference/README.md`](../test/reference/README.md) |

To cover a new Strudel feature, add a pattern to `test/fixtures/features/`.

`npm run references` re-exports the reference WAVs from strudel.cc. Do it after a strudel.cc
update to see whether anything drifted.

CI (`.github/workflows/test.yml`) runs the tests on Linux with Node 22 and 24, against the Google
Chrome on GitHub's Ubuntu runners.

## Licence

`dist/page.js` bundles superdough and the `@strudel/*` packages, which are AGPL-3.0-or-later, so
this package is too.
