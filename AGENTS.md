# hono-ban: instructions for coding agents

This file is read by AI coding agents working in this repository. Humans: see `CONTRIBUTING.md`.

## Ground rules

- Read `docs/DESIGN.md` for intent and `docs/SPEC.md` for the exact contract before changing public
  API. Implement from the SPEC section named in the file header; update the SPEC in the same PR when
  the code must differ. Read the relevant ADR in `docs/adr/` before changing a decision it records;
  add a new ADR instead of silently reversing one.
- Doc-driven, not memory-driven. Before using any external API (Hono, Zod, Standard Schema, OpenAPI,
  npm packaging, RFC 9457, JSON:API), fetch the canonical document and cite it in the code with an
  `@ref <url>` comment next to the decision it justifies.
- Run the gates after every meaningful change, not at the end: `pnpm check:types`,
  `pnpm check:lint`, then `pnpm test`. Run `pnpm build`, `pnpm check`, and `pnpm test:e2e` before
  declaring done, in that order: the type-aware lint of `e2e/` and the package checks read `dist/`,
  and the e2e suite is the only check that exercises `dist/` and the `exports` map.
  `pnpm test:runtimes` (Bun, Deno, workerd smoke) needs `bun` and `deno` installed; CI runs it.
- Adding a wire format, a validator hook, or an observability module: follow "Adding a format or
  adapter" in `CONTRIBUTING.md`, which lists the acceptance policy and every file to touch.
- Tests are colocated (`x.test.ts`, `x.test-d.ts`) and cover behavior, not implementation. Coverage
  thresholds are enforced; do not lower them.
- The error handler never throws and never reveals server internals by default. Any change to
  `src/handler/` must keep the single-invocation and constant-500-detail tests green.
- No `process.env` at module scope, no Node-only APIs in `src/` (web standards only), no enums or
  parameter properties (`erasableSyntaxOnly`), no `any`, no `T[]`, no emojis.
- Commit subjects use conventional commits. Every user-visible change needs a changeset in
  `.changeset/` (`pnpm changeset`).
- Never mention AI assistance in commits, changesets, or docs.

## Repository map

- `src/core/` error class, definitions catalog, factories, `createBan`
- `src/formats/` wire formats (RFC 9457, JSON:API, plain, Google API, Stripe) and `defineFormat`
- `src/headers/` `bearerChallenge()`, the RFC 6750 `WWW-Authenticate` builder
- `src/handler/` the `onError` handler and error mapping
- `src/validation/` validation-issue normalization and validator hooks
- `src/openapi/` response schema helpers
- `src/observability/` the OpenTelemetry trace id adapter
- `src/testing/` consumer test helpers and format conformance
- `src/internal/` helpers that are never exported
- `src/test-support/` helpers for the repository's own tests (Ajv compiler); not published
- `e2e/` end-to-end suite: a private workspace package that consumes the built `hono-ban` through
  `workspace:*` and drives it over real HTTP with `@hono/node-server`; never imports from `src/`.
  `e2e/smoke/` is the runtime smoke test (Bun, Deno, workerd)
- `docs/DESIGN.md` what we are building and why; `docs/SPEC.md` the normative contract; `docs/adr/`
  decisions
