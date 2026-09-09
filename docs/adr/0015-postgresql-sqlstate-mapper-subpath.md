# ADR 0015: Postgres SQLSTATE mapping ships as the `hono-ban/postgresql` subpath

- Status: accepted
- Date: 2026-09-07

## Context

ADR 0007 keeps driver error translation out of the core and forecast that "application code or a
separate package maps driver errors to catalog entries". `docs/DESIGN.md` section 7 named that
package `hono-ban-pg` and preferred it over a subpath for two reasons: its own release cadence and
its own driver peer dependency. Both were examined before building it:

- No driver peer is needed. The mapper reads a SQLSTATE and a handful of string fields off whatever
  error object the driver threw. The protocol sends the SQLSTATE (field `C`) and the severity (field
  `S`) in every ErrorResponse, and every surveyed driver copies them onto its error, so the input is
  typed structurally like every other integration (ADR 0009).
- No separate cadence is needed. The module has no dependencies, the SQLSTATE table comes from the
  Postgres manual's Appendix A and is stable across major versions, and the module changes when the
  catalog or the handler change, which is when `hono-ban` itself releases. `./zod`, `./valibot`, and
  `./otel` already ship optional integrations as subpaths under the same reasoning.

Sources consulted, all fetched on 2026-09-07:

- Protocol error fields and the SQLSTATE appendix: @ref
  https://www.postgresql.org/docs/current/protocol-error-fields.html @ref
  https://www.postgresql.org/docs/current/errcodes-appendix.html
- Driver error shapes: node-postgres `DatabaseError` (`pg-protocol/src/messages.ts`); PGlite, which
  rethrows the same class from `@electric-sql/pg-protocol` (`pglite/src/errors.ts`); postgres.js
  `PostgresError`, whose fields are `Object.assign`ed from `src/connection.js` `errorFields` (field
  `V` becomes `severity`, field `S` becomes `severity_local`, and the object fields are
  `constraint_name`, `table_name`, `schema_name`, `column_name`); Neon `NeonDbError`
  (`src/httpQuery.ts`); Bun `PostgresError`, where the Rust binding
  (`src/sql_jsc/postgres/protocol/error_response_jsc.rs`) puts the SQLSTATE on `errno` and the
  constant `ERR_POSTGRES_SERVER_ERROR` (or `ERR_POSTGRES_SYNTAX_ERROR` for 42601) on `code`.
- Wrappers: Drizzle `DrizzleQueryError` keeps the driver error on `cause`
  (`drizzle-orm/src/errors.ts`, from 0.44); Kysely rethrows the driver error itself after
  `extendStackTrace` (`src/dialect/postgres/postgres-driver.ts`, `src/util/stack-trace-utils.ts`);
  TypeORM's `QueryFailedError` and MikroORM's `DriverException` copy the driver error's own
  properties onto themselves; Slonik passes `{ cause }`; Sequelize 6 keeps it on `original` and
  `parent` (`v6/src/errors/database-error.ts`); `db-errors` (Objection) on `nativeError`
  (`lib/errors/DBError.js`).
- Prisma is out of scope: `@prisma/adapter-pg` converts the pg error into its own payload and Prisma
  Client rethrows `PrismaClientKnownRequestError` without a `cause`; its codes (`P2002`) match the
  SQLSTATE grammar, which is one reason recognition also requires a severity field.
