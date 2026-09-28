// Pure functions: no browser.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { joinNegativeNumbers } from '../src/args.ts';
import { clock, wavHeader } from '../src/wav.ts';
import { readWav, tmp } from './helpers.ts';

test('wavHeader round-trips through a WAV reader at every bit depth', () => {
  const samples = [0, 0.5, -0.5, 0.25, -1, 0.999];
  for (const bits of [16, 24, 32]) {
    const bps = bits / 8;
    const body = Buffer.alloc(samples.length * bps);
    samples.forEach((v, i) => {
      if (bits === 16) body.writeInt16LE(Math.round(v * 32767), i * 2);
      else if (bits === 24) body.writeIntLE(Math.round(v * 8388607), i * 3, 3);
      else body.writeFloatLE(v, i * 4);
    });
    const path = join(tmp, `header-${bits}.wav`);
    writeFileSync(path, Buffer.concat([wavHeader(samples.length / 2, 44100, bits), body]));
    const w = readWav(path);
    assert.equal(w.rate, 44100);
    assert.equal(w.channels, 2);
    assert.equal(w.bits, bits);
    assert.equal(w.data.length, samples.length);
    w.data.forEach((v, i) => assert.ok(Math.abs(v - samples[i]!) < 4 / 2 ** bits + 1e-6, `${bits}-bit sample ${i}: ${v}`));
  }
});

test('wavHeader refuses output past the 4 GB WAV limit', () => {
  assert.throws(() => wavHeader(2 ** 30, 48000, 32), /too large/);
});

test('clock formats minutes and tenths', () => {
  assert.equal(clock(0), '0:00.0');
  assert.equal(clock(65.25), '1:05.3');
  assert.equal(clock(3600), '60:00.0');
});

test('joinNegativeNumbers attaches negative values to the option before them', () => {
  assert.deepEqual(joinNegativeNumbers(['a.js', '--normalize', '-1', '-o', 'x.wav']), ['a.js', '--normalize=-1', '-o', 'x.wav']);
  assert.deepEqual(joinNegativeNumbers(['--start', '-0.5']), ['--start=-0.5']);
  // short flags and options that already have a value are left alone
  assert.deepEqual(joinNegativeNumbers(['-v', '-1']), ['-v', '-1']);
  assert.deepEqual(joinNegativeNumbers(['--end=4', '-1']), ['--end=4', '-1']);
});
