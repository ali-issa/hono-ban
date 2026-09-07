/**
 * Driver-shaped error fixtures for the postgres tests. Each mirrors the
 * fields the surveyed driver puts on its error (see `error.ts`); the text
 * members carry recognizable server phrases so leak assertions can search
 * for them.
 */

export interface PgFixtureInit {
  readonly code: string;
  readonly severity?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly schema?: string;
  readonly column?: string;
  readonly detail?: string;
  readonly message?: string;
}

/** node-postgres, PGlite, Neon: `DatabaseError` with `name: 'error'`. */
export class PgError extends Error {
  override readonly name: string = 'error';
  readonly severity: string;
  readonly code: string;
  readonly detail: string | undefined;
  readonly constraint: string | undefined;
  readonly table: string | undefined;
  readonly schema: string | undefined;
  readonly column: string | undefined;

  constructor(init: PgFixtureInit) {
    super(init.message ?? `server message for ${init.code}`);
    this.severity = init.severity ?? 'ERROR';
    this.code = init.code;
    this.detail = init.detail;
    this.constraint = init.constraint;
    this.table = init.table;
    this.schema = init.schema;
    this.column = init.column;
  }
}

/** The unique violation PGlite raised for `users.email` (probe, 2026-09-07). */
export function uniqueViolation(): PgError {
  return new PgError({
    code: '23505',
    constraint: 'users_email_key',
    table: 'users',
    schema: 'public',
    detail: 'Key (email)=(a@b.c) already exists.',
    message: 'duplicate key value violates unique constraint "users_email_key"',
  });
}

export interface PostgresJsFixtureInit {
  readonly code: string;
  readonly severity?: string;
  readonly severity_local?: string;
  readonly constraint_name?: string;
  readonly table_name?: string;
  readonly schema_name?: string;
  readonly column_name?: string;
}

/** postgres.js: `Object.assign(this, fields)` with the snake_case names. */
export function postgresJsError(
  init: PostgresJsFixtureInit,
): Error & PostgresJsFixtureInit {
  const error = new Error('postgres.js message');
  error.name = 'PostgresError';
  return Object.assign(error, init);
}

export interface BunFixtureInit {
  readonly errno: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
}

/** Bun: the SQLSTATE on `errno`, a constant on `code`. */
export function bunError(
  init: BunFixtureInit,
): Error &
  BunFixtureInit & { readonly code: string; readonly severity: string } {
  const error = new Error('bun message');
  error.name = 'PostgresError';
  return Object.assign(error, {
    code:
      init.errno === '42601'
        ? 'ERR_POSTGRES_SYNTAX_ERROR'
        : 'ERR_POSTGRES_SERVER_ERROR',
    severity: 'ERROR',
    ...init,
  });
}

/** Drizzle: `DrizzleQueryError` with the SQL and parameters in its message. */
export function drizzleWrap(cause: unknown): Error {
  const error = new Error(
    'Failed query: insert into "users" ("email") values ($1)\nparams: a@b.c,hunter2',
    { cause },
  );
  error.name = 'DrizzleQueryError';
  return error;
}
