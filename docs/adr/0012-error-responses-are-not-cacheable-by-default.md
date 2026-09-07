# ADR 0012: Error responses are not cacheable by default

- Status: accepted
- Date: 2026-09-07

## Context

RFC 9110 section 15.1 defines 404, 405, 410, 414, and 501 as heuristically cacheable: a cache may
store and reuse such a response without any explicit freshness information (RFC 9111 section 4.2.2).
RFC 6585 section 4 goes further for 429: "Responses with the 429 status code MUST NOT be stored by a
cache."

Every body this library renders carries an occurrence id (also in the `X-Error-Id` header), the
request path as `instance`, and, when present, the request id and trace id. Until this decision the
handler set no `Cache-Control`, so a shared cache in front of an API could store one client's 404
and serve it to another with a foreign error id, breaking the correlation guarantee of SPEC 10.2,
and a 429 relied on the application to satisfy the MUST. @ref
https://www.rfc-editor.org/rfc/rfc9110#section-15.1 @ref
https://www.rfc-editor.org/rfc/rfc9111#section-4.2.2 @ref
https://www.rfc-editor.org/rfc/rfc6585#section-4

## Decision

- `ban.onError()` sets `Cache-Control: no-store` on every response it produces, on the main path and
  on both fallback tiers, unless `options.headers` already carries a `Cache-Control`. An error's own
  headers are merged afterwards, so
  `ban.gone({ headers: { 'Cache-Control': 'public, max-age=3600' } })` also wins (SPEC 6.9).
  `no-store` forbids storing any part of the response (RFC 9111 section 5.2.2.5).
- The default is a constant, `DEFAULT_CACHE_CONTROL` (SPEC 13), not an option: the two override
  paths cover every case without adding a fourth way to set a header.
- `BanError.getResponse()` outside the handler is unchanged. It never carried the error id header
  either; the handler is where the library owns the response.

## Consequences

- Operators who want cacheable error responses (a static 404 page behind a CDN, a 410 for a
  permanently removed resource) set `Cache-Control` explicitly and take responsibility for the ids
  in the body.
- The 429 MUST holds without application code.
- Wire change: every error response gains one header. Recorded in the 1.0 changeset.
