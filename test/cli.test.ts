// The command as a user runs it: the built dist/cli.js.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { FIXTURES, readWav, tmp } from './helpers.ts';

const cli = new URL('../dist/cli.js', import.meta.url).pathname;
const run = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env });
const pattern = (name: string, code: string) => {
  const path = join(tmp, `${name}.js`);
  writeFileSync(path, code);
  return path;
};

describe('cli', { concurrency: 4 }, () => {
  test('--version prints the package version', () => {
    const r = run(['--version']);
    assert.equal(r.status, 0);
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(r.stdout.trim(), pkg.version);
  });

  test('--help prints usage and exits 0', () => {
    const r = run(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /usage: strudel-render/);
  });

  test('missing arguments print usage and exit 2', () => {
    assert.equal(run([]).status, 2);
    assert.equal(run(['a.js']).status, 2); // no -o
    assert.match(run(['a.js']).stderr, /usage/);
  });

  test('bad option values exit 2 with a message', () => {
    const r = run(['a.js', '-o', 'x.wav', '--bits', '12']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--bits must be 16, 24 or 32/);
    const n = run(['a.js', '-o', 'x.wav', '--end', 'soon']);
    assert.equal(n.status, 2);
    assert.match(n.stderr, /--end must be a number/);
    assert.match(run(['a.js', '-o', 'x.wav', '--frobnicate']).stderr, /Unknown option/);
  });

  test('-e renders code from the command line, and --seconds sets the length', () => {
    const out = join(tmp, 'inline.wav');
    const r = run(['-e', 'note("c4 e4 g4").s("triangle")', '-o', out, '--seconds', '3', '--tail', '0', '-j', '1']);
    assert.equal(r.status, 0, r.stderr);
    const w = readWav(out);
    assert.equal(w.data.length / 2, 3 * 48000);
  });

  test('--seconds counts from --start', () => {
    const out = join(tmp, 'from-start.wav');
    const r = run([join(FIXTURES, 'features/synths.js'), '-o', out, '--start', '1', '--seconds', '1.5', '--tail', '0', '-j', '1']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readWav(out).data.length / 2, 1.5 * 48000);
  });

  test('a chunk bigger than one upload part arrives whole', () => {
    // 50 s of stereo float is 4.8M samples: more than one 4M-sample upload part
    const out = join(tmp, 'long-chunk.wav');
    const r = run(['-e', 'note("c3").s("sine")', '-o', out, '--seconds', '50', '--tail', '0', '--bits', '32', '-j', '1', '--chunks', '1']);
    assert.equal(r.status, 0, r.stderr);
    const w = readWav(out);
    assert.equal(w.data.length / 2, 50 * 48000);
    // a sine note every 2 s: never 0.1 s of silence, as a dropped or misplaced part would leave
    const win = 0.1 * 48000 * 2;
    for (let s = 0; s + win <= w.data.length; s += win) {
      let e = 0;
      for (let i = s; i < s + win; i++) e += w.data[i]! ** 2;
      assert.ok(e > 1e-3, `silent at ${(s / 2 / 48000).toFixed(1)}s`);
    }
  });

  test('--end and --seconds together exit 2', () => {
    const r = run(['a.js', '-o', 'x.wav', '--end', '4', '--seconds', '8']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--end or --seconds, not both/);
  });

  test('-e with a file as well prints usage', () => {
    assert.equal(run(['a.js', '-e', 's("bd")', '-o', 'x.wav']).status, 2);
  });

  test('a file without arrange() asks for --end', () => {
    const r = run([pattern('no-arrange', 'note("c3").s("sine")'), '-o', join(tmp, 'x.wav')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no top-level arrange\(\).*--end/);
  });

  test('a syntax error reports the message, not the page internals', () => {
    const r = run([pattern('syntax', 'note("c3".s('), '-o', join(tmp, 'x.wav'), '--end', '1']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /in the pattern or the page: Unexpected token/);
    assert.doesNotMatch(r.stderr, /page\.js:\d+/);
  });

  test('with no browser and no one to ask, it explains the options and downloads nothing', () => {
    const r = run([pattern('nb', 'note("c3").s("sine")'), '-o', join(tmp, 'x.wav'), '--end', '1'], {
      ...process.env,
      STRUDEL_RENDER_TEST_NO_BROWSER: '1',
      PLAYWRIGHT_BROWSERS_PATH: join(tmp, 'no-playwright-browsers'), // hide any downloaded one too
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no Chromium-based browser found/);
    assert.match(r.stderr, /--install-browser/);
    assert.doesNotMatch(r.stderr, /\[Y\/n\]/); // stdin isn't a terminal: no prompt
  });

  test('a missing browser explains how to point at one', () => {
    const r = run([pattern('any', 'note("c3").s("sine")'), '-o', join(tmp, 'x.wav'), '--end', '1', '--chrome', '/nonexistent/chrome']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /could not start the browser at \/nonexistent\/chrome/);
  });

  test('a non-WAV output without ffmpeg fails before rendering', () => {
    // a PATH with nothing on it but node (on Linux ffmpeg can live in /usr/bin)
    const bin = join(tmp, 'node-only-bin');
    mkdirSync(bin, { recursive: true });
    if (!existsSync(join(bin, 'node'))) symlinkSync(process.execPath, join(bin, 'node'));
    const r = run([pattern('any2', 'note("c3").s("sine")'), '-o', join(tmp, 'x.mp3'), '--end', '1'], {
      ...process.env,
      PATH: bin,
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /needs ffmpeg/);
  });

  test('--normalize takes a negative number and hits it', () => {
    const out = join(tmp, 'normalized.wav');
    const r = run([join(FIXTURES, 'features/synths.js'), '-o', out, '--end', '1', '--normalize', '-3', '--bits', '32', '-j', '1']);
    assert.equal(r.status, 0, r.stderr);
    const w = readWav(out);
    let peak = 0;
    for (const v of w.data) peak = Math.max(peak, Math.abs(v));
    assert.ok(Math.abs(20 * Math.log10(peak) + 3) < 0.01, `peak ${(20 * Math.log10(peak)).toFixed(2)} dBFS`);
  });

  test('--bits 16 and --rate 44100 write that format', () => {
    const out = join(tmp, 'cd.wav');
    const r = run([join(FIXTURES, 'features/synths.js'), '-o', out, '--end', '1', '--bits', '16', '--rate', '44100', '-j', '1', '--tail', '0']);
    assert.equal(r.status, 0, r.stderr);
    const w = readWav(out);
    assert.equal(w.bits, 16);
    assert.equal(w.rate, 44100);
    assert.equal(w.data.length / 2, Math.round(2 * 44100)); // 1 cycle at 0.5 cps
  });
});
