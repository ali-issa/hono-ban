import { describe, expect, it } from 'vitest';

import { generateErrorId } from './id';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('generateErrorId', () => {
  it('returns a UUID v4', () => {
    expect(generateErrorId()).toMatch(UUID_V4);
  });

  it('returns a fresh id on every call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateErrorId()));
    expect(ids.size).toBe(100);
  });
});
