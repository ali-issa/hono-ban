import { Client } from 'pg';
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
 * `postgresMapper()` against the real node-postgres driver (SPEC 6.10): a
 * `pg.Client` connected over the wire protocol to the file's PGlite through
 * `support/pglite-socket`, so the thrown value is pg-protocol's
 * `DatabaseError` as `pg` builds it from an ErrorResponse (fields `severity`,
 * `code`, `constraint`, `table`, `schema`, `column`), not a hand-built shape.
 * Every built-in row and fallthrough of `postgresql-pglite.e2e.test.ts`
 * runs again here, plus the field spelling and an issue mapping.
 * @ref https://node-postgres.com/apis/client
 * @ref https://github.com/brianc/node-postgres/blob/master/packages/pg-protocol/src/parser.ts
 */

const database = useDatabase();
const endpoint = useSocketServer(database);
let client: Client | undefined;
const clientErrors: Array<unknown> = [];

beforeAll(async () => {
  const { host, port } = endpoint();
  // `ssl: false` explicitly: pg reads PGSSLMODE from the environment when
  // `ssl` is undefined, and pglite-socket answers an SSLRequest with 'N'.
  client = new Client({
    host,
    port,
    user: 'postgres',
    database: 'postgres',
    ssl: false,
  });
  // An unhandled 'error' event would crash the worker; record it instead.
  client.on('error', (error) => {
    clientErrors.push(error);
  });
  await client.connect();
});
afterAll(async () => {
  await client?.end();
});

/** Simple query protocol: a text statement with no values array. */
async function execute(statement: string): Promise<unknown> {
  if (client === undefined) {
    throw new Error('client not connected');
  }
  return client.query(statement);
}

const h = harnessWith({ '': execute }, postgresMapper());

describe('built-in rows through pg.Client', () => {
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

  it('throws DatabaseError with the node-postgres field names', async () => {
    const duplicate = await call(h, '/duplicate');
    expect(duplicate.report.cause).toMatchObject({
      name: 'error',
      severity: 'ERROR',
      code: '23505',
      schema: 'public',
      table: 'users',
      constraint: 'users_email_key',
    });
    const notNull = await call(h, '/not-null');
    const error = findPostgresError(notNull.report.cause);
    expect(error).toMatchObject({
      code: '23502',
      table: 'users',
      column: 'email',
    });
    // pg-protocol initializes every field, so the member exists but is unset.
    expect(error?.constraint).toBeUndefined();
    expect(readPostgresFields(error ?? {})).toEqual({
      sqlstate: '23502',
      errorClass: '23',
      constraint: undefined,
      table: 'users',
      schema: 'public',
      column: 'email',
    });
  });

  it('kept the client connected throughout', () => {
    expect(clientErrors).toEqual([]);
  });
});

describe('issue mappings through pg.Client', () => {
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
