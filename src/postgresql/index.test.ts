import { describe, expect, it } from 'vitest';

import { createBan } from '../core/create-ban';
import { UNEXPECTED_DETAIL } from '../internal/constants';
import { dispatch } from '../test-support/postgresql-dispatch';
import {
  bunError,
  drizzleWrap,
  PgError,
  postgresJsError,
  uniqueViolation,
} from '../test-support/postgresql-fixtures';
import { postgresMapper } from './index';

const CUSTOM = {
  ORDER_CONFLICT: { status: 409, title: 'Order Conflict' },
} as const;

describe('postgresMapper defaults', () => {
  const ban = createBan({ map: postgresMapper() });

  it('maps a unique violation to a constant 409 without driver text', async () => {
    const driver = uniqueViolation();
    const { status, body, text, report } = await dispatch(ban, driver);
    expect(status).toBe(409);
    expect(body).toMatchObject({
      code: 'CONFLICT',
      detail: 'A record with the same value already exists',
    });
    for (const secret of [
      'a@b.c',
      'users_email_key',
      'duplicate key',
      'users',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(report.handled).toBe(true);
    expect(report.cause).toBe(driver);
    expect(report.error.cause).toBe(driver);
  });

  it('keeps the wrapper on the report and the driver error on the error', async () => {
    const driver = uniqueViolation();
    const wrapped = drizzleWrap(driver);
    const { status, report, text } = await dispatch(ban, wrapped);
    expect(status).toBe(409);
    expect(report.cause).toBe(wrapped);
    expect(report.error.cause).toBe(driver);
    expect(text).not.toContain('hunter2');
  });

  it('accepts the postgres.js and Bun shapes', async () => {
    const viaPostgresJs = await dispatch(
      ban,
      postgresJsError({
        code: '23503',
        severity: 'ERROR',
        constraint_name: 'x',
      }),
    );
    expect(viaPostgresJs.body).toMatchObject({ status: 409, code: 'CONFLICT' });
    const viaBun = await dispatch(
      ban,
      bunError({ errno: '23502', column: 'email' }),
    );
    expect(viaBun.body).toMatchObject({
      status: 422,
      code: 'UNPROCESSABLE_CONTENT',
      detail: 'A required value is missing',
    });
  });

  it('returns undefined for values that are not Postgres errors', () => {
    const mapper = postgresMapper();
    expect(mapper(new Error('plain'), ban)).toBeUndefined();
    expect(mapper({ code: 'EPIPE', errno: -32 }, ban)).toBeUndefined();
    expect(mapper(undefined, ban)).toBeUndefined();
  });

  it('leaves a SQLSTATE without a row to the handler fallthrough', async () => {
    const mapper = postgresMapper();
    expect(mapper(new PgError({ code: '42P01' }), ban)).toBeUndefined();
    expect(mapper(new PgError({ code: 'P0001' }), ban)).toBeUndefined();
    expect(mapper(new PgError({ code: '57014' }), ban)).toBeUndefined();
    const { status, body, report } = await dispatch(
      ban,
      new PgError({ code: '42P01' }),
    );
    expect(status).toBe(500);
    expect(body).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      detail: UNEXPECTED_DETAIL,
    });
    expect(report.handled).toBe(false);
  });

  it('renders the driver stack, not the wrapper stack, under includeStack', async () => {
    const driver = new PgError({
      code: '40001',
      message: 'could not serialize access due to concurrent update',
    });
    const { status, body } = await dispatch(ban, drizzleWrap(driver), {
      includeStack: true,
    });
    expect(status).toBe(503);
    expect(body['stack']).toEqual(
      expect.stringContaining('could not serialize'),
    );
    expect(body['stack']).not.toContain('hunter2');
    const mapped = await dispatch(ban, uniqueViolation(), {
      includeStack: true,
    });
    expect(mapped.body['stack']).toBeUndefined();
  });
});

