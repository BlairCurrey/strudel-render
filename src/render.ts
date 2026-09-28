// strudel-render — render a Strudel pattern file to audio, headless, in parallel.
//
// The piece is cut into chunks of cycles. Each chunk renders in its own
// headless Chrome page (strudel's real engine: superdough, worklets,
// soundfonts), with a pre-roll so held notes and reverb are already sounding
// when the chunk begins. Chunks are stitched with a short crossfade.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { availableParallelism, homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import type { Job, JobResult } from './protocol.ts';
import { clock, wavHeader } from './wav.ts';

export { clock };

export interface RenderOptions {
  /** Strudel source code. Give this or `file`. */
  code?: string;
  /** Path to a Strudel pattern file. */
  file?: string;
  /** Output path. `.wav` is written directly; any other extension is encoded by ffmpeg. */
  out: string;
  /** First cycle. Default 0. */
  start?: number;
  /** Last cycle. Default: the length of the top-level `arrange()`. */
  end?: number;
  /** Parallel renderers. Default: CPU cores − 1. */
  jobs?: number;
  /** Pieces to cut the span into. Default: 2 × jobs. */
  chunks?: number;
  /** Sample rate. Default 48000. */
  sampleRate?: number;
  /** Seconds rendered past `end` so the last notes ring out. Default 5. */
  tail?: number;
  /** Cycles rendered before each chunk and thrown away. Default 8. */
  preroll?: number;
  /** How far back a chunk may reach for held notes, in cycles. Default 64. */
  lookback?: number;
  /** Cycles scheduled per suspend/resume. Default 4. */
  window?: number;
  /** Crossfade at each seam, in seconds. Default 0.05. */
  xfade?: number;
  /** Max voices. Default 1024, as strudel.cc's export. */
  maxPolyphony?: number;
  /** Scale so the peak sits at this many dBFS, e.g. -1. Default: no scaling. */
  normalize?: number;
  /** WAV sample format: 16, 24, or 32 (float). Default 24. */
  bits?: 16 | 24 | 32;
  /** Seed for Math.random in the page. Default 1. */
  seed?: number;
  /** Chrome or Chromium binary. Default: $STRUDEL_RENDER_CHROME, else the installed Google Chrome. */
  chromePath?: string;
  /** Where samples and soundfonts are cached. Default: ~/.cache/strudel-render. */
  cacheDir?: string;
  /** Called about once a second while rendering. */
  onProgress?: (p: Progress) => void;
  /** Informational messages: the plan, the browser console when `verbose`. */
  onLog?: (message: string) => void;
  /** Forward the browser console to `onLog`. */
  verbose?: boolean;
}

export interface Progress {
  /** 0–1 */
  fraction: number;
  /** seconds since the render started */
  elapsed: number;
  /** audio seconds rendered per wall-clock second */
  speed: number;
}

