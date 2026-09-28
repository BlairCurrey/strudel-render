// Every fixture in fixtures/features renders, is not silent, and is as long
// as it should be. One cycle at the fixtures' tempo is 2 seconds.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { FIXTURES, peakDb, renderToWav } from './helpers.ts';

const dir = join(FIXTURES, 'features');
const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();

describe('features', { concurrency: 4 }, () => {
  for (const f of files) {
    test(f, async () => {
      const name = f.replace(/\.js$/, '');
      // arrange.js must find its own length; the rest render 2 cycles
      const end = name === 'arrange' ? undefined : 2;
      const { result, wav } = await renderToWav(join(dir, f), `feature-${name}`, { end, tail: 0.5 });
      const expectedCycles = name === 'arrange' ? 3 : 2;
      assert.equal(result.end, expectedCycles);
      const seconds = wav.data.length / wav.channels / wav.rate;
      assert.ok(Math.abs(seconds - (expectedCycles / result.cps + 0.5)) < 0.01, `length ${seconds}s`);
      assert.ok(peakDb(wav.data) > -40, `nearly silent: peak ${peakDb(wav.data).toFixed(1)} dBFS`);
    });
  }
});
