// Runs inside headless Chromium. Bundled by esbuild into dist/page.js.
//
// One page renders one job: a span of cycles, plus a pre-roll before it so
// that held notes, delays and reverb tails are already sounding when the
// span begins. The CLI stitches the jobs back together.

import * as core from '@strudel/core';
import { evalScope, noteToMidi, Pattern, pure, repl, valueToMidi } from '@strudel/core';
import * as mini from '@strudel/mini';
import { miniAllStrings } from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { transpiler } from '@strudel/transpiler';
import * as webaudio from '@strudel/webaudio';
import {
  aliasBank,
  getSuperdoughAudioController,
  initAudio,
  registerSynthSounds,
  registerZZFXSounds,
  samples,
  setAudioContext,
  setSuperdoughAudioController,
  superdough,
} from 'superdough';
import { registerSoundfonts } from '@strudel/soundfonts';
import type { Job, JobResult } from './protocol.ts';
// strudel.cc's subset of Dirt-Samples, copied from website/src/repl/prebake.mjs.
// Not all of Dirt-Samples: that would replace strudel.cc's bd, sd, hh … with
// Dirt's, and make names like jvbass play that are silent on strudel.cc.
import dirtSamples from './dirt-samples.json' with { type: 'json' };


// Deterministic randomness.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// superdough's reverb impulse is generated noise (reverbGen.mjs), rebuilt
// whenever a note asks for different reverb settings. With one global
// random stream, each chunk would draw different noise depending on where
// it starts, and the seams wouldn't match. So every impulse is generated
// from a stream seeded by its own settings: the same reverb is the same
// noise in every chunk, and in every render.
function seedRandom(seed: number) {
  const global = mulberry32(seed);
  let current = global;
  Math.random = () => current();
  const createConvolver = BaseAudioContext.prototype.createConvolver;
  BaseAudioContext.prototype.createConvolver = function (this: BaseAudioContext) {
    const node = createConvolver.call(this);
    let generate: ((...a: unknown[]) => void) | undefined;
    Object.defineProperty(node, 'generate', {
      configurable: true,
      get: () => generate,
      set(fn: (...a: unknown[]) => void) {
        generate = (...args) => {
          const [d, fade, lp, dim] = args;
          current = mulberry32(hash(`${seed}:${d}:${fade}:${lp}:${dim}:${this.sampleRate}`));
          try {
            fn(...args);
          } finally {
            current = global;
          }
        };
      },
    });
    return node;
  };
}

// strudel.cc's prebake (website/src/repl/prebake.mjs), minus the local-file /
// IndexedDB sources. Keep it in step: test/reference.test.ts catches drift.
const CDN = 'https://strudel.b-cdn.net';
async function prebake() {
  await Promise.all([
    registerSynthSounds(),
    registerZZFXSounds(),
    registerSoundfonts(),
    samples(`${CDN}/piano.json`, `${CDN}/piano/`, { prebake: true }),
    samples(`${CDN}/vcsl.json`, `${CDN}/VCSL/`, { prebake: true }),
    samples(`${CDN}/tidal-drum-machines.json`, `${CDN}/tidal-drum-machines/machines/`, {
      prebake: true,
      tag: 'drum-machines',
    }),
    samples(`${CDN}/uzu-drumkit.json`, `${CDN}/uzu-drumkit/`, { prebake: true, tag: 'drum-machines' }),
    samples(`${CDN}/uzu-wavetables.json`, `${CDN}/uzu-wavetables/`, { prebake: true }),
    samples(`${CDN}/mridangam.json`, `${CDN}/mrid/`, { prebake: true, tag: 'drum-machines' }),
    samples(dirtSamples, `${CDN}/Dirt-Samples/`, { prebake: true }),
  ]);
  await aliasBank(`${CDN}/tidal-drum-machines-alias.json`);
}

// Reverb impulses are low-passed by rendering them in their own
// OfflineAudioContext, asynchronously, so when a new impulse reaches the
// convolver depends on how busy the machine is. Track those renders and
// wait for them at every suspend, so the swap lands at the same point in
// the audio every time.
let mainContext: OfflineAudioContext | null = null;
const pendingRenders = new Set<Promise<unknown>>();
const startRendering = OfflineAudioContext.prototype.startRendering;
OfflineAudioContext.prototype.startRendering = function (this: OfflineAudioContext) {
  const p = startRendering.call(this);
  if (this !== mainContext) {
    // the callback that installs the impulse runs in a .then() after this
    // promise; a macrotask later it has run
    const done = p.then(() => new Promise((r) => setTimeout(r, 0)));
    pendingRenders.add(done);
    done.finally(() => pendingRenders.delete(done));
  }
  return p;
};
const settle = async () => {
  while (pendingRenders.size) await Promise.all([...pendingRenders]);
};

// ---- strudel.cc's editor and website extras
// Code written on strudel.cc often carries a pianoroll, a scope or a slider.
// Those live in the editor (@strudel/codemirror) and the drawing packages,
// not in the engine. None of them affect the sound, so here visuals do
// nothing and a slider holds the value it was written with.
const VISUALS = [
  'pianoroll', 'pitchwheel', 'punchcard', 'spiral', 'wordfall', 'scope', 'tscope', 'fscope', 'spectrum',
  '_pianoroll', '_pitchwheel', '_punchcard', '_spiral', '_scope', '_spectrum',
];
function editorExtras() {
  const proto = Pattern.prototype as any;
  for (const name of VISUALS) proto[name] = function (this: unknown) { return this; };
  // the transpiler rewrites slider(value, min, max) into sliderWithID(id, value, min, max)
  (globalThis as any).slider = (value: unknown) => pure(value);
  (globalThis as any).sliderWithID = (_id: string, value: unknown) => pure(value);

  // .piano(), from strudel.cc's website/src/repl/prebake.mjs
  const maxPan = noteToMidi('C8');
  const panwidth = (pan: number, width: number) => pan * width + (1 - width) / 2;
  proto.piano = function (this: any) {
    return this.fmap((v: any) => ({ ...v, clip: v.clip ?? 1 }))
      .s('piano')
      .release(0.1)
      .fmap((value: any) => {
        const midi = valueToMidi(value);
        const pan = panwidth(Math.min(Math.round(midi) / maxPan, 1), 0.5);
        return { ...value, pan: (value.pan || 1) * pan };
      });
  };
}

