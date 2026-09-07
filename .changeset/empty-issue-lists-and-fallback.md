---
'hono-ban': patch
---

Keep every rendered validation body inside its own schema and the handler inside its guarantee.

- `jsonApi()` renders one summary error object for `ban.validation([])` instead of an empty `errors`
  array its schema rejects; `googleApi()` omits `BadRequest` when there are no issues instead of
  sending an empty `fieldViolations`.
- `assertFormatConformance` from `hono-ban/testing` now also renders a validation error with no
  issues per location.
- `ban.onError()` gains a third fallback tier: when the header merge itself throws, the response
  still carries `Content-Type`, `Cache-Control: no-store`, and the error id header.
