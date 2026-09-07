import { describe, expect, it } from 'vitest';

import { createBan } from './create-ban';
import { parseFactoryArgs } from './factories';

describe('parseFactoryArgs', () => {
  it('accepts (detail), (detail, options), (options), and ()', () => {
    expect(parseFactoryArgs(undefined, {})).toEqual({});
    expect(parseFactoryArgs('d', {})).toEqual({ detail: 'd' });
    expect(parseFactoryArgs('d', { id: 'fixed' })).toEqual({
      detail: 'd',
      id: 'fixed',
    });
    expect(parseFactoryArgs({ detail: 'x' }, {})).toEqual({ detail: 'x' });
  });

  it('lets the detail string win over options.detail', () => {
    expect(parseFactoryArgs('a', { detail: 'b' })).toEqual({ detail: 'a' });
  });

  it('throws TypeError for other first arguments', () => {
    expect(() => parseFactoryArgs(42, {})).toThrow(TypeError);
    expect(() => parseFactoryArgs(null, {})).toThrow(TypeError);
  });
});

describe('factories', () => {
  const ban = createBan({ docsBaseUrl: 'https://errors.example.com' });

  it('build from the catalog entry', () => {
    const error = ban.notFound('Order 42 does not exist');
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.title).toBe('Not Found');
    expect(error.detail).toBe('Order 42 does not exist');
    // The type URI is the format's to derive (ADR 0010); the error carries
    // only explicit ones.
    expect(error.type).toBeUndefined();
    expect(ban.render(error).body).toMatchObject({
      type: 'https://errors.example.com/NOT_FOUND',
    });
    expect(error.definition?.key).toBe('NOT_FOUND');
  });

  it('apply type, instance, and id and carry headers, meta, cause', () => {
    const cause = new Error('c');
    const error = ban.conflict({
      detail: 'd',
      type: 'https://example.com/taken',
      instance: '/orders/1',
      headers: { 'Retry-After': '5' },
      meta: { orderId: 1 },
      cause,
      id: 'fixed',
    });
    // code and title are the catalog's: the schema pins them (ADR 0011).
    expect(error.code).toBe('CONFLICT');
    expect(error.title).toBe('Conflict');
    expect(error.type).toBe('https://example.com/taken');
    expect(error.instance).toBe('/orders/1');
    expect(error.headers.get('retry-after')).toBe('5');
    expect(error.meta).toEqual({ orderId: 1 });
    expect(error.cause).toBe(cause);
    expect(error.id).toBe('fixed');
    expect(error.status).toBe(409);
  });

  it('expose the RFC 7231 (413) and RFC 4918 (422) names as aliases', () => {
    expect(ban.payloadTooLarge().status).toBe(413);
    expect(ban.unprocessableEntity().code).toBe('UNPROCESSABLE_CONTENT');
  });

  it('never throw for valid input', () => {
    expect(() => ban.internalServerError()).not.toThrow();
    expect(() => ban.badRequest({})).not.toThrow();
  });
});
