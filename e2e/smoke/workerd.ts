/**
 * Runs the smoke checks inside workerd, the Cloudflare Workers runtime, via
 * Miniflare. workerd executes the module graph it is handed and never reads
 * `node_modules`, so `worker.ts` is bundled first with tsdown using
 * `platform: 'neutral'` (no Node shims), the way a consumer's Workers bundle
 * is built. Node runs this file: `node --experimental-strip-types`.
 * @ref https://developers.cloudflare.com/workers/testing/miniflare/get-started/
 * @ref https://tsdown.dev/options/platform
 */
import { Miniflare } from 'miniflare';
import { build } from 'tsdown';

import { report, runChecks } from './checks.ts';

const OUT_DIR = 'smoke/.workerd';
/** Any date at or before the pinned workerd release; current behavior is what is tested. */
const COMPATIBILITY_DATE = '2026-07-01';
const ORIGIN = 'http://smoke.invalid';

await build({
  // The root tsdown.config.ts builds the library; this bundle is self-contained.
  config: false,
  entry: { worker: 'smoke/worker.ts' },
  outDir: OUT_DIR,
  format: 'esm',
  platform: 'neutral',
  fixedExtension: true,
  dts: false,
  clean: true,
  logLevel: 'error',
});

const mf = new Miniflare({
  modules: true,
  scriptPath: `${OUT_DIR}/worker.mjs`,
  compatibilityDate: COMPATIBILITY_DATE,
});
await mf.ready;
try {
  report(
    await runChecks(async (path, init) =>
      mf.dispatchFetch(new URL(path, ORIGIN), init),
    ),
  );
} finally {
  await mf.dispose();
}
