import type { ViteUserConfig } from 'vitest/config';

import { defineConfig } from 'vitest/config';

/**
 * End-to-end suite. Each file starts a real Node HTTP server on an ephemeral
 * port and drives it with fetch; the timeouts allow for that.
 * @ref https://vitest.dev/config/
 */
const config: ViteUserConfig = defineConfig({
  test: {
    include: ['**/*.e2e.test.ts'],
    environment: 'node',
    restoreMocks: true,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

export default config;
