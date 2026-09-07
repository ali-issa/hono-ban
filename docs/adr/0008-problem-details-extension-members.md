# ADR 0008: Problem Details renders `meta` as top-level extension members

- Status: accepted
- Date: 2026-09-07

## Context

RFC 9457 section 3.2 defines extension members as additional members of the problem details object
itself, not as a nested bag, and requires clients to ignore members they do not recognize. Section 4
(the paragraph after the problem type definition requirements) recommends that extension names start
with a letter, use only `ALPHA / DIGIT / "_"`, and are at least three characters long.
hono-problem-details follows the RFC by spreading its `extensions` object into the body and letting
the standard members win on collision; consumers of `application/problem+json` (client generators,
API gateways, RFC-aware tooling) expect this shape.

`BanError.meta` is format-agnostic: JSON:API defines a `meta` member on its error object, so the
same data must be nested there. The question is only how the Problem Details format presents it.

## Decision

- `problemDetails()` copies each `meta` entry whose key matches `^[A-Za-z][A-Za-z0-9_]{2,}$` onto
  the top level of the body. Entries whose key does not match are kept under one extension member
  named `meta` so nothing the caller provided is dropped.
- Standard members (`type`, `status`, `title`, `detail`, `instance`) and the library's own extension
  members (`code`, `id`, `traceId`, the configured `traceIdMember`, `stack`, `errors`) always win
  over a `meta` key of the same name, whether or not the error emits that member. The body stays
  RFC-valid and schema-valid no matter what a caller puts in `meta`.
- Before flattening, `meta` is shallow-copied without `__proto__`, `constructor`, and `prototype`
  (ADR 0007). Flattening never copies inherited properties.
- `jsonApi()` and `plain()` keep `meta` nested because their bodies define a `meta` member.

## Consequences

Callers who need a guaranteed nested object in Problem Details bodies use a single `meta` key of
their own, for example `meta: { context: { ... } }`. The OpenAPI schema for Problem Details bodies
keeps `additionalProperties: true`; the schema for the other two formats is closed. The normative
field order and examples are in `docs/SPEC.md` section 7.1.
