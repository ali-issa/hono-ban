import { describe, expect, it } from 'vitest';

import { UNEXPECTED_DETAIL } from '../internal/constants';
import { sqlstateDefault } from './sqlstate';

function of(sqlstate: string): ReturnType<typeof sqlstateDefault> {
  return sqlstateDefault(sqlstate, sqlstate.slice(0, 2));
}

describe('sqlstateDefault', () => {
  it.each([
    ['23505', 'CONFLICT'],
    ['23P01', 'CONFLICT'],
    ['23503', 'CONFLICT'],
    ['23001', 'CONFLICT'],
    ['40002', 'CONFLICT'],
    ['23502', 'UNPROCESSABLE_CONTENT'],
    ['23514', 'UNPROCESSABLE_CONTENT'],
    ['23000', 'UNPROCESSABLE_CONTENT'],
    ['22P02', 'UNPROCESSABLE_CONTENT'],
    ['22001', 'UNPROCESSABLE_CONTENT'],
    ['40001', 'SERVICE_UNAVAILABLE'],
    ['40P01', 'SERVICE_UNAVAILABLE'],
    ['55P03', 'SERVICE_UNAVAILABLE'],
    ['25006', 'SERVICE_UNAVAILABLE'],
    ['08006', 'SERVICE_UNAVAILABLE'],
    ['08P01', 'SERVICE_UNAVAILABLE'],
    ['53300', 'SERVICE_UNAVAILABLE'],
    ['57P03', 'SERVICE_UNAVAILABLE'],
  ])('%s -> %s', (sqlstate, key) => {
    expect(of(sqlstate)?.key).toBe(key);
  });

  it.each([
    '08007',
    '40003',
    '53400',
    '57014',
    '2200H',
    '22P04',
    '22012',
    '25P03',
    '25P04',
    '55006',
    '42P01',
    '42501',
    '28P01',
    'P0001',
    'AB123',
    'XX000',
  ])('%s has no default', (sqlstate) => {
    expect(of(sqlstate)).toBeUndefined();
  });

  it('gives every row a constant detail that is not the generic 500 text', () => {
    for (const sqlstate of [
      '23505',
      '23503',
      '23502',
      '22P02',
      '40001',
      '40002',
    ]) {
      const row = of(sqlstate);
      expect(row?.detail).toEqual(expect.any(String));
      expect(row?.detail).not.toBe(UNEXPECTED_DETAIL);
      expect(row?.detail).not.toBe('');
    }
  });

  it('distinguishes the class 23 conditions', () => {
    expect(of('23505')?.detail).not.toBe(of('23503')?.detail);
    expect(of('23502')?.detail).not.toBe(of('23514')?.detail);
    expect(of('40002')?.detail).not.toBe(of('23514')?.detail);
  });
});
