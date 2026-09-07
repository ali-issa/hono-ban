# ADR 0004: Web standards only; no ambient environment reads

- Status: accepted
- Date: 2026-09-07

## Context

Hono targets Cloudflare Workers, Deno, Bun, and Node. Reading `process.env.NODE_ENV` at module scope
throws on workerd without `nodejs_compat`, freezes behavior at import time, and cannot be changed
per app or per test. Unguarded `Error.captureStackTrace` and Node-only id libraries fail the same
way outside Node. @ref https://hono.dev/docs/helpers/adapter#env @ref
https://developers.cloudflare.com/workers/runtime-apis/nodejs/

## Decision

Source under `src/` uses only APIs defined by web standards or ECMAScript: `Response`, `Headers`,
`crypto.randomUUID`, `structuredClone`. Nothing reads `process`, `Deno`, `Bun`, or `navigator`.
Behavior that depends on the deployment environment (`includeStack`, `docsBaseUrl`) is an explicit
option; the README shows how to derive it from `env(c)` or the platform's own config. CI runs the
unit and end-to-end suites on Node 22 and 24 and one smoke app (`e2e/smoke/`) on Bun, Deno, and
workerd through Miniflare.

## Consequences

Users who want `NODE_ENV`-style switching write one line themselves. The package has no runtime
dependencies. Type-checking uses the `dom` lib for the web types rather than `@types/node`.
