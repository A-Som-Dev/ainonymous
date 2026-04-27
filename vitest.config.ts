import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup/audit-watermark-isolation.ts'],
    // Some tests shell out to git or the CLI binary (auto-detect, audit
    // verify CLI invocations, persist-counter benchmarks). On Windows under
    // parallel CPU pressure those subprocesses can take more than the 5s
    // default. The 15s budget removes the flake without hiding genuinely
    // slow code, which would still trip the cap.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
