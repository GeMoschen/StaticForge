import { fileURLToPath } from 'node:url';
import angular from '@analogjs/vite-plugin-angular';
import { defineConfig } from 'vitest/config';

// ESM config (`.mts`): @analogjs/vite-plugin-angular is ESM-only and cannot be
// `require`d from a CJS-transpiled `vitest.config.ts`. The plugin inlines
// `templateUrl` / `styleUrl` resources at transform time, which Angular's JIT
// TestBed needs — without it every component with external template/styles
// fails with "is not resolved: Did you run resolveComponentResources()?".
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [angular({ jit: true, inlineStylesExtension: 'scss' })],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    css: false,
    // Separate processes, not worker threads: with the threads this setup ran on, every spec file leaked its jsdom window
    // into a long-lived worker (heap up to the 4 GB limit by the last third of ~310 files) and a full run ended with
    // "Worker terminated due to reaching memory limit" (unhandled errors). A process per file stays below 1 GB.
    pool: 'forks',
  },
});
