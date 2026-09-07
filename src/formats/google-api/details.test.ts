import { describe, expect, it } from 'vitest';

import {
  fieldPath,
  fieldViolation,
  help,
  retryInfo,
  toMetadata,
} from './details';

describe('toMetadata', () => {
  it('keeps strings, stringifies everything else, drops what JSON cannot carry', () => {
    expect(
      toMetadata({
        zone: 'us-east1-a',
        count: 3,
        flag: false,
        nested: { a: [1, 2] },
        big: 10n,
        none: null,
        missing: undefined,
        fn: () => 1,
        sym: Symbol('s'),
      }),
    ).toEqual({
      zone: 'us-east1-a',
      count: '3',
      flag: 'false',
      nested: '{"a":[1,2]}',
      big: '10',
      none: 'null',
    });
  });
});

describe('toMetadata keys', () => {
  it('drops keys outside the error_details.proto grammar', () => {
    expect(
      toMetadata({
        orderId: '7',
        'order-id': '7',
        order_id: '7',
        'order.id': 'dropped',
        UserId: 'dropped',
        _private: 'dropped',
        x: 'dropped',
        ['a'.repeat(64)]: 'kept',
        ['a'.repeat(65)]: 'dropped',
      }),
    ).toEqual({
      orderId: '7',
      'order-id': '7',
      order_id: '7',
      ['a'.repeat(64)]: 'kept',
    });
  });
});

describe('fieldPath', () => {
  // @ref https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto (BadRequest.FieldViolation.field)
  it.each([
    [['fullName'], 'fullName'],
    [['emailAddresses', 0, 'email'], 'emailAddresses[0].email'],
    [['emailAddresses', 2, 'type', 1], 'emailAddresses[2].type[1]'],
    [[0, 'sku'], '[0].sku'],
    [[], ''],
  ])('spells %j as %s', (path, expected) => {
    expect(fieldPath(path)).toBe(expected);
  });
});

describe('fieldViolation', () => {
  it('upper-cases the issue code as reason and omits an empty field', () => {
    expect(
      fieldViolation({
        path: ['a', 'b'],
        message: 'Bad',
        code: 'invalid_type',
      }),
    ).toEqual({ field: 'a.b', description: 'Bad', reason: 'INVALID_TYPE' });
    expect(fieldViolation({ path: [], message: 'Whole body' })).toEqual({
      description: 'Whole body',
    });
  });
});

describe('retryInfo', () => {
  it('turns a delay-seconds Retry-After into a Duration and ignores dates', () => {
    expect(retryInfo(new Headers({ 'Retry-After': '30' }))).toEqual({
      '@type': 'type.googleapis.com/google.rpc.RetryInfo',
      retryDelay: '30s',
    });
    expect(
      retryInfo(
        new Headers({ 'Retry-After': 'Wed, 21 Oct 2015 07:28:00 GMT' }),
      ),
    ).toBeUndefined();
    expect(retryInfo(new Headers())).toBeUndefined();
  });
});

describe('help', () => {
  it('links only absolute URLs', () => {
    expect(help('NOT_FOUND', 'https://errors.example.com/NOT_FOUND')).toEqual({
      '@type': 'type.googleapis.com/google.rpc.Help',
      links: [
        {
          description: 'Documentation for NOT_FOUND errors',
          url: 'https://errors.example.com/NOT_FOUND',
        },
      ],
    });
    expect(help('NOT_FOUND', '/errors/NOT_FOUND')).toBeUndefined();
    expect(help('NOT_FOUND')).toBeUndefined();
  });
});
