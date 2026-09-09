import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  findPostgresError,
  postgresMapper,
  readPostgresFields,
} from 'hono-ban/postgresql';

import {
  BUILTIN_ROWS,
  call,
  FALLTHROUGH_ROWS,
  harnessWith,
  UNEXPECTED_DETAIL,
  useDatabase,
} from './support/pglite';
import { useSocketServer } from './support/pglite-socket';

/**
 * `postgresMapper()` against the real postgres.js driver (SPEC 6.10): one
 * `postgres()` connection over the wire protocol to the file's PGlite through
 * `support/pglite-socket`, so the thrown value is postgres.js's
 * `PostgresError` with its own spelling (`severity` from field V,
 * `severity_local` from field S, `constraint_name`, `table_name`,
 * `schema_name`, `column_name`), the shape the mapper normalizes. Every
 * built-in row and fallthrough of `postgresql-pglite.e2e.test.ts` runs again
 * here, plus the field spelling and an issue mapping.
 * @ref https://github.com/porsager/postgres#connection
 * @ref https://github.com/porsager/postgres/blob/master/src/connection.js (errorFields)
 * @ref https://github.com/porsager/postgres/blob/master/src/index.js (`unsafe`: simple protocol when no parameters)
 */

const database = useDatabase();
const endpoint = useSocketServer(database);
let sql: postgres.Sql | undefined;

beforeAll(() => {
  const { host, port } = endpoint();
  // One connection: the socket server serves one backend session, and
  // postgres.js would otherwise open more under concurrency. No SSL.
  sql = postgres({
    host,
    port,
    user: 'postgres',
    database: 'postgres',
    max: 1,
    ssl: false,
    onnotice: () => {},
  });
});
afterAll(async () => {
  await sql?.end();
});

/** `unsafe()` with no parameters uses the simple query protocol. */
async function execute(statement: string): Promise<unknown> {
  if (sql === undefined) {
    throw new Error('client not connected');
  }
  return sql.unsafe(statement);
}

const h = harnessWith({ '': execute }, postgresMapper());

describe('built-in rows through postgres.js', () => {
  it.each(BUILTIN_ROWS)(
    '%s -> %i %s',
    async (path, status, code, detail, sqlstate) => {
      const { res, body, report } = await call(h, path);
      expect(res.status).toBe(status);
      expect(body).toMatchObject({ status, code, detail, instance: path });
      expect(report.handled).toBe(true);
      expect(findPostgresError(report.cause)?.code).toBe(sqlstate);
      expect(report.error.cause).toBe(report.cause);
    },
  );

  it.each(FALLTHROUGH_ROWS)(
    '%s falls through unhandled (%s)',
    async (path, sqlstate) => {
      const { res, body, report } = await call(h, path);
      expect(res.status).toBe(500);
      expect(body).toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        detail: UNEXPECTED_DETAIL,
      });
      expect(report.handled).toBe(false);
      expect(findPostgresError(report.cause)?.code).toBe(sqlstate);
    },
  );

  it('throws PostgresError with the postgres.js field names', async () => {
    const duplicate = await call(h, '/duplicate');
    expect(duplicate.report.cause).toBeInstanceOf(postgres.PostgresError);
    expect(duplicate.report.cause).toMatchObject({
      name: 'PostgresError',
      severity_local: 'ERROR',
      severity: 'ERROR',
      code: '23505',
      schema_name: 'public',
      table_name: 'users',
      constraint_name: 'users_email_key',
    });
    expect(duplicate.report.cause).not.toHaveProperty('constraint');
    const notNull = await call(h, '/not-null');
    const error = findPostgresError(notNull.report.cause);
    expect(error).toMatchObject({
      code: '23502',
      table_name: 'users',
      column_name: 'email',
    });
    expect(error).not.toHaveProperty('constraint_name');
    // Normalized to the node-postgres names the mapper keys on.
    expect(readPostgresFields(error ?? {})).toEqual({
      sqlstate: '23502',
      errorClass: '23',
      constraint: undefined,
      table: 'users',
      schema: 'public',
      column: 'email',
    });
  });
});

describe('issue mappings through postgres.js', () => {
  const mapped = harnessWith(
    { '': execute },
    postgresMapper({
      constraints: {
        users_email_key: {
          issue: {
            path: ['email'],
            message: 'That email is already registered',
          },
        },
      },
      columns: {
        'users.email': {
          issue: { path: ['email'], message: 'Email is required' },
        },
      },
    }),
  );

  it.each([
    ['/duplicate', 'That email is already registered', '23505'],
    ['/not-null', 'Email is required', '23502'],
  ])('%s -> 422 with pointer /email', async (path, detail, sqlstate) => {
    const { res, body, report } = await call(mapped, path);
    expect(res.status).toBe(422);
    expect(body).toMatchObject({
      code: 'VALIDATION_FAILED',
      location: 'body',
      errors: [{ pointer: '/email', detail }],
    });
    // The driver error is the cause for issue mappings too (SPEC 6.10).
    expect(report.error.cause).toBe(report.cause);
    expect(findPostgresError(report.error.cause)?.code).toBe(sqlstate);
  });
});
