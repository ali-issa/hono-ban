import type { ErrorReport } from 'hono-ban';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bearerChallenge, createBan } from 'hono-ban';

import { startServer } from './support/server';

/**
 * Headers adopted from an `HTTPException` response over real HTTP (SPEC 5.5,
 * 13). `ban.from()` keeps the exception's headers but discards its body, so
 * the headers that described that body must not reach the client: a stale
 * `Content-Length` cuts the rendered JSON short and a stale `Content-Encoding`
 * makes the client decompress plain text. Only a real server shows this;
 * `app.request()` never frames a body. A 416 is the exception: there
 * `Content-Range` states the representation's length and is kept.
 * Sibling: `handler-resolution-from`.
 */

const UPSTREAM_BODY = 'upstream said no';
const ban = createBan();
const reports: Array<ErrorReport> = [];
const app = new Hono();
app.onError(
  ban.onError({
    onReport: (report) => {
      reports.push(report);
    },
  }),
);
app.get('/proxied', () => {
  // An upstream response adopted wholesale, framing headers included.
  throw new HTTPException(502, {
    message: UPSTREAM_BODY,
    res: new Response(UPSTREAM_BODY, {
      status: 502,
      headers: {
        'Content-Type': 'text/plain',
        'Content-Length': String(UPSTREAM_BODY.length),
        'Content-Encoding': 'gzip',
        'Content-Language': 'en',
        'Retry-After': '5',
      },
    }),
  });
});

app.get('/range', () => {
  // A range request the resource could not satisfy (RFC 9110 15.5.17).
  throw new HTTPException(416, {
    res: new Response(null, {
      status: 416,
      headers: {
        'Content-Range': 'bytes */1000',
        'Content-Type': 'text/plain',
      },
    }),
  });
});

app.get('/scoped', () => {
  // RFC 6750 3.1: insufficient_scope answers 403 with the required scope.
  throw ban.forbidden('Token lacks orders:write', {
    headers: {
      'WWW-Authenticate': bearerChallenge({
        realm: 'api',
        scope: ['orders:write'],
        error: 'insufficient_scope',
        errorDescription: 'Token lacks orders:write',
        resourceMetadata:
          'https://api.example.com/.well-known/oauth-protected-resource',
      }),
    },
  });
});

let server: RunningServer;

beforeAll(async () => {
  server = await startServer(app);
});

afterAll(async () => {
  await server.close();
});

describe('headers adopted from an HTTPException response (SPEC 5.5)', () => {
  it('drops the body-describing headers and keeps the rest', async () => {
    // @ref https://www.rfc-editor.org/rfc/rfc9110#section-8.4 (Content-Encoding)
    // @ref https://www.rfc-editor.org/rfc/rfc9110#section-8.6 (Content-Length)
    const res = await server.fetch('/proxied');
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('content-language')).toBe('en');
    expect(res.headers.get('retry-after')).toBe('5');
    const text = await res.text();
    // The body arrives whole; the kept upstream length would have cut it.
    expect(res.headers.get('content-length')).toBe(
      String(new TextEncoder().encode(text).byteLength),
    );
    const body = JSON.parse(text);
    expect(body).toMatchObject({
      status: 502,
      code: 'BAD_GATEWAY',
      detail: UPSTREAM_BODY,
      instance: '/proxied',
    });
    expect(res.headers.get('x-error-id')).toBe(body.id);
    const report = reports.find((r) => r.id === body.id);
    expect(report?.handled).toBe(true);
    expect(report?.cause).toBeInstanceOf(HTTPException);
  });

  it('keeps Content-Range on a 416 because it describes the representation', async () => {
    // @ref https://www.rfc-editor.org/rfc/rfc9110#section-14.4
    const res = await server.fetch('/range');
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */1000');
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = JSON.parse(await res.text());
    expect(body).toMatchObject({ status: 416, code: 'RANGE_NOT_SATISFIABLE' });
  });
});

describe('bearerChallenge over HTTP (SPEC 3.2)', () => {
  it('reaches the client verbatim with every attribute quoted', async () => {
    // @ref https://www.rfc-editor.org/rfc/rfc6750#section-3
    // @ref https://www.rfc-editor.org/rfc/rfc9728#section-5.1
    const res = await server.fetch('/scoped');
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer realm="api", scope="orders:write", error="insufficient_scope", ' +
        'error_description="Token lacks orders:write", ' +
        'resource_metadata="https://api.example.com/.well-known/oauth-protected-resource"',
    );
    expect(await res.json()).toMatchObject({ code: 'FORBIDDEN' });
  });
});
