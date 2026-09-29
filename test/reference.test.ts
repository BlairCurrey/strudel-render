// Compare with strudel.cc's own Export. `npm run references` makes the WAVs
// (see reference/README.md); a fixture without one is skipped.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { diffDb, envelope, FIXTURES, readWav, renderToWav } from './helpers.ts';

const fixtures = join(FIXTURES, 'reference');
const refs = new URL('./reference/', import.meta.url).pathname;
const CYCLES = 4;

// How close each fixture must be. The default is for deterministic fixtures,
// which measure -72 to -79 dB sample for sample against strudel.cc.
const DEFAULT = { window: 0.05, envelopeDb: 1.5, sampleDb: -60 };
const TOLERANCE: Record<string, Partial<typeof DEFAULT> & { sampleDb?: number }> = {
  // strudel.cc's reverb impulse is unseeded noise. Two exports of this
  // fixture from strudel.cc differ from each other by up to 4.1 dB (250 ms
  // windows) and -10 dB sample for sample; strudel-render sits in the same
  // range. Checked at the level of "the same reverb", not the same samples.
  'ref-reverb': { window: 0.25, envelopeDb: 6.5, sampleDb: -6 },
};

// Differences found and not yet explained. The test still runs and reports.
const KNOWN: Record<string, string> = {
  'ref-synth':
    "strudel.cc's export has a transient at exactly cycle 2 on the delayed square lead (-17 dB, " +
    'ringing ~1 s in the delay), and a faint click there without the delay. It repeats exactly across ' +
    'exports, and sits on one of strudel.cc\'s one-cycle suspend points; strudel-render has neither. ' +
    'Everywhere else the two agree to -77 dB. Not audible: compared by ear (strudel.cc export vs ' +
    'strudel-render, and export vs strudel.cc live playback) on 2026-09-29, no difference heard.',
};
const manifestPath = join(refs, 'references.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

describe('matches strudel.cc', { concurrency: 2 }, () => {
  for (const f of readdirSync(fixtures).filter((f) => f.endsWith('.js')).sort()) {
    const name = f.replace(/\.js$/, '');
    const refPath = join(refs, `${name}.wav`);
    const skip = existsSync(refPath) ? false : `no reference: run \`npm run references ${name}\``;

    const tol = { ...DEFAULT, ...TOLERANCE[name] };
    test(name, { skip, todo: KNOWN[name] }, async (t) => {
      const sha = createHash('sha256').update(readFileSync(join(fixtures, f), 'utf8')).digest('hex');
      assert.equal(manifest[name]?.fixtureSha256, sha, `${f} changed since its reference was exported — run \`npm run references ${name}\``);
      const ref = readWav(refPath);
      const { wav } = await renderToWav(join(fixtures, f), `ref-${name}`, {
        end: CYCLES,
        tail: 0, // strudel.cc's export stops exactly at the end cycle
        sampleRate: ref.rate,
      });
      // strudel.cc writes 16-bit PCM, clamped at full scale
      for (let i = 0; i < wav.data.length; i++) wav.data[i] = Math.max(-1, Math.min(1, wav.data[i]!));

      const length = (w: typeof ref) => w.data.length / w.channels / w.rate;
      assert.ok(Math.abs(length(wav) - length(ref)) < 0.01, `length ${length(wav)}s vs strudel.cc ${length(ref)}s`);

      // Loudness per window, where either is audible.
      const a = envelope(ref, tol.window);
      const b = envelope(wav, tol.window);
      let worst = { at: 0, by: 0 };
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i]! < -50 && b[i]! < -50) continue;
        const by = Math.abs(a[i]! - b[i]!);
        if (by > worst.by) worst = { at: i * tol.window, by };
      }
      t.diagnostic(`envelope: worst ${worst.by.toFixed(2)} dB at ${worst.at.toFixed(2)}s`);
      assert.ok(worst.by < tol.envelopeDb, `loudness differs from strudel.cc by ${worst.by.toFixed(1)} dB at ${worst.at.toFixed(2)}s`);

      // Sample for sample: the same engine on the same sample grid.
      const d = diffDb(ref.data, wav.data);
      t.diagnostic(`sample-level difference: ${d.toFixed(1)} dB`);
      assert.ok(d < tol.sampleDb, `differs from strudel.cc by ${d.toFixed(1)} dB sample for sample`);
    });
  }
});