describe('constraints and columns', () => {
  it('takes a string as the detail and keeps the default entry', async () => {
    const ban = createBan({
      map: postgresMapper({
        constraints: { users_email_key: 'That email is already registered' },
      }),
    });
    const { body } = await dispatch(ban, uniqueViolation());
    expect(body).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      detail: 'That email is already registered',
    });
  });

  it('takes an object with key, detail, meta, and headers', async () => {
    const ban = createBan({
      errors: CUSTOM,
      map: postgresMapper({
        constraints: {
          users_email_key: {
            key: 'ORDER_CONFLICT',
            detail: 'Taken',
            meta: { field: 'email' },
            headers: { 'X-Reason': 'duplicate' },
          },
        },
      }),
    });
    const { body, headers } = await dispatch(ban, uniqueViolation());
    expect(body).toMatchObject({
      status: 409,
      code: 'ORDER_CONFLICT',
      title: 'Order Conflict',
      detail: 'Taken',
      field: 'email',
    });
    expect(headers.get('X-Reason')).toBe('duplicate');
  });

  it('renders an issue mapping as a validation error', async () => {
    const ban = createBan({
      map: postgresMapper({
        constraints: {
          users_email_key: {
            issue: { path: ['email'], message: 'Already registered' },
          },
          users_age_check: {
            issue: {
              path: ['age'],
              message: 'Out of range',
              location: 'query',
              code: 'check',
            },
          },
        },
      }),
    });
    const email = await dispatch(ban, uniqueViolation());
    expect(email.status).toBe(422);
    expect(email.body).toMatchObject({
      code: 'VALIDATION_FAILED',
      location: 'body',
      errors: [{ pointer: '/email', detail: 'Already registered' }],
    });
    expect(email.report.cause).toBeInstanceOf(PgError);
    const age = await dispatch(
      ban,
      new PgError({ code: '23514', constraint: 'users_age_check' }),
    );
    expect(age.body).toMatchObject({
      location: 'query',
      errors: [{ name: 'age', detail: 'Out of range', code: 'check' }],
    });
  });

  it('reaches a not-null violation through columns, qualified before bare', async () => {
    const mapper = postgresMapper({
      columns: {
        'users.email': {
          issue: { path: ['email'], message: 'Email is required' },
        },
        email: 'Some email is required',
      },
    });
    const ban = createBan({ map: mapper });
    const qualified = await dispatch(
      ban,
      new PgError({ code: '23502', table: 'users', column: 'email' }),
    );
    expect(qualified.body).toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      errors: [{ pointer: '/email', detail: 'Email is required' }],
    });
    const bare = await dispatch(
      ban,
      postgresJsError({
        code: '23502',
        severity: 'ERROR',
        table_name: 'orders',
        column_name: 'email',
      }),
    );
    expect(bare.body).toMatchObject({
      code: 'UNPROCESSABLE_CONTENT',
      detail: 'Some email is required',
    });
    const noColumn = await dispatch(ban, new PgError({ code: '23502' }));
    expect(noColumn.body).toMatchObject({
      detail: 'A required value is missing',
    });
  });

  it('prefers the constraint over the column when an error names both', async () => {
    const ban = createBan({
      map: postgresMapper({
        constraints: { users_email_key: 'By constraint' },
        columns: { email: 'By column' },
      }),
    });
    const { body } = await dispatch(
      ban,
      new PgError({
        code: '23505',
        constraint: 'users_email_key',
        column: 'email',
      }),
    );
    expect(body['detail']).toBe('By constraint');
  });

  it('reads own properties only', async () => {
    const ban = createBan({
      map: postgresMapper({
        constraints: { other: 'x' },
        codes: { '23505': { detail: 'By code' } },
      }),
    });
    for (const name of [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
    ]) {
      const { body } = await dispatch(
        ban,
        new PgError({ code: '23505', constraint: name }),
      );
      expect(body).toMatchObject({
        status: 409,
        code: 'CONFLICT',
        detail: 'By code',
      });
    }
  });
});
