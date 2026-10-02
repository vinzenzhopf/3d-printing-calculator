import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Emits sw.js with the exact list of built files, so the app works offline after the first visit. */
function serviceWorker(): Plugin {
  const publicFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? publicFiles(join(dir, e.name)) : [relative('public', join(dir, e.name)).replaceAll('\\', '/')],
    );
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = [...Object.keys(bundle), ...publicFiles('public')].filter((f) => !f.endsWith('.map') && f !== 'index.html');
      const precache = ['./', ...files.sort()];
      const template = readFileSync('pwa/sw.js', 'utf8');
      const version = createHash('sha256').update(template).update(precache.join('\n')).digest('hex').slice(0, 12);
      const source = template
        .replace('self.__PRECACHE__', JSON.stringify(precache))
        .replace('__VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative base + hash routing: the build runs under any sub-path
  // (GitHub Pages project site, a VPS folder, or a local file server).
  base: './',
  plugins: [serviceWorker()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
