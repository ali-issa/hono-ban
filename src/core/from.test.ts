import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';

import { createBan } from './create-ban';

// Hono types only official statuses; non-standard ones need a cast.
const NON_STANDARD = 499 as ContentfulStatusCode;

const ban = createBan({
  errors: { CLIENT_CLOSED: { status: NON_STANDARD, title: 'Client Closed' } },
});

describe('ban.from', () => {
  it('returns BanErrors unchanged', () => {
    const error = ban.notFound();
    expect(ban.from(error)).toBe(error);
  });

  it('maps an HTTPException to the primary entry for its status', () => {
    const error = ban.from(new HTTPException(409, { message: 'taken' }));
    expect(error.code).toBe('CONFLICT');
    expect(error.detail).toBe('taken');
    expect(error.cause).toBeInstanceOf(HTTPException);
  });

  it('keeps an empty message as no detail', () => {
    expect(ban.from(new HTTPException(403)).detail).toBeUndefined();
  });

  it('recognizes Hono validator JSON failures by exact message only', () => {
    expect(
      ban.from(
        new HTTPException(400, { message: 'Malformed JSON in request body' }),
      ).code,
    ).toBe('MALFORMED_JSON');
    expect(
      ban.from(
        new HTTPException(400, { message: 'malformed json in request body!' }),
      ).code,
    ).toBe('BAD_REQUEST');
    expect(
      ban.from(
        new HTTPException(422, { message: 'Malformed JSON in request body' }),
      ).code,
    ).toBe('UNPROCESSABLE_CONTENT');
  });

  it('preserves headers from res and discards its body', () => {
    const res = new Response('nope', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm=""' },
    });
    const error = ban.from(new HTTPException(401, { res }));
    expect(error.status).toBe(401);
    expect(error.headers.get('www-authenticate')).toBe('Bearer realm=""');
    expect(error.detail).toBeUndefined();
  });

  it('drops the headers that described the discarded body', () => {
    // A proxied upstream response: its framing and coding headers would
    // corrupt the JSON the format writes in its place (SPEC 5.5, 13).
    const res = new Response('upstream said no', {
      status: 502,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': '16',
        'Content-Encoding': 'gzip',
        'Content-Location': '/upstream',
        'Content-Range': 'bytes 0-15/16',
        'Transfer-Encoding': 'chunked',
        'Retry-After': '5',
        'Content-Language': 'en',
      },
    });
    const error = ban.from(new HTTPException(502, { res }));
    for (const name of [
      'content-type',
      'content-length',
      'content-encoding',
      'content-location',
      'content-range',
      'transfer-encoding',
    ]) {
      expect(error.headers.has(name)).toBe(false);
    }
    expect(error.headers.get('retry-after')).toBe('5');
    expect(error.headers.get('content-language')).toBe('en');
    // The exception's own headers are untouched.
    expect(res.headers.get('content-encoding')).toBe('gzip');
  });

  it('keeps Content-Range on a 416, where it describes the representation', () => {
    // On a 416 the header carries the complete length, not the body's range.
    // @ref https://www.rfc-editor.org/rfc/rfc9110#section-14.4
    const res = new Response(null, {
      status: 416,
      headers: {
        'Content-Range': 'bytes */1000',
        'Content-Type': 'text/plain',
      },
    });
    const error = ban.from(new HTTPException(416, { res }));
    expect(error.status).toBe(416);
    expect(error.headers.get('content-range')).toBe('bytes */1000');
    expect(error.headers.has('content-type')).toBe(false);
  });

  it('uses a custom entry for a status the built-ins lack', () => {
    const error = ban.from(new HTTPException(NON_STANDARD, { message: 'bye' }));
    expect(error.code).toBe('CLIENT_CLOSED');
    expect(error.status).toBe(499);
  });

  it('builds a CUSTOM error for a status nobody defines', () => {
    const error = ban.from(new HTTPException(477 as ContentfulStatusCode));
    expect(error.code).toBe('CUSTOM');
    expect(error.title).toBe('Error');
    expect(error.status).toBe(477);
  });

  it('turns anything else into a constant-detail 500', () => {
    for (const thrown of [
      new Error('secret'),
      'a string',
      { status: 400 },
      null,
    ]) {
      const error = ban.from(thrown);
      expect(error.status).toBe(500);
      expect(error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(error.detail).toBe('An unexpected error occurred');
      expect(error.cause).toBe(thrown);
    }
  });
});