export interface RenderResult {
  out: string;
  /** seconds of audio written, including the tail */
  duration: number;
  /** cycles per second of the pattern */
  cps: number;
  start: number;
  end: number;
  /** peak level after normalisation, dBFS */
  peakDb: number;
  /** samples clipped when converting to 16/24-bit */
  clipped: number;
  /** wall-clock seconds */
  elapsed: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const HTML = '<!doctype html><meta charset="utf-8"><script type="module" src="/page.js"></script>';

export async function render(options: RenderOptions): Promise<RenderResult> {
  const o = {
    start: 0,
    sampleRate: 48000,
    tail: 5,
    preroll: 8,
    lookback: 64,
    window: 4,
    xfade: 0.05,
    maxPolyphony: 1024,
    bits: 24 as const,
    seed: 1,
    jobs: Math.max(1, availableParallelism() - 1),
    // an option given as undefined means "use the default"
    ...Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined)),
  } as RenderOptions & Required<Pick<RenderOptions, 'start' | 'sampleRate' | 'tail' | 'preroll' | 'lookback' | 'window' | 'xfade' | 'maxPolyphony' | 'bits' | 'seed' | 'jobs'>>;
  if (![16, 24, 32].includes(o.bits)) throw new Error('bits must be 16, 24 or 32');
  const code = o.code ?? (o.file ? readFileSync(o.file, 'utf8') : undefined);
  if (code === undefined) throw new Error('pass `code` or `file`');
  const outPath = resolve(o.out);
  const log = o.onLog ?? (() => {});
  const wantWav = extname(outPath).toLowerCase() === '.wav';
  if (!wantWav && spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error(`writing ${extname(outPath)} needs ffmpeg on the PATH — install it, or write .wav`);
  }

  // dist/page.js sits next to the compiled module; from src/, look in dist/
  const pagePath = [join(here, 'page.js'), join(here, '../dist/page.js')].find(existsSync);
  if (!pagePath) throw new Error('page bundle missing — run `npm run build`');
  const pageJs = readFileSync(pagePath);
  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;

  // ---- local server: the page, and uploads of rendered chunks
  const work = await mkdtemp(join(tmpdir(), 'strudel-render-'));
  const server = createServer((req, res) => {
    if (req.method === 'PUT' && req.url?.startsWith('/upload/')) {
      const name = req.url.slice('/upload/'.length).replace(/[^\w.-]/g, '');
      const ws = createWriteStream(join(work, name));
      req.pipe(ws);
      ws.on('finish', () => res.writeHead(200).end());
      ws.on('error', () => res.writeHead(500).end());
      return;
    }
    if (req.url === '/page.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(pageJs);
    res.writeHead(200, { 'content-type': 'text/html' }).end(HTML);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const cacheDir =
    o.cacheDir ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'strudel-render');
  mkdirSync(cacheDir, { recursive: true });

  let browser: Browser | undefined;
  try {
    browser = await launch(o.chromePath ?? process.env.STRUDEL_RENDER_CHROME);
    let progressHook: (job: number, cycle: number) => void = () => {};

    // A BrowserContext per page keeps each renderer in its own process, so
    // the JS that schedules notes doesn't queue behind the other jobs.
    const newPage = async (): Promise<Page> => {
      const ctx = await browser!.newContext();
      await withCache(ctx, cacheDir);
      const page = await ctx.newPage();
      page.on('pageerror', (e) => log(`[page] ${e.message}`));
      if (o.verbose) page.on('console', (m) => log(`[page] ${m.text()}`));
      await page.exposeFunction('srProgress', (job: number, cycle: number) => progressHook(job, cycle));
      await page.goto(origin);
      await page.waitForFunction(() => typeof window.srInit === 'function');
      await page.evaluate((seed) => window.srInit(seed), o.seed);
      return page;
    };

    // ---- plan
    const first = await newPage();
    const { cps, cycles } = await first.evaluate((c) => window.srInfo(c), code).catch(pageError);
    const start = o.start;
    const end = o.end ?? cycles;
    if (end == null) throw new Error('no top-level arrange() found, so the length is unknown — pass an end cycle (--end)');
    if (!(end > start)) throw new Error(`nothing to render: start ${start}, end ${end}`);

    const nChunks = Math.max(1, Math.min(o.chunks ?? o.jobs * 2, Math.floor(end - start)));
    const bounds = Array.from({ length: nChunks + 1 }, (_, i) =>
      i === nChunks ? end : start + Math.round(((end - start) * i) / nChunks),
    );
    const xfCycles = o.xfade * cps;
    const duration = (end - start) / cps;
    log(
      `cycles ${start}–${end} at ${(cps * 60).toFixed(2)} cpm = ${clock(duration)}` +
        ` · ${nChunks} chunks on ${Math.min(o.jobs, nChunks)} renderers · ${o.sampleRate} Hz`,
    );

    // ---- render
    const done = new Array<number>(nChunks).fill(0);
    progressHook = (job, cycle) => {
      done[job] = Math.max(done[job]!, Math.min(cycle, bounds[job + 1]!) - bounds[job]!);
    };
    const ticker = setInterval(() => {
      const fraction = done.reduce((a, b) => a + b, 0) / (end - start);
      o.onProgress?.({ fraction, elapsed: elapsed(), speed: (fraction * duration) / elapsed() });
    }, 1000);

    const results: (JobResult & { path: string })[] = [];
    let next = 0;
    const worker = async (page: Page) => {
      while (next < nChunks) {
        const i = next++;
        const last = i === nChunks - 1;
        const job: Job = {
          index: i,
          code,
          from: bounds[i]!,
          to: bounds[i + 1]!,
          onsetsUntil: last ? end : bounds[i + 1]! + xfCycles,
          renderUntil: last ? end + o.tail * cps : bounds[i + 1]! + xfCycles,
          floor: start,
          preroll: o.preroll,
          lookback: o.lookback,
          window: o.window,
          sampleRate: o.sampleRate,
          maxPolyphony: o.maxPolyphony,
          uploadUrl: `${origin}/upload/chunk-${i}.f32`,
        };
        const r = await page.evaluate((j) => window.srRender(j), job).catch(pageError);
        if (o.verbose) log(`chunk ${i}: ${r.scheduled} notes, ${(r.scheduleMs / 1000).toFixed(1)}s scheduling`);
        done[i] = job.to - job.from;
        results[i] = { ...r, path: join(work, `chunk-${i}.f32`) };
      }
      await page.context().close();
    };
    try {
      const rest = await Promise.all(Array.from({ length: Math.min(o.jobs, nChunks) - 1 }, newPage));
      await Promise.all([first, ...rest].map(worker));
    } finally {
      clearInterval(ticker);
    }
    o.onProgress?.({ fraction: 1, elapsed: elapsed(), speed: duration / elapsed() });

    // ---- stitch
    // Output frame of cycle c. A chunk's own frame is this minus its beginFrame.
    const gf = (c: number) => Math.round(((c - start) / cps) * o.sampleRate);
    const xfFrames = Math.round(o.xfade * o.sampleRate);
    const pieces = results.map((r, i) => {
      const firstFrame = gf(bounds[i]!) - r.beginFrame;
      const count = i === nChunks - 1 ? r.frames - firstFrame : gf(bounds[i + 1]!) - gf(bounds[i]!);
      return { ...r, firstFrame, count: Math.min(count, r.frames - firstFrame) };
    });
    const totalFrames = pieces.reduce((n, p) => n + p.count, 0);

    // Walk the chunks in order, crossfading each seam, handing interleaved
    // stereo blocks to `sink`.
    const stitch = async (sink: (block: Float32Array) => void | Promise<void>) => {
      let carry: Float32Array | null = null; // the previous chunk's audio past its seam
      for (const p of pieces) {
        const buf = await readFile(p.path);
        const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
        const body = data.slice(p.firstFrame * 2, (p.firstFrame + p.count) * 2);
        if (carry) {
          const n = Math.min(carry.length, body.length) / 2;
          for (let f = 0; f < n; f++) {
            const w = (f + 0.5) / n;
            body[2 * f] = carry[2 * f]! * (1 - w) + body[2 * f]! * w;
            body[2 * f + 1] = carry[2 * f + 1]! * (1 - w) + body[2 * f + 1]! * w;
          }
        }
        const after = p.firstFrame + p.count;
        carry = data.slice(after * 2, Math.min(after + xfFrames, p.frames) * 2);
        await sink(body);
      }
    };

    // pass 1, only when normalising: the peak of the stitched output
    let gain = 1;
    if (o.normalize !== undefined) {
      let peak = 0;
      await stitch((block) => {
        for (const v of block) peak = Math.max(peak, Math.abs(v));
      });
      gain = peak > 0 ? 10 ** (o.normalize / 20) / peak : 1;
    }

    // pass 2: write. Into the work directory first, so a failed render never
    // leaves a truncated file at `out`.
    const wavPath = join(work, 'out.wav');
    const fh = await open(wavPath, 'w');
    const bps = o.bits / 8;
    await fh.write(wavHeader(totalFrames, o.sampleRate, o.bits));
    let peak = 0;
    let clipped = 0;
    await stitch(async (block) => {
      const out = Buffer.alloc(block.length * bps);
      for (let i = 0; i < block.length; i++) {
        const v = block[i]! * gain;
        const a = Math.abs(v);
        if (a > peak) peak = a;
        if (o.bits === 32) {
          out.writeFloatLE(v, i * 4);
          continue;
        }
        if (a > 1) clipped++;
        const c = Math.max(-1, Math.min(1, v));
        if (o.bits === 16) out.writeInt16LE(Math.round(c * 32767), i * 2);
        else out.writeIntLE(Math.round(c * 8388607), i * 3, 3);
      }
      await fh.write(out);
    });
    await fh.close();

    mkdirSync(dirname(outPath), { recursive: true });
    if (wantWav) {
      await rename(wavPath, outPath).catch(async () => {
        // across filesystems: copy by re-reading
        writeFileSync(outPath, await readFile(wavPath));
      });
    } else {
      const args = ['-y', '-loglevel', 'error', '-i', wavPath];
      if (extname(outPath).toLowerCase() === '.mp3') args.push('-codec:a', 'libmp3lame', '-q:a', '2');
      const ff = spawnSync('ffmpeg', [...args, outPath], { stdio: 'inherit' });
      if (ff.status !== 0) throw new Error('ffmpeg failed');
    }

    return {
      out: outPath,
      duration: totalFrames / o.sampleRate,
      cps,
      start,
      end,
      peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
      clipped,
      elapsed: elapsed(),
    };
  } finally {
    await browser?.close().catch(() => {});
    server.close();
    await rm(work, { recursive: true, force: true });
  }
}

// Errors thrown in the page arrive as "page.evaluate: Error: <msg>\n    at
// <minified frames>". Keep the message; the frames point into the bundle.
function pageError(err: Error): never {
  const msg = err.message.replace(/^page\.evaluate: (Error: )?/, '').split('\n    at ')[0];
  throw new Error(`in the pattern or the page: ${msg}`);
}

// playwright-core ships no browser: use the one given, or the installed Chrome.
async function launch(chromePath: string | undefined): Promise<Browser> {
  try {
    return await chromium.launch({
      ...(chromePath ? { executablePath: chromePath } : { channel: 'chrome' }),
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
  } catch (err) {
    throw new Error(
      (chromePath ? `could not start the browser at ${chromePath}` : 'could not find Google Chrome') +
        '. Install Google Chrome, or set STRUDEL_RENDER_CHROME to a Chrome or Chromium binary ' +
        '(for example one installed with `npx playwright install chromium`).\n' +
        (err as Error).message,
    );
  }
}

// Every page would otherwise download the sample maps, samples and
// soundfonts again. Cache GETs to disk, keyed by URL.
async function withCache(ctx: BrowserContext, cacheDir: string) {
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') return route.continue();
    const key = createHash('sha256').update(req.url()).digest('hex');
    const body = join(cacheDir, key);
    const meta = `${body}.json`;
    const cors = { 'access-control-allow-origin': '*' };
    if (existsSync(meta)) {
      const { status, type } = JSON.parse(await readFile(meta, 'utf8'));
      return route.fulfill({ status, headers: { ...cors, 'content-type': type }, body: await readFile(body) });
    }
    try {
      const res = await route.fetch();
      const buf = await res.body();
      const type = res.headers()['content-type'] ?? 'application/octet-stream';
      if (res.ok()) {
        writeFileSync(body, buf);
        writeFileSync(meta, JSON.stringify({ status: res.status(), type }));
      }
      return route.fulfill({ status: res.status(), headers: { ...cors, 'content-type': type }, body: buf });
    } catch {
      return route.abort();
    }
  });
}
