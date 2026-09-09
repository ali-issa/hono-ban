import { describe, expect, it } from 'vitest';

import { findPostgresError, postgresMapper } from 'hono-ban/postgresql';

import {
  BUILTIN_ROWS,
  call,
  FALLTHROUGH_ROWS,
  harness,
  UNEXPECTED_DETAIL,
  useDatabase,
} from './support/pglite';

/**
 * `postgresMapper()` with its built-in table against real server errors
 * (SPEC 6.10): the status and constant detail for every row PGlite
 * (PostgreSQL 18) can raise, the fallthrough cases, and Drizzle's wrapper
 * unwrapped. `postgresql-pglite-options.e2e.test.ts` covers the options and
 * `includeStack`; `postgresql-node-postgres.e2e.test.ts` and
 * `postgresql-postgres-js.e2e.test.ts` run the same statements through the
 * real drivers over a socket; `postgresql-options.e2e.test.ts` hand-builds
 * the shapes no driver here can produce.
 */

const database = useDatabase();
const h = harness(database, postgresMapper());

describe('built-in rows', () => {
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
});

describe('through Drizzle', () => {
  it('unwraps DrizzleQueryError and keeps both on the report', async () => {
    const { res, body, report } = await call(h, '/drizzle/duplicate');
    expect(res.status).toBe(409);
    expect(body).toMatchObject({ code: 'CONFLICT' });
    // drizzle-orm 0.45 does not set `name` on DrizzleQueryError; its message
    // carries the query and the parameters, which is why it must not be the
    // error's cause.
    expect(report.cause).toBeInstanceOf(Error);
    expect((report.cause as Error).message).toMatch(/^Failed query/u);
    expect(report.error.cause).not.toBe(report.cause);
    expect(findPostgresError(report.error.cause)?.code).toBe('23505');
  });

  it('falls through unhandled when the wrapped code has no row', async () => {
    const { res, report } = await call(h, '/drizzle/undefined-table');
    expect(res.status).toBe(500);
    expect(report.handled).toBe(false);
    expect(findPostgresError(report.cause)?.code).toBe('42P01');
  });
});
