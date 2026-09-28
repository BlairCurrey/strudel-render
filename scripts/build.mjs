// Builds dist/: the browser page (strudel + superdough bundled in), and the
// Node library and CLI (playwright-core left as a dependency).
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });

await build({
  entryPoints: ['src/page.ts'],
  outfile: 'dist/page.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'chrome120',
  minify: true,
  legalComments: 'linked', // the AGPL / MIT notices of everything bundled
  logLevel: 'warning',
});

await build({
  entryPoints: ['src/render.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  packages: 'external',
  logLevel: 'warning',
});
