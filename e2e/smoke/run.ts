/**
 * In-process entry for Bun and Deno: the runtime under test hosts the app and
 * `app.request()` drives it, so every subpath is loaded and executed by that
 * runtime. Both resolve `hono-ban` through `node_modules` the way Node does;
 * Deno 2 does so because `package.json` puts it in manual `node_modules` mode.
 * @ref https://bun.com/docs/runtime/modules
 * @ref https://docs.deno.com/runtime/fundamentals/node/#control-node_modules
 */
import { app } from './app.ts';
import { report, runChecks } from './checks.ts';

report(await runChecks(async (path, init) => app.request(path, init)));
