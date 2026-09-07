# ADR 0003: A format owns both the schema and the renderer

- Status: accepted
- Date: 2026-09-07

## Context

When OpenAPI schemas and response bodies come from unrelated code paths, nothing stops a 422 schema
from describing a payload the validation path never produces, or a misspelled member (`details` for
`detail`) from shipping in the schema and on the wire without anything noticing. Any design where
docs and wire are produced separately will drift.

## Decision

An `ErrorFormat` is a single object that provides `contentType`, `render(error, ctx)`, and
`schema(definition, ctx)`. Built-in formats ship both, and a conformance test (exported for custom
formats as `assertFormatConformance`) renders every catalog entry and validates the result against
the schema for that entry. `defineFormat` additionally accepts a Standard Schema object with JSON
Schema support as the `schema`, in which case `render` is typed to return that schema's output type,
so a mismatch is a compile error. @ref https://standardschema.dev @ref
https://json-schema.org/draft/2020-12 @ref https://spec.openapis.org/oas/v3.1.0#schema-object

## Consequences

Adding a member to a format means changing one object. The OpenAPI helpers have no knowledge of any
specific format. Built-in formats must not depend on Zod or any schema library, so they express
schemas as JSON Schema literals; that is more verbose than a Zod definition but keeps `hono` the
only required peer.
