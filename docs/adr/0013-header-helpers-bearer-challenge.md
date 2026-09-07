# ADR 0013: A bearer challenge builder in the root; no per-status factory options; OAuth 2.0 errors as a documented format

- Status: accepted
- Date: 2026-09-07

## Context

SPEC 3.1 lists the headers HTTP requires the application to add to some error responses: a 401 MUST
carry `WWW-Authenticate` (RFC 9110 section 15.5.2), a 405 `Allow`, a 407 `Proxy-Authenticate`. Three
additions were weighed after that table was written:

1. A builder for the Bearer challenge. RFC 6750 section 3 fixes the attribute set (`realm`, `scope`,
   `error`, `error_description`, `error_uri`) and a character class for each value (RFC 6749
   appendix A `NQCHAR` and `NQSCHAR`), and RFC 9728 section 5.1 adds `resource_metadata`, which
   OAuth-protected resource servers now advertise. Writing the value by hand invites two mistakes: a
   quote or backslash from user input breaking the header, and attributes in a shape recipients
   reject. `hono/bearer-auth` only produces `realm` and `error`.
2. Typed per-status options such as `ban.methodNotAllowed({ allow: [...] })`.
3. A built-in OAuth 2.0 error format for token endpoints (RFC 6749 section 5.2). The `error`
   vocabulary is closed and differs per endpoint (token endpoint errors are a JSON body;
   authorization endpoint errors travel as redirect query parameters), so a general format is either
   lossy or opinionated about mapping catalog codes.

@ref https://www.rfc-editor.org/rfc/rfc6750#section-3 @ref
https://www.rfc-editor.org/rfc/rfc6749#appendix-A @ref
https://www.rfc-editor.org/rfc/rfc9728#section-5.1 @ref
https://www.rfc-editor.org/rfc/rfc6749#section-5.2

## Decision

- `bearerChallenge(options)` ships in the root export (`src/headers/bearer-challenge.ts`, SPEC 3.2).
  It returns the header value, validates every attribute against the grammar its RFC assigns and
  throws a `TypeError` otherwise, escapes the realm as an RFC 9110 quoted-string, and falls back to
  `realm=""` because RFC 6750 requires at least one attribute. It is a string builder: the header
  still travels through `BanErrorOptions.headers`.
- No per-status factory options. Every factory takes the same `BanErrorOptions` (DESIGN principle
  3); a `headers` entry is one line and `from()` already preserves middleware-set values.
- No built-in OAuth format. The README documents the token endpoint shape as a `defineFormat`
  example, and `e2e/format-custom-oauth.e2e.test.ts` serves that exact definition over HTTP and runs
  it through the conformance test, so the example stays correct.

## Consequences

- The 401 MUST becomes one call for bearer-token APIs, and RFC 9728 discovery needs no hand-built
  string. Other schemes (Basic, Digest, DPoP) still go through `headers` verbatim.
- Extension error codes are accepted (the grammar, not the RFC 6750 list, is enforced), so RFC 9470
  step-up challenges work without a library change.
- A future in-tree OAuth format needs a superseding ADR that settles the code mapping.
