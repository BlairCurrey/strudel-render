#!/usr/bin/env node
// strudel-render <pattern.js> -o <out.wav|.mp3|.flac> [options]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { joinNegativeNumbers } from './args.ts';
import { createInterface } from 'node:readline/promises';
import { installBrowser } from './browser.ts';
import { clock, render } from './render.ts';

const USAGE = `usage: strudel-render <pattern.js> -o <out.wav|.mp3|.flac> [options]
       strudel-render -e '<code>' -o <out> [options]

Renders a Strudel pattern file to audio with strudel's own engine, in
headless Chrome, several chunks in parallel.

  -o, --out PATH   output file; anything but .wav is encoded with ffmpeg
  --start N        first cycle (default 0)
  -e, --code CODE  render this code instead of a file
  --end N          last cycle (default: the length of the top-level arrange())
  --seconds S      render S seconds from --start, instead of --end
  -j, --jobs N     parallel renderers (default: half the CPU cores)
  --chunks N       pieces to cut the span into (default: 2 x jobs)
  --rate HZ        sample rate (default 48000)
  --tail S         seconds rendered after --end so the last notes ring out (default 5)
  --normalize DB   scale so the peak sits at DB dBFS, e.g. -1
  --bits 16|24|32  WAV sample format; 32 is float and cannot clip (default 24)
  --chrome PATH    a Chromium-based browser (default: $STRUDEL_RENDER_CHROME, else
                   the first of Chrome, Edge, Brave, Chromium found)
  --install-browser  with a pattern: if no browser is found, download a
                   headless Chromium (about 100 MB, once) without asking —
                   for CI. Alone: download it now.
  -v, --verbose    print the browser console
  -h, --help       this
  --version        print the version

tuning:
  --preroll N      cycles rendered before each chunk and thrown away (default 8)
  --lookback N     how far back a chunk may reach for held notes, cycles (default 64)
  --window S       seconds of notes scheduled ahead at a time (default 0.2)
  --xfade S        crossfade at each seam, seconds (default 0.05)
  --polyphony N    max voices (default 1024, as strudel.cc's export)
  --seed N         Math.random seed (default 1)`;

const argv = joinNegativeNumbers(process.argv.slice(2));

let parsed;
try {
  parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      start: { type: 'string' },
      end: { type: 'string' },
      seconds: { type: 'string' },
      code: { type: 'string', short: 'e' },
      jobs: { type: 'string', short: 'j' },
      chunks: { type: 'string' },
      rate: { type: 'string' },
      tail: { type: 'string' },
      preroll: { type: 'string' },
      lookback: { type: 'string' },
      window: { type: 'string' },
      xfade: { type: 'string' },
      polyphony: { type: 'string' },
      normalize: { type: 'string' },
      bits: { type: 'string' },
      seed: { type: 'string' },
      chrome: { type: 'string' },
      verbose: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
      'install-browser': { type: 'boolean' },
    },
  });
} catch (err) {
  console.error(`${(err as Error).message}\n\n${USAGE}`);
  process.exit(2);
}
const { values: opt, positionals } = parsed;

if (opt.version) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}
if (opt['install-browser'] && positionals.length === 0 && opt.code === undefined) process.exit(installBrowser());
if (opt.help) {
  console.log(USAGE);
  process.exit(0);
}
if (positionals.length !== (opt.code === undefined ? 1 : 0) || !opt.out) {
  console.error(USAGE);
  process.exit(2);
}

function num(name: string, value: string | undefined) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    console.error(`--${name} must be a number, got "${value}"`);
    process.exit(2);
  }
  return n;
}

const bits = num('bits', opt.bits);
if (bits !== undefined && bits !== 16 && bits !== 24 && bits !== 32) {
  console.error('--bits must be 16, 24 or 32');
  process.exit(2);
}

if (opt.end !== undefined && opt.seconds !== undefined) {
  console.error('use --end or --seconds, not both');
  process.exit(2);
}

const file = opt.code === undefined ? resolve(positionals[0]!) : undefined;
const tty = process.stderr.isTTY;
let last = 0; // progress fraction at the previous report
console.error(file ?? '(code from -e)');

try {
  const r = await render({
    file,
    code: opt.code,
    out: opt.out,
    start: num('start', opt.start),
    end: num('end', opt.end),
    seconds: num('seconds', opt.seconds),
    jobs: num('jobs', opt.jobs),
    chunks: num('chunks', opt.chunks),
    sampleRate: num('rate', opt.rate),
    tail: num('tail', opt.tail),
    preroll: num('preroll', opt.preroll),
    lookback: num('lookback', opt.lookback),
    window: num('window', opt.window),
    xfade: num('xfade', opt.xfade),
    maxPolyphony: num('polyphony', opt.polyphony),
    normalize: num('normalize', opt.normalize),
    bits,
    seed: num('seed', opt.seed),
    chromePath: opt.chrome,
    verbose: opt.verbose,
    onNoBrowser: async () => {
      if (opt['install-browser']) return true;
      // ask, when someone is there to answer
      if (!process.stdin.isTTY || !tty) return false;
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        const a = await rl.question(
          '\nNo Chromium-based browser found (looked for Chrome, Edge, Brave, Chromium).\n' +
            'Download a headless Chromium for strudel-render (about 100 MB, once)? [Y/n] ',
        );
        return !/^n/i.test(a.trim());
      } catch {
        return false; // Ctrl+D / Ctrl+C: treat as no
      } finally {
        rl.close();
      }
    },
    onLog: (m) => console.error(`${tty ? '\r\x1b[K' : ''}  ${m}`),
    onProgress: ({ fraction, elapsed, speed }) => {
      const line =
        `  ${(fraction * 100).toFixed(1).padStart(5)}%  ${elapsed.toFixed(0)}s  ${speed.toFixed(1)}x realtime` +
        (fraction > 0.02 && fraction < 1 ? `  eta ${clock(elapsed / fraction - elapsed)}` : '');
      // one updating line on a terminal; every 10% otherwise
      if (tty) process.stderr.write(`\r\x1b[K${line}`);
      else if (Math.floor(fraction * 10) !== Math.floor(last * 10)) console.error(line);
      last = fraction;
    },
  });
  if (tty) process.stderr.write('\n');
  console.error(
    `  peak ${r.peakDb.toFixed(1)} dBFS` +
      (r.clipped ? ` · ${r.clipped} samples clipped — try --normalize -1 or --bits 32` : ''),
  );
  console.error(`  wrote ${r.out} (${clock(r.duration)}) in ${r.elapsed.toFixed(1)}s`);
} catch (err) {
  if (tty) process.stderr.write('\n');
  console.error(`strudel-render: ${(err as Error).message}`);
  process.exit(1);
}

