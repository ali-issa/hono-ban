# ADR 0007: Nothing about the server reaches a client unless a factory put it there

- Status: accepted (clarified 2026-09-07: driver error mapping ships as the `hono-ban/postgresql`
  subpath, ADR 0015)
- Date: 2026-09-07

## Context

Error layers leak by default. Forwarding a database driver's `DETAIL` text sends the failing row,
key values, and column and table names to clients; returning schema errors as `400` with the
driver's hint exposes the schema; echoing an unvalidated `X-Request-Id` into logs is log injection.
None of it shows up in a happy-path test, and a claim of sanitization is easy to make without a test
that proves it.

## Decision

- An unknown error (anything that is not a `BanError`, an `HTTPException`, or matched by `map`)
  becomes a `500` whose `detail` is the constant `"An unexpected error occurred"`. The original
  error is available only through `ErrorReport.cause`.
- `includeStack` adds the stack under the format's extension member on `500` responses only and
  defaults to `false`; `detail` never changes.
- `HTTPException.message` is treated as client-safe because Hono middleware writes it for clients;
  its `res` headers are preserved.
- `meta` is shallow-copied with `__proto__`, `constructor`, and `prototype` removed before
  rendering.
- The request id is echoed only when it matches `^[A-Za-z0-9._-]{1,128}$`; otherwise it is treated
  as absent. The library never fabricates a request id; the error id is the correlation key.
- Rendered bodies over a configurable cap (default 64 KiB) are replaced by a minimal body in the
  same format with the same status.

## Consequences

Database and infrastructure error translation is not part of the core; application code or a
separate package maps driver errors to catalog entries with client-safe messages, never by
forwarding driver text. Users who want verbose errors in development set `includeStack` from their
own environment.
