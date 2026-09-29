# How it works

strudel-render runs the same code strudel.cc does — superdough (Strudel's audio engine), its
AudioWorklets, the General MIDI soundfonts and the sample banks strudel.cc loads — inside a
headless Google Chrome. What's different is how the rendering is organised.

## Why it's faster than strudel.cc's Export

strudel.cc renders the whole piece in one `OfflineAudioContext`, on one CPU core, holding all of
it in memory — about 1.4 GB for an hour at 48 kHz. strudel-render cuts the piece into chunks,
renders them in parallel, one Chrome process each, and stitches them back together.

- **Pre-roll.** Each chunk starts rendering 8 cycles early — further back if a long held note is
  still sounding — so notes, delays and reverb tails are already ringing when the chunk begins.
  The pre-roll is thrown away.
- **Sample-exact seams.** Each chunk's time zero sits on the output's sample grid, and seams are
  crossfaded over 50 ms. Without this, a chunk starting on a cycle that isn't a whole number of
  samples (at 174 BPM, one bar is 66,206.9 samples) would be shifted by a fraction of a sample.
- **Deterministic reverb.** superdough's reverb impulse is generated noise, rebuilt whenever a
  note asks for different reverb settings, and installed asynchronously — so where it lands
  depends on how busy the machine is. Here each impulse is seeded from its own settings, and
  rendering waits for it to be installed, so the same reverb lands in the same place in every
  chunk.
- **Sample cache.** Every renderer would otherwise download the sample maps, samples and
  soundfonts again; they're cached on disk after the first render.

Noise sources (`s("white")`, `s("brown")`, …) are still random in every render, as in the REPL.

- **Scheduling close to the playhead.** Notes are queued 0.2 seconds ahead of the renderer, not
  cycles ahead. A note's audio nodes are processed from the moment they're created, even before
  they sound, so queuing far ahead makes every block of audio more expensive — with four cycles
  queued, one renderer ran at a third of the speed.

Measured on a 12-core Mac, on a one-hour piece with distorted guitars, organ and choir:

| | time |
|---|---|
| strudel.cc's Export (September 2026) | 7.4 min |
| strudel-render, 6 renderers (the default here) | 2.0 min |

Short pieces gain less, because every renderer loads the sample maps before it starts: a 3-minute
piece takes 12 s against strudel.cc's 30 s. Past about half the CPU cores, more renderers stop
helping.

## How closely it matches

Two comparisons, both run by the test suite.

**Against itself.** On a noise-free fixture, rendering twice gives bit-identical output (−143 dB),
and a 6-chunk render is bit-identical to a 1-chunk render (−143 dB).

**Against strudel.cc.** Reference WAVs are exported from strudel.cc's own Export tab, by a script
that drives strudel.cc itself, and compared sample for sample:

| fixture | difference |
|---|---|
| default samples, a drum machine, Dirt-Samples | −79 dB |
| General MIDI soundfonts, with `.distort()` | −72 dB |
| synths, filters, delay | −77 dB, except one transient in strudel.cc's export (below) |
| reverb | −9 dB — the same as two strudel.cc exports differ from each other, since its reverb noise is random |

The one difference: strudel.cc's export has a short transient at exactly cycle 2 on a voice with
delay, which repeats exactly across exports and sits on one of the points where strudel.cc's
exporter pauses to schedule the next cycle. strudel-render doesn't have it. It isn't audible —
checked by ear against both strudel-render and strudel.cc's live playback.

The same numbers come out on macOS and on Linux.

## Known cost: `.distort()`

Most of the render time in a distorted-guitar track goes to distortion — about 2.6× slower than
the same track without it. The cost isn't the waveshaping: replacing superdough's distortion
worklet with a native `WaveShaperNode`, or even a plain gain node, was no faster. It's having an
extra node in each voice's chain. That's superdough's to fix.

## Reverb sizes and speed

superdough keeps one reverb per orbit and rebuilds it from scratch whenever a note asks for a
different `.size()` than the last one. A piece that alternates sizes on one orbit — say an organ
at `.size(0.95)` in sixteenths against a pad at `.size(0.9)` — can rebuild it hundreds of times a
minute. That slows rendering a lot, and each rebuild cuts off the tail that's ringing, on
strudel.cc too. Give voices that share an orbit the same size, or put them on different orbits
with `.orbit(2)`.
