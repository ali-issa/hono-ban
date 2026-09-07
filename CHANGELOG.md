# hono-ban

## 1.2.0

### Minor Changes

- [`4a17ce0`](https://github.com/ali-issa/hono-ban/commit/4a17ce0676177c9ceff6f877731ab8f7ce513e2b) Thanks [@ali-issa](https://github.com/ali-issa)! - Add `hono-ban/postgresql`: `postgresMapper(options?)` turns a Postgres driver error into a catalog
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

## 1.1.0

### Minor Changes

- [`95a62e1`](https://github.com/ali-issa/hono-ban/commit/95a62e17f663f5f30522eda7fb76d4ef63b3487c) Thanks [@ali-issa](https://github.com/ali-issa)! - Validate options at construction instead of producing broken responses.
  
  - `problemDetails()` throws `TypeError` when `traceIdMember` names a reserved member (`status`,
    `id`, `errors`, ...) or is not an RFC 9457 extension member name; `jsonApi()` rejects a
    `traceIdMetaKey` the format writes itself (`stack`, `location`, `code`, ...) or that is not a
    JSON:API member name; `googleApi()` rejects a `traceIdMetadataKey` outside the
    `ErrorInfo.metadata` key grammar. Previously `traceIdMember: 'status'` replaced the numeric status
    with the trace id.
  - `ban.onError()` throws `TypeError` when `errorIdHeader`, `requestIdHeader`, or `headers` holds a
    name or value `Headers` rejects. Previously the failure surfaced inside the handler's last-resort
    fallback and the handler rejected.
  - `googleApi()` drops `meta` keys that do not match `[a-z][a-zA-Z0-9-_]+` or exceed 64 characters,
    as `error_details.proto` requires for `ErrorInfo.metadata`, and the 2020-12 schema states the rule
    with `propertyNames`. Keys such as `order.id` or `UserId` were previously sent as-is.

### Patch Changes

- [`95a62e1`](https://github.com/ali-issa/hono-ban/commit/95a62e17f663f5f30522eda7fb76d4ef63b3487c) Thanks [@ali-issa](https://github.com/ali-issa)! - Keep every rendered validation body inside its own schema and the handler inside its guarantee.
  
  - `jsonApi()` renders one summary error object for `ban.validation([])` instead of an empty `errors`
    array its schema rejects; `googleApi()` omits `BadRequest` when there are no issues instead of
    sending an empty `fieldViolations`.
  - `assertFormatConformance` from `hono-ban/testing` now also renders a validation error with no
    issues per location.
  - `ban.onError()` gains a third fallback tier: when the header merge itself throws, the response
    still carries `Content-Type`, `Cache-Control: no-store`, and the error id header.

## 1.0.0

### Major Changes

- [`efcb0b6`](https://github.com/ali-issa/hono-ban/commit/efcb0b6bd24a598bf0e8868bff9942ec248a7868) Thanks [@ali-issa](https://github.com/ali-issa)! - First 1.0 release. `createBan()` builds a typed error catalog with a factory per IANA status and per
  custom entry, `ban.onError()` renders every thrown value once through a pluggable format (RFC 9457
  Problem Details by default; JSON:API, Google API (AIP-193), Stripe, and plain built in;
  `defineFormat()` for your own), validator hooks for Zod, Valibot, and Standard Schema throw into the
  handler, `hono-ban/openapi` derives response schemas from the active format, and `hono-ban/otel`
  adds trace ids. Error responses carry `Cache-Control: no-store` unless you set one, and
  `bearerChallenge()` builds RFC 6750 and RFC 9728 `WWW-Authenticate` values. `hono` is the only peer
  dependency.

## 1.0.0-alpha.1

### Major Changes

- First 1.0 release. `createBan()` builds a typed error catalog with a factory per IANA status and per
  custom entry, `ban.onError()` renders every thrown value once through a pluggable format (RFC 9457
  Problem Details by default; JSON:API, Google API (AIP-193), Stripe, and plain built in;
  `defineFormat()` for your own), validator hooks for Zod, Valibot, and Standard Schema throw into the
  handler, `hono-ban/openapi` derives response schemas from the active format, and `hono-ban/otel`
  adds trace ids. Error responses carry `Cache-Control: no-store` unless you set one, and
  `bearerChallenge()` builds RFC 6750 and RFC 9728 `WWW-Authenticate` values. `hono` is the only peer
  dependency.

Release notes are generated by [Changesets](https://github.com/changesets/changesets) from the
entries in `.changeset/` when a version PR is merged.
