// Finding a Chromium-based browser to render in.
//
// Order: the one you named (--chrome / STRUDEL_RENDER_CHROME); then Google
// Chrome, Microsoft Edge, Brave and Chromium where they're usually installed;
// then the headless Chromium that `strudel-render --install-browser` downloads.
// Firefox and Safari can't be used: rendering pauses an OfflineAudioContext
// part-way to queue notes, which only Chromium supports.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type LaunchOptions } from 'playwright-core';

/** No browser was found. Recoverable: `installBrowser()`, then launch again. */
export class NoBrowserError extends Error {
  constructor() {
    super(
      'no Chromium-based browser found — looked for Google Chrome, Microsoft Edge, Brave and Chromium.\n' +
        'Install one of those, point at one with --chrome /path/to/browser (or STRUDEL_RENDER_CHROME),\n' +
        'or let strudel-render download a headless Chromium (about 100 MB, once) by adding\n' +
        '--install-browser to the command, or with:\n\n' +
        '  npx strudel-render --install-browser',
    );
    this.name = 'NoBrowserError';
  }
}

export interface Candidate {
  name: string;
  launch: Pick<LaunchOptions, 'channel' | 'executablePath'>;
}

const ARGS = ['--autoplay-policy=no-user-gesture-required'];

/** Browsers worth trying on this platform, most likely first. Existence is checked by the caller. */
export function candidates(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): Candidate[] {
  // Chrome and Edge through Playwright's channels, which know where each OS
  // installs them.
  const list: Candidate[] = [
    { name: 'Google Chrome', launch: { channel: 'chrome' } },
    { name: 'Microsoft Edge', launch: { channel: 'msedge' } },
  ];
  const path = (name: string, executablePath: string) => list.push({ name, launch: { executablePath } });

  if (platform === 'darwin') {
    for (const apps of ['/Applications', join(homedir(), 'Applications')]) {
      path('Google Chrome', join(apps, 'Google Chrome.app/Contents/MacOS/Google Chrome'));
      path('Microsoft Edge', join(apps, 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'));
      path('Brave', join(apps, 'Brave Browser.app/Contents/MacOS/Brave Browser'));
      path('Chromium', join(apps, 'Chromium.app/Contents/MacOS/Chromium'));
    }
  } else if (platform === 'win32') {
    for (const base of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA]) {
      if (!base) continue;
      path('Brave', join(base, 'BraveSoftware/Brave-Browser/Application/brave.exe'));
      path('Chromium', join(base, 'Chromium/Application/chrome.exe'));
    }
  } else {
    for (const [name, bin] of [
      ['Brave', 'brave-browser'],
      ['Brave', 'brave'],
      ['Chromium', 'chromium'],
      ['Chromium', 'chromium-browser'],
    ] as const) {
      for (const dir of (env.PATH ?? '').split(delimiter)) if (dir) path(name, join(dir, bin));
    }
  }
  return list;
}

/** Launches the named browser, or the first one found. */
export async function launchBrowser(
  chromePath?: string,
  log: (m: string) => void = () => {},
  list: Candidate[] = candidates(),
  managed = true,
): Promise<Browser> {
  if (chromePath) {
    try {
      return await chromium.launch({ executablePath: chromePath, args: ARGS });
    } catch (err) {
      throw new Error(`could not start the browser at ${chromePath}: ${firstLine(err)}`);
    }
  }
  // Test hook: pretend no browser is installed (Playwright's own download still
  // counts), to exercise the no-browser path.
  if (process.env.STRUDEL_RENDER_TEST_NO_BROWSER) list = [];
  for (const c of list) {
    if (c.launch.executablePath && !existsSync(c.launch.executablePath)) continue;
    try {
      const browser = await chromium.launch({ ...c.launch, args: ARGS });
      log(`browser: ${c.name}${c.launch.executablePath ? ` (${c.launch.executablePath})` : ''}`);
      return browser;
    } catch {
      // not installed, or wouldn't start: try the next
    }
  }
  if (managed) {
    try {
      // Playwright's own headless Chromium, if --install-browser has run
      const browser = await chromium.launch({ args: ARGS });
      log('browser: headless Chromium (installed by strudel-render --install-browser)');
      return browser;
    } catch {}
  }
  throw new NoBrowserError();
}

/**
 * Downloads Playwright's headless Chromium into its shared cache
 * (~/Library/Caches/ms-playwright, ~/.cache/ms-playwright, %LOCALAPPDATA%\ms-playwright),
 * using playwright-core's own installer.
 */
export function installBrowser(): number {
  const cli = join(dirname(fileURLToPath(import.meta.resolve('playwright-core'))), 'cli.js');
  const r = spawnSync(process.execPath, [cli, 'install', 'chromium-headless-shell'], { stdio: 'inherit' });
  return r.status ?? 1;
}

function firstLine(err: unknown) {
  return String((err as Error)?.message ?? err).split('\n')[0];
}