- HTTP semantics: RFC 9110 sections 9.2.2 (idempotent methods), 15.5.10 (409), 15.5.21 (422), 15.6.4
  (503); PostgREST's SQLSTATE table (@ref
  https://docs.postgrest.org/en/stable/references/errors.html); Postgres transaction isolation docs
  on retrying serialization failures (@ref
  https://www.postgresql.org/docs/current/transaction-iso.html); PgBouncer `send_pooler_error`,
  which stamps 08P01 on every pooler error without a SQLSTATE of its own (@ref
  https://github.com/pgbouncer/pgbouncer/blob/master/src/proto.c).
- Behaviour verified against PGlite 0.5.8 (PostgreSQL 18.3) in the e2e suite: the field set of each
  condition, 23001 for `ON DELETE RESTRICT` (PostgreSQL 18; earlier versions raise 23503), 23503 in
  both directions with the FK-side constraint and table named, 23502 carrying `table` and `column`
  but no `constraint`.

## Decision

`hono-ban/postgresql` exports `postgresMapper(options?)`, `findPostgresError(value)`, and
`readPostgresFields(error)` (SPEC 6.10). The subpath is named after the database in full,
`postgresql`, because `postgres` is postgres.js's npm name and the module serves every driver.

Recognition: a value is a Postgres error when `code` or `errno` is five uppercase alphanumerics and
`severity` or `severity_local` is a string. `findPostgresError` follows `cause`, `original`, and
`nativeError` up to eight links.

Status table (`sqlstate.ts`): 409 for a duplicate, an overlap, or a missing or still-referenced row;
422 for a missing, invalid, or constraint-failing value; 503 only for conditions where the identical
request is expected to succeed after a delay (serialization failure, deadlock, `lock_not_available`,
a read-only replica, the connection, resource, and operator classes). `Retry-After` is attached only
to 503s and only when `retryAfter` is set. Codes excluded from their class row map to nothing: 08007
and 40003 (commit outcome unknown; 503 would invite resubmitting a write that may have been
applied), 53400 (`temp_file_limit` is per query), 57014 (a statement timeout, an operator cancel, or
the client's own abort look the same), and 2200H, 22P04, 22012 (raised by the application's SQL, not
a client value). 42501, 28xxx, 42xxx, P0001, and class XX map to nothing because in a single-role
deployment they are deployment or program errors; row-level security and `RAISE`-based business
rules override them through `codes`. 08P01 is ambiguous: Postgres raises it for a client protocol
mistake, PgBouncer for pool exhaustion and shutdown; the transient reading wins by default. 40001,
40P01, and 55P03 stay 503 rather than 409: the client retries the identical request, and ADR 0007
prevents meeting 409's "recognize the source of the conflict" guidance; with `googleApi()` this
renders `UNAVAILABLE`, and a 409 entry through `codes` renders `ABORTED`.

A recognized error with no mapping at any level returns `undefined`, so the handler's own
fallthrough produces the constant 500 with `handled: false`; a user mapping that sets no key uses
`INTERNAL_SERVER_ERROR`. The `BanError` `cause` is the driver error, never an ORM wrapper whose
message carries the query and its parameters; `ErrorReport.cause` stays the thrown value.

Options: `constraints` by constraint name, `columns` by `table.column` or `column` (the not-null
violation names no constraint), `codes` by SQLSTATE or class, and `retryAfter`. Each member of the
result comes from the first source that sets it. A `constraints` or `columns` entry with `issue`
returns `ban.validation()` with one issue. Lookups read own properties only. Header values, issue
shapes, `codes` keys, and `retryAfter` are validated at construction, matching ADR 0011's rule that
misconfiguration fails at startup.

Typing: `postgresMapper` is generic in the custom keys its options name and returns a function
accepted by any ban whose catalog defines them, so a mapper built in a database module works with
any ban without a type argument.

## Consequences

- The README's "companion package" gap closes; `docs/DESIGN.md` section 7 loses its only row. ADR
  0007's Decision stands; its Consequences sentence about a separate package is clarified by this
  record.
- Choosing the mapper never forwards driver text. Applications that want `RAISE EXCEPTION` messages
  on the wire compose their own `map` with `findPostgresError` and pass the message themselves; the
  package offers no opt-in for it.
- The e2e suite gains two devDependencies (`@electric-sql/pglite`, `drizzle-orm`) and the root gains
  `postgres` for a type-level check of the postgres.js spelling.
- To revisit: Sequelize 7 (`@sequelize/core`) moves the driver error to `cause`, so the `original`
  link can be dropped once 6 is unsupported; Bun's `severity` field was verified in its TypeScript
  wrapper and Rust binding, not at runtime; wire-compatible servers (CockroachDB raises 40003) may
  justify rows Postgres never raises.

## Amendment 2026-09-08: verification matrix

The first release verified two shapes against a live server (PGlite, Drizzle) and the rest by source
inspection and fixtures. Since 2026-09-08 the e2e suite also connects the real node-postgres and
postgres.js drivers over the wire protocol to the same PGlite through `@electric-sql/pglite-socket`
(`e2e/support/pglite-socket.ts`), so every built-in row is raised by a real server and thrown by the
real driver class for the three driver shapes that differ. Failing statements go through the simple
query protocol because PGlite answers each extended-protocol message with its own ReadyForQuery
(electric-sql/pglite issue 958), which desynchronizes a driver after a failed parameterized
statement. @ref https://pglite.dev/docs/pglite-socket @ref
https://github.com/electric-sql/pglite/issues/958

| Driver or ORM        | Version inspected or run          | Verified by                                                                                   |
| -------------------- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| PGlite               | 0.5.8 (PostgreSQL 18.3)           | Live server errors in-process, e2e (`postgresql-pglite*`)                                     |
| node-postgres (`pg`) | 8.23.0 (`pg-protocol` 1.16.0)     | Live server errors over `pglite-socket` 0.2.11, e2e (`postgresql-node-postgres`)              |
| postgres.js          | 3.4.9                             | Live server errors over `pglite-socket`, e2e (`postgresql-postgres-js`); `postgres.test-d.ts` |
| Drizzle              | 0.45.2                            | Live server errors through `DrizzleQueryError`, e2e (`postgresql-pglite*`)                    |
| Neon                 | `@neondatabase/serverless` `main` | `NeonDbError` fields from `src/httpQuery.ts`; fixture over HTTP (`postgresql-options`)        |
| Bun SQL              | Bun `main` (Rust binding)         | `errno`/`code` placement from `error_response_jsc.rs`; fixture over HTTP; not run on Bun      |
| Sequelize 6          | 6.x (`v6` branch)                 | `original` link from `database-error.ts`; fixture over HTTP                                   |
| Kysely               | `main`                            | Rethrows the driver error (`postgres-driver.ts`); source inspection only                      |
| TypeORM, MikroORM    | `master`                          | Copy the driver error's own properties onto their exception; source inspection only           |
| Slonik, Objection    | `main`                            | `cause` and `nativeError` links; source inspection only                                       |

Versions that move with Dependabot are the pins in `e2e/package.json`; this table is the snapshot at
the amendment date.
