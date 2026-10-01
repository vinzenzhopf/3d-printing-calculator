import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base + hash routing: the build runs under any sub-path
  // (GitHub Pages project site, a VPS folder, or a local file server).
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
