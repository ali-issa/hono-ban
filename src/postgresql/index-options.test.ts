import type { PostgresMapper } from './index';

import { describe, expect, it } from 'vitest';

import { createBan } from '../core/create-ban';
import { UNEXPECTED_DETAIL } from '../internal/constants';
import { dispatch } from '../test-support/postgresql-dispatch';
import { PgError, uniqueViolation } from '../test-support/postgresql-fixtures';
import { postgresMapper } from './index';

const CUSTOM = {
  ORDER_CONFLICT: { status: 409, title: 'Order Conflict' },
} as const;

describe('codes and precedence', () => {
  it('merges member by member: constraint, code, class, then the table', async () => {
    const ban = createBan({
      errors: CUSTOM,
      map: postgresMapper({
        constraints: { users_email_key: { detail: 'From constraint' } },
        codes: {
          '23505': { key: 'ORDER_CONFLICT', meta: { from: 'code' } },
          '23': {
            headers: { 'X-Class': '23' },
            meta: { from: 'class' },
            detail: 'From class',
          },
        },
      }),
    });
    const { body, headers } = await dispatch(ban, uniqueViolation());
    expect(body).toMatchObject({
      code: 'ORDER_CONFLICT',
      detail: 'From constraint',
      from: 'code',
    });
    expect(headers.get('X-Class')).toBe('23');
    const other = await dispatch(
      ban,
      new PgError({ code: '23514', constraint: 'c' }),
    );
    expect(other.body).toMatchObject({
      code: 'UNPROCESSABLE_CONTENT',
      detail: 'From class',
      from: 'class',
    });
  });

  it('maps a code without a built-in row to a 500 with the given detail', async () => {
    const ban = createBan({
      map: postgresMapper({ codes: { '42': { detail: 'Query failed' } } }),
    });
    const { status, body, report } = await dispatch(
      ban,
      new PgError({ code: '42P01' }),
    );
    expect(status).toBe(500);
    expect(body).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      detail: 'Query failed',
    });
    expect(report.handled).toBe(true);
  });

  it('maps the documented overrides', async () => {
    const ban = createBan({
      map: postgresMapper({
        codes: {
          '42501': { key: 'FORBIDDEN' },
          P0001: { key: 'BAD_REQUEST', detail: 'The request was rejected' },
          '57014': { key: 'GATEWAY_TIMEOUT' },
        },
      }),
    });
    expect((await dispatch(ban, new PgError({ code: '42501' }))).status).toBe(
      403,
    );
    expect(
      (await dispatch(ban, new PgError({ code: 'P0001' }))).body,
    ).toMatchObject({
      status: 400,
      detail: 'The request was rejected',
    });
    expect((await dispatch(ban, new PgError({ code: '57014' }))).status).toBe(
      504,
    );
  });

  it('works as the handler-level map and with a hoisted mapper', async () => {
    const mapper = postgresMapper({
      constraints: { users_email_key: 'Hoisted' },
    });
    const ban = createBan({ errors: CUSTOM });
    const { body } = await dispatch(ban, uniqueViolation(), { map: mapper });
    expect(body).toMatchObject({ code: 'CONFLICT', detail: 'Hoisted' });
  });
});

describe('retryAfter', () => {
  const mapper = postgresMapper({
    retryAfter: 5,
    codes: {
      '40P01': { headers: { 'Retry-After': '30' } },
      '42': { detail: 'x' },
    },
  });
  const ban = createBan({ map: mapper });

  it('adds Retry-After to every 503 unless the mapping set one', async () => {
    const serialization = await dispatch(ban, new PgError({ code: '40001' }));
    expect(serialization.status).toBe(503);
    expect(serialization.headers.get('Retry-After')).toBe('5');
    const deadlock = await dispatch(ban, new PgError({ code: '40P01' }));
    expect(deadlock.headers.get('Retry-After')).toBe('30');
  });

  it('adds nothing to other statuses', async () => {
    const conflict = await dispatch(ban, uniqueViolation());
    expect(conflict.headers.get('Retry-After')).toBeNull();
    const internal = await dispatch(ban, new PgError({ code: '42P01' }));
    expect(internal.status).toBe(500);
    expect(internal.headers.get('Retry-After')).toBeNull();
    // Excluded from the class row: no mapper output, so no header either.
    const cancelled = await dispatch(ban, new PgError({ code: '57014' }));
    expect(cancelled.status).toBe(500);
    expect(cancelled.headers.get('Retry-After')).toBeNull();
  });

  it('is absent by default', async () => {
    const plain = createBan({ map: postgresMapper() });
    const { status, headers } = await dispatch(
      plain,
      new PgError({ code: '40001' }),
    );
    expect(status).toBe(503);
    expect(headers.get('Retry-After')).toBeNull();
  });
});

