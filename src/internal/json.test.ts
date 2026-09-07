import { describe, expect, it } from 'vitest';

import { isPlainRecord, safeStringify } from './json';

describe('safeStringify', () => {
  it('serializes bigint as a string', () => {
    expect(safeStringify({ n: 10n })).toBe('{"n":"10"}');
  });

  it('throws on cycles like JSON.stringify', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(() => safeStringify(cyclic)).toThrow(TypeError);
  });
});

describe('isPlainRecord', () => {
  it('accepts object literals and null-prototype objects', () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord(Object.create(null))).toBe(true);
  });

  it('rejects arrays, null, primitives, and class instances', () => {
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord('x')).toBe(false);
    expect(isPlainRecord(new Date())).toBe(false);
  });
});
