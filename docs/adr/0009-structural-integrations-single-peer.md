# ADR 0009: Integrations are typed structurally; hono is the only peer dependency

- Status: accepted
- Date: 2026-09-07

## Context

The Zod, Valibot, Standard Schema, OpenAPI, and OpenTelemetry integrations each touch objects
defined by another package: a `ZodError`, a Valibot `BaseIssue`, a Standard Schema `Issue`, an
OpenAPI Response Object, an OpenTelemetry `Span`. Importing those packages' types would make each an
optional peer dependency, force consumers to install them to get clean declaration files, and tie
hono-ban releases to their major versions. hono-problem-details takes that route and lists five
optional peers.

## Decision

- Every integration module declares the minimal structural shape it reads (`ZodIssueLike`,
  `ValibotIssueLike`, `StandardSchemaIssue`, `OtelTraceLike`, and so on) and never imports the
  third-party package at runtime or in types. The Standard Schema interfaces are vendored in
  `src/internal/standard-schema-types.ts`.
- `hooks.test-d.ts` proves the hook functions are assignable to the real `@hono/zod-validator`,
  `@hono/zod-openapi`, `@hono/valibot-validator`, and `@hono/standard-validator` hook types, and the
  runtime tests exercise the real validators, so drift is caught in CI rather than by users.
- `hono-ban/openapi` returns plain OpenAPI Response Objects. `@hono/zod-openapi` accepts raw schema
  objects in `content[*].schema`, so no Zod wrapping helper exists.
- `hono-ban/testing` takes a `compile` function instead of depending on Ajv.

## Consequences

`package.json` has a single peer dependency, `hono`. The third-party packages are devDependencies
only. A validator that changes the shape it passes to hooks breaks the type test in this repository
first; fixing it means widening or adjusting a `*Like` interface, not bumping a peer range.
