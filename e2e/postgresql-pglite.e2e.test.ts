import { describe, expect, it } from 'vitest';

import { findPostgresError, postgresMapper } from 'hono-ban/postgresql';

import {
  call,
  harness,
  UNEXPECTED_DETAIL,
  useDatabase,
} from './support/pglite';

/**
 * `postgresMapper()` with its built-in table against real server errors
 * (SPEC 6.10): the status and constant detail for every row PGlite
 * (PostgreSQL 18) can raise, the fallthrough cases, and Drizzle's wrapper
 * unwrapped. `postgresql-pglite-options.e2e.test.ts` covers the options and
 * `includeStack`; `postgresql-options.e2e.test.ts` the other driver spellings.
 */

const database = useDatabase();
const h = harness(database, postgresMapper());

describe('built-in rows', () => {
  it.each([
    [
      '/duplicate',
      409,
      'CONFLICT',
      'A record with the same value already exists',
      '23505',
    ],
    [
      '/fk-missing',
      409,
      'CONFLICT',
      'A referenced record does not exist or is still in use',
      '23503',
    ],
    [
      '/fk-referenced',
      409,
      'CONFLICT',
      'A referenced record does not exist or is still in use',
      '23503',
    ],
    ['/fk-restrict', 409, 'CONFLICT', 'A record is still in use', '23001'],
    [
      '/not-null',
      422,
      'UNPROCESSABLE_CONTENT',
      'A required value is missing',
      '23502',
    ],
    [
      '/check',
      422,
      'UNPROCESSABLE_CONTENT',
      'A value violates a constraint',
      '23514',
    ],
    [
      '/invalid-uuid',
      422,
      'UNPROCESSABLE_CONTENT',
      'A value is invalid or out of range',
      '22P02',
    ],
  ])('%s -> %i %s', async (path, status, code, detail, sqlstate) => {
    const { res, body, report } = await call(h, path);
    expect(res.status).toBe(status);
    expect(body).toMatchObject({ status, code, detail, instance: path });
    expect(report.handled).toBe(true);
    expect(findPostgresError(report.cause)?.code).toBe(sqlstate);
    expect(report.error.cause).toBe(report.cause);
  });

  it.each([
    ['/division-by-zero', '22012'],
    ['/sequence', '2200H'],
    ['/undefined-table', '42P01'],
    ['/raise', 'P0001'],
  ])('%s falls through unhandled (%s)', async (path, sqlstate) => {
    const { res, body, report } = await call(h, path);
    expect(res.status).toBe(500);
    expect(body).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      detail: UNEXPECTED_DETAIL,
    });
    expect(report.handled).toBe(false);
    expect(findPostgresError(report.cause)?.code).toBe(sqlstate);
  });
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
