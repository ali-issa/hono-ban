import { describe, expect, it } from 'vitest';

import { createBan } from '../core/create-ban';

describe('ban.validation', () => {
  it('uses VALIDATION_FAILED by default and records the location in meta', () => {
    const ban = createBan();
    const error = ban.validation([{ path: ['email'], message: 'Invalid' }], {
      location: 'body',
      detail: 'Fix the email',
      meta: { form: 'signup' },
    });
    expect(error.status).toBe(422);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.detail).toBe('Fix the email');
    expect(error.meta).toEqual({ form: 'signup', location: 'body' });
    expect(error.issues).toEqual([{ path: ['email'], message: 'Invalid' }]);
    expect(error.cause).toBeUndefined();
  });

  it('keeps the caught failure as cause without rendering it', () => {
    const ban = createBan();
    const failure = new Error('driver text with a row value');
    const error = ban.validation([{ path: ['email'], message: 'Taken' }], {
      location: 'body',
      cause: failure,
    });
    expect(error.cause).toBe(failure);
    expect(JSON.stringify(ban.render(error).body)).not.toContain('row value');
  });
});
