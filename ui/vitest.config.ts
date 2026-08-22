import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    css: false,
  },
});
