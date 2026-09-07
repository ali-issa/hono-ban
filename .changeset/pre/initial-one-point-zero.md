---
'hono-ban': major
---

First 1.0 release. `createBan()` builds a typed error catalog with a factory per IANA status and per
custom entry, `ban.onError()` renders every thrown value once through a pluggable format (RFC 9457
Problem Details by default; JSON:API, Google API (AIP-193), Stripe, and plain built in;
`defineFormat()` for your own), validator hooks for Zod, Valibot, and Standard Schema throw into the
handler, `hono-ban/openapi` derives response schemas from the active format, and `hono-ban/otel`
adds trace ids. Error responses carry `Cache-Control: no-store` unless you set one, and
`bearerChallenge()` builds RFC 6750 and RFC 9728 `WWW-Authenticate` values. `hono` is the only peer
dependency.