let replInstance: any;
let arrangedCycles: number | null = null;

async function init(seed: number) {
  seedRandom(seed);
  miniAllStrings();
  replInstance = repl({ defaultOutput: () => {}, getTime: () => 0, transpiler });
  await evalScope(core, mini, tonal, webaudio);
  editorExtras();
  // Record the length of the top-level arrange() so the CLI knows where the
  // piece ends. Nested arrange() calls overwrite it first, the outer one last.
  const arrange = (core as any).arrange;
  (globalThis as any).arrange = (...sections: [number, unknown][]) => {
    arrangedCycles = sections.reduce((n, [bars]) => n + bars, 0);
    return arrange(...sections);
  };
  await prebake();
}

async function evaluate(code: string) {
  arrangedCycles = null;
  const pattern = await replInstance.evaluate(code, false);
  if (!pattern) throw new Error(replInstance.state.evalError?.message ?? 'evaluation failed');
  return pattern;
}

async function info(code: string) {
  await evaluate(code);
  return { cps: replInstance.scheduler.cps as number, cycles: arrangedCycles };
}

// Earliest onset of anything still sounding at `cycle`, so a job's pre-roll
// can reach back far enough to catch long held notes.
function earliestSounding(pattern: any, cycle: number, lookback: number) {
  let earliest = cycle;
  for (const hap of pattern.queryArc(cycle, cycle + 1e-6)) {
    const b = hap.whole?.begin.valueOf();
    if (b !== undefined && b < earliest && b >= cycle - lookback) earliest = b;
  }
  return earliest;
}


async function render(job: Job): Promise<JobResult> {
  const pattern = await evaluate(job.code);
  const cps: number = replInstance.scheduler.cps;

  let begin = Math.max(job.floor, job.from - job.preroll);
  if (job.from > job.floor) {
    begin = Math.max(job.floor, Math.min(begin, Math.floor(earliestSounding(pattern, job.from, job.lookback))));
  }

  // Suspends fall on a grid of `window` cycles counted from the render start,
  // the same grid in every chunk.
  begin = job.floor + Math.floor((begin - job.floor) / job.window) * job.window;

  // Chunk time 0 sits on the output's sample grid (counted from `floor`), so
  // every chunk's samples line up exactly with a single-chunk render.
  const sr = job.sampleRate;
  const beginFrame = Math.floor(((begin - job.floor) / cps) * sr);
  const offset = beginFrame / sr; // seconds from `floor` to chunk time 0
  const time = (cycle: number) => (cycle - job.floor) / cps - offset;

  const frames = Math.ceil(((job.renderUntil - job.floor) / cps) * sr) - beginFrame;
  const ctx = new OfflineAudioContext(2, frames, sr);
  mainContext = ctx;
  setAudioContext(ctx);
  setSuperdoughAudioController(null);
  getSuperdoughAudioController();
  await initAudio({ maxPolyphony: job.maxPolyphony, multiChannelOrbits: false });

  let scheduleMs = 0;
  let scheduled = 0;
  const schedule = async (c0: number, c1: number) => {
    const t0 = performance.now();
    const haps = pattern
      .queryArc(c0, c1, { _cps: cps })
      .filter((h: any) => h.hasOnset() && h.whole.begin.valueOf() < job.onsetsUntil)
      .sort((a: any, b: any) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
    for (const hap of haps) {
      hap.ensureObjectValue();
      const t = time(hap.whole.begin.valueOf());
      try {
        await superdough(hap.value, t, hap.duration / cps, cps, t);
      } catch (err) {
        console.error(err);
      }
    }
    scheduled += haps.length;
    scheduleMs += performance.now() - t0;
  };

  // Stay one window ahead of the renderer: windows 0 and 1 go in before
  // rendering starts; at the start of window k (a suspend), queue window
  // k+1 and resume.
  const w = job.window;
  const lastOnset = Math.min(job.onsetsUntil, job.renderUntil);
  const at = (k: number) => begin + k * w;
  const queue = (k: number) => at(k) < lastOnset && schedule(at(k), Math.min(at(k + 1), lastOnset));
  await queue(0);
  await queue(1);
  await settle();

  const armSuspend = (k: number) => {
    if (at(k + 1) >= lastOnset) return; // nothing left to queue
    ctx.suspend(time(at(k))).then(async () => {
      await queue(k + 1);
      window.srProgress?.(job.index, at(k));
      armSuspend(k + 1);
      await settle();
      await ctx.resume();
    });
  };
  armSuspend(1);
  const buffer = await ctx.startRendering();

  // interleave and upload as raw float32
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  const out = new Float32Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    out[2 * i] = L[i]!;
    out[2 * i + 1] = R[i]!;
  }
  const res = await fetch(job.uploadUrl, { method: 'PUT', body: out });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return { beginFrame, frames: L.length, cps, scheduleMs, scheduled };
}

window.srInit = init;
window.srInfo = info;
window.srRender = render;
