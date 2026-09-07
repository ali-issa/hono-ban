---
'hono-ban': minor
---

Add `hono-ban/postgresql`: `postgresMapper(options?)` turns a Postgres driver error into a catalog
entry by SQLSTATE with constant client-facing text, for `createBan({ map })` or
`ban.onError({ map })`.

- Recognizes the errors of node-postgres, PGlite, postgres.js, Neon, and Bun, directly or through
  the `cause` of an ORM wrapper such as Drizzle's `DrizzleQueryError` (also Sequelize 6 `original`
  and Objection `nativeError`). Nothing from the driver's `message`, `detail`, or `hint` reaches
  `detail`, `meta`, or `headers`; the driver error stays on the report.
- Built-in table: unique, exclusion, foreign key, and restrict violations are 409; not-null, check,
  and data exceptions are 422; serialization failures, deadlocks, `NOWAIT` locks, read-only
  replicas, and the connection, resource, and operator classes are 503, with `Retry-After` when
  `retryAfter` is set. Codes with no row (syntax, privilege, `RAISE`, statement timeout, commit
  outcome unknown) fall through to the handler's constant 500 with `handled: false`.
- `constraints`, `columns`, and `codes` override the entry, detail, meta, and headers per constraint
  name, `table.column`, SQLSTATE, or class; a constraint or column can instead map to a validation
  error with one issue at a path.
- `findPostgresError(value)` and `readPostgresFields(error)` are exported for `onReport` sinks.
