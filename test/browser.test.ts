// Finding a browser. Launching is real, so these use browsers that exist
// on the machine, and skip otherwise.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { candidates, launchBrowser, NoBrowserError } from '../src/browser.ts';

test('candidates cover Chrome, Edge, Brave and Chromium on every platform', () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    const env = { PATH: '/usr/bin:/usr/local/bin', PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' };
    const names = new Set(candidates(platform, env).map((c) => c.name));
    for (const n of ['Google Chrome', 'Microsoft Edge', 'Brave', 'Chromium']) assert.ok(names.has(n), `${platform}: ${n}`);
  }
});

test('Chrome comes first', () => {
  assert.deepEqual(candidates()[0], { name: 'Google Chrome', launch: { channel: 'chrome' } });
});

test('a browser that is not installed is skipped, and the next one used', async (t) => {
  const brave = candidates().find((c) => c.name === 'Brave' && existsSync(c.launch.executablePath ?? ''));
  const chrome = { name: 'Google Chrome', launch: { executablePath: '/nonexistent/Google Chrome' } };
  const fallback = brave ?? candidates()[0]!; // Chrome's channel, where Brave isn't installed (CI)
  const logs: string[] = [];
  const browser = await launchBrowser(undefined, (m) => logs.push(m), [chrome, fallback], false);
  await browser.close();
  t.diagnostic(logs.join('; '));
  assert.match(logs.join(), new RegExp(`browser: ${fallback.name}`));
});

test('with nothing found, the error says what to do', async () => {
  const missing = [{ name: 'Google Chrome', launch: { executablePath: '/nonexistent/chrome' } }];
  await assert.rejects(launchBrowser(undefined, () => {}, missing, false), (err: Error) => {
    assert.ok(err instanceof NoBrowserError, 'a NoBrowserError, so render() can offer the download');
    assert.match(err.message, /no Chromium-based browser found/);
    assert.match(err.message, /--install-browser to the command/);
    assert.match(err.message, /--chrome/);
    assert.match(err.message, /npx strudel-render --install-browser/);
    return true;
  });
});
