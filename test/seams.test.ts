// The part of the tool most likely to break quietly: rendering in chunks must
// give the same audio as rendering in one piece. The fixture has no noise
// sources, so a render is exactly repeatable, and measured at 0.1.0 the
// chunked render sits at -81 dB overall, -69 dB in its worst half-second.
// The thresholds leave room for that, and no more.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { before, describe, test } from 'node:test';
import { diffDb, FIXTURES, renderToWav, windowDiffs, type Wav } from './helpers.ts';

const file = join(FIXTURES, 'seams.js');

describe('seams', () => {
  let one: Wav;
  let again: Wav;
  let chunked: Wav;

  before(async () => {
    [one, again, chunked] = await Promise.all([
      renderToWav(file, 'seams-one').then((r) => r.wav),
      renderToWav(file, 'seams-again').then((r) => r.wav),
      renderToWav(file, 'seams-chunked', { jobs: 4, chunks: 6 }).then((r) => r.wav),
    ]);
  });

  test('a render is repeatable', (t) => {
    assert.equal(again.data.length, one.data.length);
    const d = diffDb(one.data, again.data);
    t.diagnostic(`${d.toFixed(1)} dB`);
    assert.ok(d < -100, `two single-chunk renders differ by ${d.toFixed(1)} dB`);
  });

  test('a chunked render is the same length as a single-chunk render', () => {
    assert.equal(chunked.data.length, one.data.length);
  });

  test('a chunked render matches a single-chunk render', (t) => {
    const d = diffDb(one.data, chunked.data);
    t.diagnostic(`${d.toFixed(1)} dB`);
    assert.ok(d < -65, `chunked differs from single by ${d.toFixed(1)} dB overall`);
  });

  test('no half-second around any seam differs audibly', (t) => {
    const worst = windowDiffs(one, chunked, 0.5).sort((a, b) => b.db - a.db)[0]!;
    t.diagnostic(`worst ${worst.db.toFixed(1)} dB at ${worst.at.toFixed(1)}s`);
    assert.ok(worst.db < -55, `at ${worst.at.toFixed(1)}s the chunked render differs by ${worst.db.toFixed(1)} dB`);
  });
});
