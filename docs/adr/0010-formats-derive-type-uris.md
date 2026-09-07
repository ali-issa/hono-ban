# ADR 0010: Formats derive type URIs; the catalog keeps only explicit ones

- Status: accepted
- Date: 2026-09-07

## Context

`createBan({ docsBaseUrl })` used to bake `${docsBaseUrl}/${code}` into every resolved catalog
entry, and factories copied it onto `BanError.type`. Both formats then read `error.type` first, so
the format options `problemDetails({ typeBaseUrl })` and `jsonApi({ typeLinkBaseUrl })`, documented
as overriding `docsBaseUrl`, only ever applied to `ban.custom()` errors, which have no catalog
entry. The end-to-end suite caught the contradiction: the same option produced different results for
a catalog error and a custom error on one instance.

Two derivation points for one value is the root cause. ADR 0003 already assigns rendering to the
format, and the type URI is a rendering concern: Problem Details calls it `type`, JSON:API calls it
`links.type`, and the plain format has no such member at all.

## Decision

- `ErrorDefinition.type` and `ResolvedDefinition.type` hold only a URI the caller declared.
  `resolveDefinition` never derives one; `ban.catalog[key].type` is `undefined` unless declared.
- `BanError.type` holds only an explicit URI (from the definition or from `BanErrorOptions.type`).
- Each format derives the wire value at render time as `${base}/${code}` where `base` is its own
  option (`typeBaseUrl`, `typeLinkBaseUrl`) or else `ctx.docsBaseUrl`, and falls back to
  `about:blank` (Problem Details) or omits `links.type` (JSON:API). An explicit `error.type` always
  wins. `RenderOptions.docsBaseUrl` therefore overrides the instance value uniformly.

## Consequences

- The documented option semantics hold for every error, custom or catalog.
- Code that read `error.type` or `ban.catalog[key].type` to obtain the derived URI must render
  instead (`ban.render(error).body`). Nothing published relied on the old value.
- OpenAPI schemas are unaffected: both formats declare `type` and `links.type` as URI references
  (`format: uri-reference`, RFC 3986 section 4.1), not constants.