describe('construction', () => {
  it('rejects codes keys outside the SQLSTATE grammar', () => {
    expect(() => postgresMapper({ codes: { '2350': {} } })).toThrow(TypeError);
    expect(() => postgresMapper({ codes: { abc: {} } })).toThrow(TypeError);
    expect(() => postgresMapper({ codes: { '23505 ': {} } })).toThrow(
      TypeError,
    );
    expect(() =>
      postgresMapper({ codes: { '23505': {}, '23': {} } }),
    ).not.toThrow();
  });

  it('rejects malformed mappings from untyped callers', () => {
    const untyped = postgresMapper as (options: unknown) => unknown;
    expect(() => untyped({ codes: { '23505': 'detail' } })).toThrow(
      /must be a mapping object/u,
    );
    expect(() =>
      untyped({ codes: { '23505': { issue: { path: [], message: 'x' } } } }),
    ).toThrow(/must be a mapping object/u);
    expect(() => untyped({ constraints: { c: 42 } })).toThrow(
      /must be a string or an object/u,
    );
    expect(() =>
      untyped({ constraints: { c: { issue: { path: ['a'] } } } }),
    ).toThrow(/path array and a message string/u);
    expect(() =>
      untyped({ columns: { c: { issue: { message: 'x' } } } }),
    ).toThrow(TypeError);
  });

  it('rejects headers the Headers constructor rejects', () => {
    expect(() =>
      postgresMapper({
        constraints: { c: { headers: { 'bad header': 'x' } } },
      }),
    ).toThrow(/constraints "c" headers/u);
    expect(() =>
      postgresMapper({
        codes: { '23505': { headers: { 'X-A': 'bad\nvalue' } } },
      }),
    ).toThrow(/codes "23505" headers/u);
    expect(() =>
      postgresMapper({
        columns: { c: { headers: new Headers({ 'X-A': 'ok' }) } },
      }),
    ).not.toThrow();
  });

  it('rejects a negative, fractional, or unsafe retryAfter', () => {
    expect(() => postgresMapper({ retryAfter: -1 })).toThrow(RangeError);
    expect(() => postgresMapper({ retryAfter: 1.5 })).toThrow(RangeError);
    // String(1e21) is '1e+21', not RFC 9110 delay-seconds.
    expect(() => postgresMapper({ retryAfter: 1e21 })).toThrow(RangeError);
    expect(() => postgresMapper({ retryAfter: 0 })).not.toThrow();
    expect(() =>
      postgresMapper({ retryAfter: Number.MAX_SAFE_INTEGER }),
    ).not.toThrow();
  });

  it('ignores codes entries inherited from a prototype', async () => {
    // Never validated (Object.entries lists own properties), so never applied.
    const inherited = Object.create({
      '23505': { detail: 'From the prototype' },
      '23': { detail: 'From the prototype class' },
    }) as Record<string, { detail: string }>;
    const ban = createBan({ map: postgresMapper({ codes: inherited }) });
    const { body } = await dispatch(ban, uniqueViolation());
    expect(body).toMatchObject({
      status: 409,
      detail: 'A record with the same value already exists',
    });
  });

  it('surfaces an unknown key at map time as a handler failure', async () => {
    const mapper = postgresMapper<'NOPE'>({
      codes: { '23505': { key: 'NOPE' } },
    });
    const ban = createBan({ map: mapper as unknown as PostgresMapper });
    const { status, body, report } = await dispatch(ban, uniqueViolation());
    expect(status).toBe(500);
    expect(body).toMatchObject({ detail: UNEXPECTED_DETAIL });
    expect(report.handlerFailure).toBeInstanceOf(RangeError);
  });
});
