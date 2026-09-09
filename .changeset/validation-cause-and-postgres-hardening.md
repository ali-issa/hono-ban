---
'hono-ban': minor
---

`ban.validation()` accepts `cause`, and `hono-ban/postgresql` keeps its reporting contract for every
mapping kind.

- `ValidationOptions` gains an optional `cause`, stored on the error like every other `cause` and
  never rendered, so a converted validator or driver failure reaches `ErrorReport.error.cause`.
- `postgresMapper()` passes the driver error as `cause` for `{ issue }` mappings too. Previously an
  ordinary mapping put it on `report.error.cause` and an issue mapping left that member undefined.
- `postgresMapper()` reads `codes` entries as own properties, like `constraints` and `columns`, and
  rejects a `retryAfter` above `Number.MAX_SAFE_INTEGER`, whose `String()` form is exponential and
  not RFC 9110 `delay-seconds`.
