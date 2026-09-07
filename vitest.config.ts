import type { ViteUserConfig } from 'vitest/config';

import { defineConfig } from 'vitest/config';

/**
 * @ref https://vitest.dev/config/
 */
const config: ViteUserConfig = defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    // The format conformance tests compile two JSON Schemas per catalog entry;
    // on a two-core CI runner with coverage instrumentation and one worker per
    // file that can pass Vitest's 5 s default. Same headroom as e2e/.
    testTimeout: 20_000,
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Only the root barrel is excluded: every other index.ts holds real code.
      exclude: ['src/**/*.test.ts', 'src/**/*.test-d.ts', 'src/index.ts'],
      reporter: ['text', 'lcov', 'json-summary'],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});

export default config;
