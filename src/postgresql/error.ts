/**
 * Recognizing a Postgres error (SPEC 6.10). The server's ErrorResponse
 * carries the SQLSTATE in field `C` and the severity in field `S`, both
 * "always present"; field `V` repeats the severity unlocalized on servers
 * from 9.6 on. What the drivers expose:
 *
 * - node-postgres (`DatabaseError`), PGlite (the same class from
 *   `@electric-sql/pg-protocol`), and Neon (`NeonDbError`): `code` is the
 *   SQLSTATE, `severity` is field `S`; `constraint`, `table`, `schema`,
 *   `column` are fields `n`, `t`, `s`, `c`.
 * - postgres.js (`PostgresError`): `code`, `severity` from field `V`,
 *   `severity_local` from field `S`, and `constraint_name`, `table_name`,
 *   `schema_name`, `column_name`.
 * - Bun (`PostgresError`): the SQLSTATE is `errno`; `code` is the constant
 *   `ERR_POSTGRES_SERVER_ERROR` (or `ERR_POSTGRES_SYNTAX_ERROR` for 42601);
 *   `severity` and the object fields follow node-postgres.
 *
 * Wrappers: Drizzle's `DrizzleQueryError` and Slonik keep the driver error
 * on `cause`; Sequelize 6 on `original` (and `parent`, the same object);
 * `db-errors` (Objection) on `nativeError`. Kysely rethrows the driver error
 * itself; TypeORM's `QueryFailedError` and MikroORM's `DriverException` copy
 * the driver error's own properties onto themselves, so they match directly.
 * Typed structurally, no driver is imported (ADR 0009).
 * @ref https://www.postgresql.org/docs/current/protocol-error-fields.html
 * @ref https://www.postgresql.org/docs/current/errcodes-appendix.html
 * @ref https://github.com/brianc/node-postgres/blob/master/packages/pg-protocol/src/messages.ts
 * @ref https://github.com/electric-sql/pglite/blob/main/packages/pglite/src/errors.ts
 * @ref https://github.com/porsager/postgres/blob/master/src/connection.js
 * @ref https://github.com/porsager/postgres/blob/master/src/errors.js
 * @ref https://github.com/neondatabase/serverless/blob/main/src/httpQuery.ts
 * @ref https://github.com/oven-sh/bun/blob/main/src/js/internal/sql/errors.ts
 * @ref https://github.com/oven-sh/bun/blob/main/src/sql_jsc/postgres/protocol/error_response_jsc.rs
 * @ref https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/errors.ts
 * @ref https://github.com/kysely-org/kysely/blob/master/src/dialect/postgres/postgres-driver.ts
 * @ref https://github.com/kysely-org/kysely/blob/master/src/util/stack-trace-utils.ts
 * @ref https://github.com/sequelize/sequelize/blob/v6/src/errors/database-error.ts
 * @ref https://github.com/Vincit/db-errors/blob/master/lib/errors/DBError.js
 * @ref https://github.com/typeorm/typeorm/blob/master/src/error/QueryFailedError.ts
 * @ref https://github.com/mikro-orm/mikro-orm/blob/master/packages/core/src/exceptions.ts
 * @packageDocumentation
 */

/**
 * The members `findPostgresError` recognizes and `readPostgresFields`
 * reads. A recognized value has a SQLSTATE in `code` or `errno` and a
 * string in `severity` or `severity_local`.
 */
export interface PostgresErrorLike {
  /** The SQLSTATE; on Bun, an `ERR_POSTGRES_*` constant instead. */
  readonly code?: string | undefined;
  /** Bun: the SQLSTATE. */
  readonly errno?: string | undefined;
  /** Field `S` (node-postgres, PGlite, Neon, Bun) or field `V` (postgres.js). */
  readonly severity?: string | undefined;
  /** Field `S` on postgres.js. */
  readonly severity_local?: string | undefined;
  readonly constraint?: string | undefined;
  readonly table?: string | undefined;
  readonly schema?: string | undefined;
  readonly column?: string | undefined;
  /** postgres.js spelling of `constraint`. */
  readonly constraint_name?: string | undefined;
  /** postgres.js spelling of `table`. */
  readonly table_name?: string | undefined;
  /** postgres.js spelling of `schema`. */
  readonly schema_name?: string | undefined;
  /** postgres.js spelling of `column`. */
  readonly column_name?: string | undefined;
}

/** The fields normalized across drivers. */
export interface PostgresErrorFields {
  readonly sqlstate: string;
  /** The first two characters of the SQLSTATE. */
  readonly errorClass: string;
  readonly constraint: string | undefined;
  readonly table: string | undefined;
  readonly schema: string | undefined;
  readonly column: string | undefined;
}

/**
 * SQLSTATE grammar: five digits or uppercase letters. Node's system errors
 * carry a `code` in the same grammar (`EPIPE`) and Prisma's client errors
 * too (`P2002`), which is why a severity string is required as well: the
 * protocol always sends one and every driver keeps it.
 */
const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/u;
const CLASS_LENGTH = 2;
/** Links `findPostgresError` follows, in order, at each level. */
const LINKS: ReadonlyArray<string> = ['cause', 'original', 'nativeError'];
/** How many links `findPostgresError` follows. */
const MAX_DEPTH = 8;

/**
 * Any non-null object. Driver errors are `Error` subclasses, so
 * `isPlainRecord` from `internal/json.ts` would reject them.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isSqlstate(value: unknown): value is string {
  return typeof value === 'string' && SQLSTATE_PATTERN.test(value);
}

function sqlstateOf(code: unknown, errno: unknown): string | undefined {
  if (isSqlstate(code)) {
    return code;
  }
  return isSqlstate(errno) ? errno : undefined;
}

/** True when `value` carries a SQLSTATE and a severity string. */
export function isPostgresError(value: unknown): value is PostgresErrorLike {
  return (
    isRecord(value) &&
    sqlstateOf(value['code'], value['errno']) !== undefined &&
    (typeof value['severity'] === 'string' ||
      typeof value['severity_local'] === 'string')
  );
}

function nextLink(record: Record<string, unknown>): unknown {
  for (const name of LINKS) {
    const linked = record[name];
    if (isRecord(linked)) {
      return linked;
    }
  }
  return undefined;
}

/**
 * The value itself or the first Postgres error reached through `cause`,
 * `original`, or `nativeError` (the first of those that is an object, at
 * each level), at most eight links deep.
 */
export function findPostgresError(
  value: unknown,
): PostgresErrorLike | undefined {
  let current: unknown = value;
  for (let depth = 0; depth <= MAX_DEPTH; depth += 1) {
    if (isPostgresError(current)) {
      return current;
    }
    if (!isRecord(current)) {
      return undefined;
    }
    current = nextLink(current);
  }
  return undefined;
}

/**
 * Normalizes the driver spellings. The SQLSTATE comes from `code`, else
 * `errno`; the object fields from the node-postgres names, else the
 * postgres.js names.
 */
export function readPostgresFields(
  error: PostgresErrorLike,
): PostgresErrorFields {
  // `isPostgresError` guarantees one of the two; the empty string keeps the
  // return type honest for a structurally typed caller that bypassed it.
  const sqlstate = sqlstateOf(error.code, error.errno) ?? '';
  return {
    sqlstate,
    errorClass: sqlstate.slice(0, CLASS_LENGTH),
    constraint:
      readString(error.constraint) ?? readString(error.constraint_name),
    table: readString(error.table) ?? readString(error.table_name),
    schema: readString(error.schema) ?? readString(error.schema_name),
    column: readString(error.column) ?? readString(error.column_name),
  };
}
