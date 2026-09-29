# Reference renders from strudel.cc

`reference.test.ts` compares strudel-render's output with strudel.cc's own Export for the
patterns in `test/fixtures/reference/`. It's the only test that checks the tool sounds like
strudel.cc — that it loads the same samples and soundfonts and resolves the same names. The
others compare strudel-render only with itself.

```sh
npm run references              # re-export every reference from strudel.cc
npm run references ref-synth    # or just some
```

`scripts/make-references.mjs` opens <https://strudel.cc> in Chrome with the fixture in the URL,
fills in the Export tab (cycles 0–4, 48 kHz), clicks Export and saves the download here.
strudel-render isn't involved, which is the point. `references.json` records a hash of each
fixture; the test fails if a fixture was edited after its reference was made.

The script drives strudel.cc's page, so a redesign of the Export tab can break it: the selectors
are at the top of the export loop. Re-export after a strudel.cc update to see whether anything
drifted.

## What's compared

Per fixture, with tolerances in `reference.test.ts`:

| fixture | against strudel.cc (at 0.1.0) |
|---|---|
| `ref-samples` | −79 dB sample for sample |
| `ref-soundfont` | −72 dB sample for sample |
| `ref-synth` | −77 dB except one known transient in strudel.cc's export at cycle 2 (marked `todo`) |
| `ref-reverb` | −9 dB, 3.7 dB envelope — within strudel.cc's own export-to-export variation (−10 dB, 4.1 dB), since its reverb impulse is random |

Found by this test and fixed: strudel-render loaded all of Dirt-Samples where strudel.cc loads a
subset, so `bd`, `sd` and `hh` played different samples and `jvbass` played where strudel.cc is
silent.
