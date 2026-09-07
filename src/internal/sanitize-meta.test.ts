import { describe, expect, it } from 'vitest';

import { sanitizeMeta } from './sanitize-meta';

describe('sanitizeMeta', () => {
  it('drops prototype pollution keys and keeps the rest', () => {
    const meta = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":1,"prototype":2,"ok":3}',
    ) as Record<string, unknown>;
    const out = sanitizeMeta(meta);
    expect(out).toEqual({ ok: 3 });
    expect(Object.keys(out)).toEqual(['ok']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('returns a copy', () => {
    const meta = { a: 1 };
    const out = sanitizeMeta(meta);
    expect(out).not.toBe(meta);
    expect(out).toEqual(meta);
  });
});
