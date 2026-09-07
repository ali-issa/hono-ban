import type { PostgresError } from 'postgres';

import type { EmptyCatalog, ErrorMapper } from '../core/types';
import type { PostgresErrorLike, PostgresMapper } from './index';

import { describe, expectTypeOf, it } from 'vitest';

import { createBan } from '../core/create-ban';
import { postgresMapper, readPostgresFields } from './index';

const errors = {
  ORDER_CONFLICT: { status: 409, title: 'Order Conflict' },
} as const;
const superset = {
  ...errors,
  OUT_OF_STOCK: { status: 409, title: 'Out of Stock' },
} as const;

describe('postgres.js error type', () => {
  it('fits PostgresErrorLike, field by field', () => {
    expectTypeOf<PostgresError>().toExtend<PostgresErrorLike>();
    expectTypeOf<PostgresError['severity_local']>().toEqualTypeOf<string>();
    expectTypeOf<PostgresError['constraint_name']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<PostgresError['table_name']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<PostgresError['schema_name']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<PostgresError['column_name']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf(readPostgresFields).parameter(0).toExtend<PostgresErrorLike>();
  });
});

describe('postgresMapper types', () => {
  it('fits every ban when it names no custom key', () => {
    const mapper = postgresMapper({
      constraints: { u: 'Duplicate' },
      codes: { '23505': { key: 'CONFLICT' } },
    });
    expectTypeOf(mapper).toEqualTypeOf<PostgresMapper<'CONFLICT'>>();
    createBan({ map: mapper });
    createBan({ errors, map: mapper });
    createBan({ errors }).onError({ map: mapper });
    createBan().onError({ map: mapper });
    expectTypeOf(postgresMapper()).toExtend<ErrorMapper<EmptyCatalog>>();
  });

  it('fits a ban whose catalog defines the custom keys it names', () => {
    const mapper = postgresMapper({
      constraints: { u: { key: 'ORDER_CONFLICT' } },
    });
    expectTypeOf(mapper).toEqualTypeOf<PostgresMapper<'ORDER_CONFLICT'>>();
    createBan({ errors, map: mapper });
    createBan({ errors: superset, map: mapper });
    createBan({ errors }).onError({ map: mapper });
    createBan({
      errors,
      map: postgresMapper({ codes: { '23505': { key: 'ORDER_CONFLICT' } } }),
    });
  });

  it('rejects a ban that lacks a named custom key', () => {
    const mapper = postgresMapper({
      constraints: { u: { key: 'ORDER_CONFLICT' } },
    });
    // @ts-expect-error the default catalog has no ORDER_CONFLICT
    createBan({ map: mapper });
    // @ts-expect-error the default catalog has no ORDER_CONFLICT
    createBan().onError({ map: mapper });
    createBan({
      errors,
      // @ts-expect-error NOPE is in no catalog
      map: postgresMapper({ codes: { '23505': { key: 'NOPE' } } }),
    });
    createBan({
      // @ts-expect-error NOPE is in no catalog
      map: postgresMapper({ constraints: { u: { key: 'NOPE' } } }),
    });
  });

  it('keeps the mapping forms apart', () => {
    const issue = { path: ['email'], message: 'x' };
    postgresMapper({ constraints: { u: { issue } } });
    postgresMapper({ columns: { 'users.email': { issue } } });
    // @ts-expect-error an issue mapping carries nothing else
    postgresMapper({ constraints: { u: { detail: 'x', issue } } });
    // @ts-expect-error message belongs inside issue
    postgresMapper({ constraints: { u: { key: 'CONFLICT', message: 'x' } } });
    // @ts-expect-error codes take no issue form
    postgresMapper({ codes: { '23505': { issue } } });
    // @ts-expect-error codes take no string form
    postgresMapper({ codes: { '23505': 'x' } });
  });
});
