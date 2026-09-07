import type { UserConfig } from 'tsdown';

import { defineConfig } from 'tsdown';

/**
 * Library build. ESM only, runtime neutral, declarations via oxc
 * (isolatedDeclarations). `exports` keeps package.json in sync with the
 * entry map below; publint and attw run as part of the build.
 * @ref https://tsdown.dev/options/config-file
 * @ref https://tsdown.dev/options/package-exports
 */
const config: UserConfig = defineConfig({
  entry: {
    index: 'src/index.ts',
    'formats/problem-details': 'src/formats/problem-details/index.ts',
    'formats/json-api': 'src/formats/json-api/index.ts',
    'formats/plain': 'src/formats/plain/index.ts',
    'formats/google-api': 'src/formats/google-api/index.ts',
    'formats/stripe': 'src/formats/stripe/index.ts',
    zod: 'src/validation/zod.ts',
    valibot: 'src/validation/valibot.ts',
    'standard-schema': 'src/validation/standard-schema.ts',
    openapi: 'src/openapi/index.ts',
    otel: 'src/observability/otel.ts',
    testing: 'src/testing/index.ts',
  },
  format: 'esm',
  platform: 'neutral',
  target: 'es2023',
  dts: true,
  sourcemap: true,
  clean: true,
  exports: true,
  publint: true,
  attw: true,
});

export default config;
