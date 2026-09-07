import { describe, expect, it } from 'vitest';

import {
  bunError,
  drizzleWrap,
  PgError,
  postgresJsError,
  uniqueViolation,
} from '../test-support/postgresql-fixtures';
import {
  findPostgresError,
  isPostgresError,
  readPostgresFields,
} from './error';

describe('isPostgresError', () => {
  it('recognizes every surveyed driver shape', () => {
    expect(isPostgresError(uniqueViolation())).toBe(true);
    expect(
      isPostgresError(
        postgresJsError({
          code: '23505',
          severity: 'ERROR',
          severity_local: 'ERROR',
        }),
      ),
    ).toBe(true);
    // PgBouncer and pre-9.6 servers send no field V: postgres.js then has
    // only severity_local.
    expect(
      isPostgresError(
        postgresJsError({ code: '08P01', severity_local: 'FATAL' }),
      ),
    ).toBe(true);
    expect(isPostgresError(bunError({ errno: '23505' }))).toBe(true);
    expect(isPostgresError(bunError({ errno: '42601' }))).toBe(true);
    // A plain object with the fields, as a JSON-parsed or copied error.
    expect(isPostgresError({ code: '23505', severity: 'ERROR' })).toBe(true);
  });

  it('rejects values with a five-character code but no severity', () => {
    expect(
      isPostgresError({ code: 'EPIPE', errno: -32, syscall: 'write' }),
    ).toBe(false);
    expect(isPostgresError({ code: 'ENOENT', errno: -2 })).toBe(false);
    expect(
      isPostgresError({
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        clientVersion: '7.10.0',
        meta: { driverAdapterError: { cause: { originalCode: '23505' } } },
      }),
    ).toBe(false);
    expect(isPostgresError({ code: '23505' })).toBe(false);
  });

  it('rejects driver connection errors and non-objects', () => {
    expect(
      isPostgresError({
        code: 'CONNECTION_CLOSED',
        errno: 'CONNECTION_CLOSED',
      }),
    ).toBe(false);
    expect(isPostgresError({ code: 'ERR_POSTGRES_CONNECTION_CLOSED' })).toBe(
      false,
    );
    expect(isPostgresError({ name: 'InvalidInputError', message: 'x' })).toBe(
      false,
    );
    expect(isPostgresError({ code: '2350', severity: 'ERROR' })).toBe(false);
    expect(isPostgresError({ code: '23505x', severity: 'ERROR' })).toBe(false);
    expect(isPostgresError({ code: 'ab123', severity: 'ERROR' })).toBe(false);
    expect(isPostgresError(null)).toBe(false);
    expect(isPostgresError('23505')).toBe(false);
    expect(isPostgresError(new Error('23505'))).toBe(false);
  });
});

describe('findPostgresError', () => {
  const driver = uniqueViolation();

  it('returns the value itself when it is a Postgres error', () => {
    expect(findPostgresError(driver)).toBe(driver);
  });

  it('follows cause, original, and nativeError', () => {
    expect(findPostgresError(drizzleWrap(driver))).toBe(driver);
    expect(
      findPostgresError({
        name: 'SequelizeUniqueConstraintError',
        parent: driver,
        original: driver,
      }),
    ).toBe(driver);
    expect(findPostgresError({ name: 'DBError', nativeError: driver })).toBe(
      driver,
    );
    expect(
      findPostgresError(new Error('outer', { cause: drizzleWrap(driver) })),
    ).toBe(driver);
  });

  it('matches wrappers that copy the driver fields onto themselves', () => {
    const typeorm = Object.assign(new Error('QueryFailedError'), {
      query: 'insert',
      driverError: driver,
      code: driver.code,
      severity: driver.severity,
      constraint: driver.constraint,
    });
    expect(findPostgresError(typeorm)).toBe(typeorm);
  });

  it('stops at eight links and on cycles', () => {
    let chain: Error = driver;
    for (let index = 0; index < 8; index += 1) {
      chain = new Error(`link ${String(index)}`, { cause: chain });
    }
    expect(findPostgresError(chain)).toBe(driver);
    expect(
      findPostgresError(new Error('one more', { cause: chain })),
    ).toBeUndefined();
    const cyclic: { cause?: unknown } = {};
    cyclic.cause = cyclic;
    expect(findPostgresError(cyclic)).toBeUndefined();
  });

  it('returns undefined for non-Postgres values and dead ends', () => {
    expect(findPostgresError(null)).toBeUndefined();
    expect(findPostgresError(new Error('plain'))).toBeUndefined();
    expect(
      findPostgresError(new Error('primitive cause', { cause: '23505' })),
    ).toBeUndefined();
    expect(
      findPostgresError({ cause: { code: 'EPIPE', errno: -32 } }),
    ).toBeUndefined();
  });
});

describe('readPostgresFields', () => {
  it('reads the node-postgres spelling', () => {
    expect(readPostgresFields(uniqueViolation())).toEqual({
      sqlstate: '23505',
      errorClass: '23',
      constraint: 'users_email_key',
      table: 'users',
      schema: 'public',
      column: undefined,
    });
  });

  it('reads the postgres.js spelling', () => {
    const error = postgresJsError({
      code: '23502',
      severity: 'ERROR',
      table_name: 'users',
      schema_name: 'public',
      column_name: 'email',
    });
    expect(readPostgresFields(error)).toEqual({
      sqlstate: '23502',
      errorClass: '23',
      constraint: undefined,
      table: 'users',
      schema: 'public',
      column: 'email',
    });
  });

  it('reads the SQLSTATE from errno on Bun', () => {
    const fields = readPostgresFields(
      bunError({
        errno: '23505',
        constraint: 'users_email_key',
        table: 'users',
      }),
    );
    expect(fields.sqlstate).toBe('23505');
    expect(fields.errorClass).toBe('23');
    expect(fields.constraint).toBe('users_email_key');
  });

  it('prefers the node-postgres spelling when both are present', () => {
    const error = Object.assign(
      new PgError({ code: '23505', constraint: 'a' }),
      {
        constraint_name: 'b',
      },
    );
    expect(readPostgresFields(error).constraint).toBe('a');
  });

  it('yields an empty SQLSTATE for a value that bypassed recognition', () => {
    expect(readPostgresFields({ severity: 'ERROR' })).toMatchObject({
      sqlstate: '',
      errorClass: '',
    });
  });
});
