import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render, type RenderOptions } from '../src/render.ts';

export const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
export const tmp = mkdtempSync(join(tmpdir(), 'strudel-render-test-'));

export interface Wav {
  rate: number;
  channels: number;
  bits: number;
  /** interleaved samples, as floats */
  data: Float32Array;
}

/** Reads 16/24-bit PCM and 32-bit float WAVs. */
export function readWav(path: string): Wav {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path}: not a WAV`);
  let off = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | undefined;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (!fmt) throw new Error(`${path}: data before fmt`);
      const bps = fmt.bits / 8;
      const n = Math.floor(Math.min(size, b.length - body) / bps);
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const p = body + i * bps;
        if (fmt.format === 3) data[i] = b.readFloatLE(p);
        else if (fmt.bits === 16) data[i] = b.readInt16LE(p) / 32768;
        else if (fmt.bits === 24) data[i] = b.readIntLE(p, 3) / 8388608;
        else throw new Error(`${path}: unsupported ${fmt.bits}-bit PCM`);
      }
      return { rate: fmt.rate, channels: fmt.channels, bits: fmt.bits, data };
    }
    off = body + size + (size % 2);
  }
  throw new Error(`${path}: no data chunk`);
}

/** Renders a pattern file into the test's temp directory as 32-bit float. */
export async function renderToWav(file: string, name: string, options: Partial<RenderOptions> = {}) {
  const out = join(tmp, `${name}.wav`);
  const result = await render({ file, out, bits: 32, jobs: 1, ...options });
  return { result, wav: readWav(out) };
}

export const db = (power: number) => 10 * Math.log10(power + 1e-30);

export function peakDb(x: Float32Array) {
  let p = 0;
  for (const v of x) p = Math.max(p, Math.abs(v));
  return 20 * Math.log10(p + 1e-30);
}

/** Difference energy relative to signal energy, dB, over [from, to) samples. */
export function diffDb(a: Float32Array, b: Float32Array, from = 0, to = Math.min(a.length, b.length)) {
  let sig = 0;
  let dif = 0;
  for (let i = from; i < to; i++) {
    sig += a[i]! ** 2;
    dif += (a[i]! - b[i]!) ** 2;
  }
  return db(dif) - db(sig);
}

/** diffDb per window of `seconds`, skipping near-silent windows. */
export function windowDiffs(a: Wav, b: Wav, seconds: number) {
  const step = Math.round(seconds * a.rate) * a.channels;
  const n = Math.min(a.data.length, b.data.length);
  const out: { at: number; db: number }[] = [];
  for (let s = 0; s + step <= n; s += step) {
    let sig = 0;
    for (let i = s; i < s + step; i++) sig += a.data[i]! ** 2;
    if (db(sig / step) < -60) continue;
    out.push({ at: s / a.channels / a.rate, db: diffDb(a.data, b.data, s, s + step) });
  }
  return out;
}

/** RMS level in dB per window of `seconds`. */
export function envelope(w: Wav, seconds: number) {
  const step = Math.round(seconds * w.rate) * w.channels;
  const out: number[] = [];
  for (let s = 0; s + step <= w.data.length; s += step) {
    let e = 0;
    for (let i = s; i < s + step; i++) e += w.data[i]! ** 2;
    out.push(db(e / step));
  }
  return out;
}
