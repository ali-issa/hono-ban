# ADR 0011: Per-call options never contradict the generated schema

- Status: accepted
- Date: 2026-09-07

## Context

The README promises that the schema a format publishes and the body it renders "cannot disagree".
Two things broke that promise before this decision:

1. Every factory accepted `code` and `title` per call (`ban.notFound({ code: 'ORDER_MISSING' })`),
   while every built-in format pins `status`, `code`, and `title` in its schema with `const` (or a
   single-value `enum` in the OpenAPI 3.0 dialect). A response built with either option failed
   validation against the response the same instance documented for that entry.
2. `errorResponses()` merged same-status entries with `oneOf`. Built-in formats discriminate by
   `code`, so exactly one branch matched. A `defineFormat` format that emits one shape for every
   entry made every body match every branch, which `oneOf` rejects.

RFC 9457 says the same thing about `title`: it "SHOULD NOT change from occurrence to occurrence of
the problem, except for purposes of localization" (section 3.1.3). Localization already has a home
in the handler's `transform` option, which is explicitly outside the schema.

## Decision

- `BanErrorOptions` carries `detail`, `type`, `instance`, `meta`, `headers`, `cause`, and `id`.
  `code` and `title` come from the catalog entry only. A different `code` or `title` is a different
  catalog entry: add one to `errors` (which also documents it) or use `ban.custom()`.
- `CustomErrorInit` keeps `code` and `title`: custom errors have no catalog entry and no schema, so
  nothing can disagree with them.
- `type` stays overridable per call. Both formats declare it as a URI reference
  (`format: uri-reference`), so any string a caller supplies conforms.
- `errorResponses()` merges same-status entries with `anyOf` after collapsing structurally identical
  schemas. `anyOf` requires a body to satisfy at least one entry's schema, which is exactly the
  guarantee the library gives; `oneOf` demanded a discrimination the format contract never promised.

## Consequences

- The type checker rejects `code` and `title` on factory calls and on `ban.error()`;
  `create-ban.test-d.ts` proves it. The schemas keep their `const` members, which is what makes
  per-status responses useful to client generators.
- OpenAPI documents change from `oneOf` to `anyOf` for shared statuses. Validators accept the same
  bodies as before for the built-in formats, and now also accept bodies from non-discriminating
  custom formats.
- `ban.custom()` responses remain undocumentable by the OpenAPI helpers, as before (SPEC 5.3).
