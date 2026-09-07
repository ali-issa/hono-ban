import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';

import { BanError, isBanError } from './ban-error';

describe('BanError', () => {
  it('is an HTTPException with the given status', () => {
    const error = new BanError({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not Found',
    });
    expect(error).toBeInstanceOf(HTTPException);
    expect(error.status).toBe(404);
    expect(error.name).toBe('BanError');
  });

  it('uses detail as the message and falls back to title', () => {
    const withDetail = new BanError({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not Found',
      detail: 'Order 42 does not exist',
    });
    const withoutDetail = new BanError({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not Found',
    });
    expect(withDetail.message).toBe('Order 42 does not exist');
    expect(withDetail.detail).toBe('Order 42 does not exist');
    expect(withoutDetail.message).toBe('Not Found');
    expect(withoutDetail.detail).toBeUndefined();
  });

  it('mints an id when none is given and keeps a provided one', () => {
    const generated = new BanError({
      status: 500,
      code: 'INTERNAL',
      title: 'Internal Server Error',
    });
    const provided = new BanError({
      status: 500,
      code: 'INTERNAL',
      title: 'Internal Server Error',
      id: 'fixed-id',
    });
    expect(generated.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(provided.id).toBe('fixed-id');
  });

  it('carries headers, meta, and cause', () => {
    const cause = new Error('db down');
    const error = new BanError({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      title: 'Service Unavailable',
      headers: { 'Retry-After': '30' },
      meta: { region: 'eu-1' },
      cause,
    });
    expect(error.headers.get('retry-after')).toBe('30');
    expect(error.meta).toEqual({ region: 'eu-1' });
    expect(error.cause).toBe(cause);
  });

  it('defaults meta to an empty object and headers to empty', () => {
    const error = new BanError({
      status: 400,
      code: 'BAD_REQUEST',
      title: 'Bad Request',
    });
    expect(error.meta).toEqual({});
    expect([...error.headers.keys()]).toEqual([]);
  });
});

describe('isBanError', () => {
  it('narrows BanError instances only', () => {
    const ban = new BanError({
      status: 400,
      code: 'BAD_REQUEST',
      title: 'Bad Request',
    });
    expect(isBanError(ban)).toBe(true);
    expect(isBanError(new HTTPException(400))).toBe(false);
    expect(isBanError(new Error('x'))).toBe(false);
    expect(isBanError(null)).toBe(false);
    expect(isBanError({ status: 400 })).toBe(false);
  });
});

describe('BanError.getResponse', () => {
  it('renders a minimal JSON body when no renderer was injected', async () => {
    const error = new BanError({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not Found',
      detail: 'gone',
      id: 'e1',
      headers: { 'X-Custom': '1' },
    });
    const response = error.getResponse();
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('x-custom')).toBe('1');
    await expect(response.json()).resolves.toEqual({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not Found',
      detail: 'gone',
      id: 'e1',
    });
  });

  it('uses the injected renderer when present', async () => {
    const error = new BanError({
      status: 409,
      code: 'CONFLICT',
      title: 'Conflict',
      render: (e) => ({
        status: e.status,
        headers: new Headers({ 'Content-Type': 'application/problem+json' }),
        body: { rendered: e.code },
      }),
    });
    const response = error.getResponse();
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
    await expect(response.json()).resolves.toEqual({ rendered: 'CONFLICT' });
  });
});

describe('BanError.toInit', () => {
  it('round-trips every field including the id', () => {
    const cause = new Error('c');
    const error = new BanError({
      status: 409,
      code: 'CONFLICT',
      title: 'Conflict',
      detail: 'd',
      type: 'https://example.com/t',
      instance: '/i',
      meta: { a: 1 },
      headers: { 'X-A': '1' },
      cause,
      id: 'fixed',
      issues: [{ path: ['a'], message: 'm' }],
    });
    const copy = new BanError(error.toInit());
    expect(copy.id).toBe('fixed');
    expect(copy.detail).toBe('d');
    expect(copy.type).toBe('https://example.com/t');
    expect(copy.instance).toBe('/i');
    expect(copy.meta).toEqual({ a: 1 });
    expect(copy.headers.get('x-a')).toBe('1');
    expect(copy.cause).toBe(cause);
    expect(copy.issues).toEqual([{ path: ['a'], message: 'm' }]);
  });
});
