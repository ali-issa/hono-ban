import { describe, expect, it } from 'vitest';

import { flattenMeta } from './extension-members';

describe('flattenMeta', () => {
  it('lifts RFC 9457 compliant names to the top level', () => {
    expect(flattenMeta({ retryAfter: 30, balance: 12, snake_case: 1 })).toEqual(
      {
        retryAfter: 30,
        balance: 12,
        snake_case: 1,
      },
    );
  });

  it('keeps non-compliant names under a single meta member', () => {
    expect(
      flattenMeta({ x: 1, '1st': 2, 'kebab-case': 3, ok: 4, okay: 5 }),
    ).toEqual({
      okay: 5,
      meta: { x: 1, '1st': 2, 'kebab-case': 3, ok: 4 },
    });
  });

  it('merges leftovers into an existing plain meta object, or replaces a non-object', () => {
    expect(flattenMeta({ meta: { a: 1 }, x: 2 })).toEqual({
      meta: { a: 1, x: 2 },
    });
    expect(flattenMeta({ meta: 'scalar', x: 2 })).toEqual({ meta: { x: 2 } });
    expect(flattenMeta({ meta: { a: 1 } })).toEqual({ meta: { a: 1 } });
  });

  it('returns an empty object for empty meta', () => {
    expect(flattenMeta({})).toEqual({});
  });
});
