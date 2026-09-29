// Exports the reference WAVs for test/reference.test.ts from strudel.cc
// itself: opens https://strudel.cc with each fixture in the URL, fills in the
// Export tab, clicks Export, and saves the download. strudel-render is not
// involved, which is the point — the references are strudel.cc's own output.
//
//   npm run references            all fixtures
//   npm run references ref-synth  just these
//
// This drives strudel.cc's page, so a redesign of its Export tab can break
// it. When it does, the fix is in the selectors below.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const FIXTURES = new URL('../test/fixtures/reference/', import.meta.url).pathname;
const OUT = new URL('../test/reference/', import.meta.url).pathname;
const MANIFEST = join(OUT, 'references.json');
const CYCLES = 4;
const RATE = 48000;
const STRUDEL = process.env.STRUDEL_URL ?? 'https://strudel.cc/';

const wanted = process.argv.slice(2);
const names = readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.js'))
  .map((f) => f.replace(/\.js$/, ''))
  .filter((n) => wanted.length === 0 || wanted.includes(n))
  .sort();
if (names.length === 0) {
  console.error(`no fixtures match ${wanted.join(' ')}`);
  process.exit(2);
}

let manifest = {};
try {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
} catch {}

const browser = await chromium.launch({
  ...(process.env.STRUDEL_RENDER_CHROME ? { executablePath: process.env.STRUDEL_RENDER_CHROME } : { channel: 'chrome' }),
});
try {
  for (const name of names) {
    process.stderr.write(`${name} … `);
    const code = readFileSync(join(FIXTURES, `${name}.js`), 'utf8');
    const page = await browser.newPage();

    // strudel.cc reads code from the hash: base64 of UTF-8, URI-encoded
    const hash = encodeURIComponent(Buffer.from(code, 'utf8').toString('base64'));
    await page.goto(`${STRUDEL}#${hash}`, { waitUntil: 'networkidle' });
    const editor = await page.locator('.cm-content').innerText();
    const firstLine = code.split('\n').find((l) => l.trim() && !l.startsWith('//'));
    if (!editor.includes(firstLine)) throw new Error(`${name}: strudel.cc did not load the code from the URL`);

    await page.getByRole('button', { name: 'export', exact: true }).click();
    const field = (label) =>
      page.locator('div.grid').filter({ has: page.locator(`label:text-is("${label}")`) }).locator('input');
    await field('File name').fill(name);
    await field('Start cycle').fill('0');
    await field('End cycle').fill(String(CYCLES));
    await field('Sample rate').fill(String(RATE));

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 120_000 }),
      page.getByRole('button', { name: 'Export to WAV' }).click(),
    ]);
    const out = join(OUT, `${name}.wav`);
    await download.saveAs(out);
    await page.close();

    manifest[name] = {
      fixtureSha256: createHash('sha256').update(code).digest('hex'),
      exportedAt: new Date().toISOString(),
      from: STRUDEL,
      cycles: CYCLES,
      sampleRate: RATE,
    };
    console.error('ok');
  }
} finally {
  await browser.close();
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
}
