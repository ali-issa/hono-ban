import { describe, expect, it } from 'vitest';

import { readRequestId } from './request-id';

describe('readRequestId', () => {
  it('echoes safe ids', () => {
    expect(readRequestId('req-1.2_3')).toBe('req-1.2_3');
    expect(readRequestId('a'.repeat(128))).toBe('a'.repeat(128));
  });

  it('drops absent, empty, too long, or unsafe values', () => {
    const absent: string | undefined = undefined;
    expect(readRequestId(absent)).toBeUndefined();
    expect(readRequestId('')).toBeUndefined();
    expect(readRequestId('a'.repeat(129))).toBeUndefined();
    expect(readRequestId('bad\nvalue')).toBeUndefined();
    expect(readRequestId('<script>')).toBeUndefined();
    expect(readRequestId('with space')).toBeUndefined();
  });
});
