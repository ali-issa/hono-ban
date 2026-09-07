import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { ErrorReport } from 'hono-ban';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';
import { validator } from 'hono/validator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';

import { startServer } from './support/server';

/**
 * Handler resolution, part 1: how a thrown value becomes a response when no
 * `map` is involved. Proves `ban.from()` over real HTTP (SPEC 5.5), the
 * handler guarantees (SPEC 6.1, 6.3), the report shape and id coherence
 * (SPEC 10.1, 10.2), and the constants the bodies rely on (SPEC 13). Part 2
 * (`map`, fallback, `transform`, body cap) is
 * `handler-resolution-pipeline.e2e.test.ts`.
 */

/** SPEC 13 `UNEXPECTED_DETAIL`. */
const UNEXPECTED_DETAIL = 'An unexpected error occurred';
/** SPEC 13 `MALFORMED_JSON_MESSAGE`; must match Hono's validator verbatim. */
const MALFORMED_JSON_MESSAGE = 'Malformed JSON in request body';
// Hono types only IANA statuses; a non-standard one needs a cast (SPEC 5.5 branch 2).
const NON_STANDARD_STATUS = 499 as ContentfulStatusCode;

const ban = createBan();
const reports: Array<ErrorReport> = [];
const secret = new Error('secret database string');
const lookupFailure = new Error('lookup failed: secret connection string');

const app = new Hono();
app.onError(
  ban.onError({
    onReport: (report) => {
      reports.push(report);
    },
  }),
);
app.use('/mw/*', async (_c, next) => {
  await next();
});
for (const path of ['/not-found', '/mw/not-found']) {
  app.get(path, () => {
    throw ban.notFound('Order 42 does not exist', { cause: lookupFailure });
  });
}
app.get('/boom', () => {
  throw secret;
});
app.get('/string', () => {
  // oxlint-disable-next-line typescript/only-throw-error, no-throw-literal -- reason: proves Hono rethrows non-Error values before onError (SPEC 6.1)
  throw 'a string';
});
app.get('/http-exception', (c) => {
  const status = Number(c.req.query('status')) as ContentfulStatusCode;
  const message = c.req.query('message');
  throw new HTTPException(status, message === undefined ? {} : { message });
});
app.use('/secure/*', bearerAuth({ token: 'secret' }));
app.get('/secure/a', (c) => c.text('ok'));
app.post(
  '/json',
  validator('json', (value) => value),
  (c) => c.text('ok'),
);

let server: RunningServer;

beforeAll(async () => {
  server = await startServer(app);
});

afterAll(async () => {
  await server.close();
});

/** Path for the `/http-exception` route; `message` omitted means no message. */
function httpException(status: number, message?: string): string {
  const query = new URLSearchParams({ status: String(status) });
  if (message !== undefined) {
    query.set('message', message);
  }
  return `/http-exception?${query.toString()}`;
}

/** The single report carrying `id`; fails loudly when it is missing. */
function reportFor(id: unknown): ErrorReport {
  const matching = reports.filter((report) => report.id === id);
  expect(matching).toHaveLength(1);
  const [report] = matching;
  if (report === undefined) {
    throw new Error(`no report with id ${String(id)}`);
  }
  return report;
}

describe('ban.from over HTTP (SPEC 5.5)', () => {
  it('hides a plain Error behind the constant 500 and reports it as cause', async () => {
    const res = await server.fetch('/boom');
    const text = await res.text();
    const body = JSON.parse(text);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(body).toMatchObject({
      type: 'about:blank',
      status: 500,
      title: 'Internal Server Error',
      detail: UNEXPECTED_DETAIL,
      code: 'INTERNAL_SERVER_ERROR',
      instance: '/boom',
    });
    expect(text).not.toContain('secret');
    expect([...res.headers.values()].join(' ')).not.toContain('secret');
    expect(body).not.toHaveProperty('stack');
    expect(res.headers.get('x-error-id')).toBe(body.id);
    const report = reportFor(body.id);
    expect(report.handled).toBe(false);
    expect(report.handlerFailure).toBeUndefined();
    expect(report.cause).toBe(secret);
    expect(report.error.cause).toBe(secret);
  });

  // SPEC 5.5 branch 2: primary entry for the status, MALFORMED_JSON only on
  // the exact validator message at 400, custom `Error` for unknown statuses.
  it.each([
    { status: 409, message: 'taken', code: 'CONFLICT', title: 'Conflict' },
    {
      status: 400,
      message: MALFORMED_JSON_MESSAGE,
      code: 'MALFORMED_JSON',
      title: 'Malformed JSON',
    },
    {
      status: 400,
      message: 'malformed json in request body!',
      code: 'BAD_REQUEST',
      title: 'Bad Request',
    },
    {
      status: 422,
      message: MALFORMED_JSON_MESSAGE,
      code: 'UNPROCESSABLE_CONTENT',
      title: 'Unprocessable Content',
    },
    {
      status: NON_STANDARD_STATUS,
      message: 'client closed request',
      code: 'CUSTOM',
      title: 'Error',
    },
  ])(
    'HTTPException($status, "$message") renders $code',
    async ({ status, message, code, title }) => {
      const res = await server.fetch(httpException(status, message));
      expect(res.status).toBe(status);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
      const body = await res.json();
      expect(body).toMatchObject({
        status,
        title,
        detail: message,
        code,
        instance: '/http-exception',
      });
      const report = reportFor(body.id);
      expect(report).toMatchObject({ status, code, handled: true });
      expect(report.cause).toBeInstanceOf(HTTPException);
    },
  );

  it('keeps an empty HTTPException message as no detail', async () => {
    const res = await server.fetch(httpException(403));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(body).not.toHaveProperty('detail');
  });

  it('keeps WWW-Authenticate from hono/bearer-auth and drops its body', async () => {
    // @ref https://hono.dev/docs/middleware/builtin/bearer-auth
    // @ref https://www.rfc-editor.org/rfc/rfc6750#section-3 (WWW-Authenticate: Bearer)
    const res = await server.fetch('/secure/a');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer realm=""');
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = await res.json();
    expect(body).toMatchObject({
      status: 401,
      title: 'Unauthorized',
      code: 'UNAUTHORIZED',
      instance: '/secure/a',
    });
    expect(body).not.toHaveProperty('detail');
    const report = reportFor(body.id);
    expect(report.handled).toBe(true);
    expect(report.cause).toBeInstanceOf(HTTPException);
    const ok = await server.fetch('/secure/a', {
      headers: { authorization: 'Bearer secret' },
    });
    expect(ok.status).toBe(200);
  });

  it('turns a malformed JSON body rejected by hono/validator into MALFORMED_JSON', async () => {
    // @ref https://github.com/honojs/hono/blob/main/src/validator/validator.ts
    const res = await server.fetch('/json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 400,
      title: 'Malformed JSON',
      detail: MALFORMED_JSON_MESSAGE,
      code: 'MALFORMED_JSON',
      instance: '/json',
    });
    const report = reportFor(body.id);
    expect(report.handled).toBe(true);
    expect(report.context).toMatchObject({ method: 'POST', path: '/json' });
    const ok = await server.fetch('/json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"fine":true}',
    });
    expect(ok.status).toBe(200);
  });

  it('never sees a thrown string: Hono rethrows it and the adapter answers 500', async () => {
    // Hono routes only `Error` instances to `onError`; anything else is
    // rethrown from `fetch` before the handler runs (SPEC 6.1), and the Node
    // adapter turns a throwing `fetch` into an empty 500.
    // @ref https://hono.dev/docs/api/hono#error-handling
    // @ref https://github.com/honojs/hono/blob/main/src/hono-base.ts (#handleError)
    // @ref https://github.com/honojs/node-server/blob/main/src/listener.ts (handleFetchError)
    const before = reports.length;
    const res = await server.fetch('/string');
    expect(res.status).toBe(500);
    expect(res.statusText).toBe('Internal Server Error');
    expect(res.headers.get('x-error-id')).toBeNull();
    expect(res.headers.get('content-type')).toBeNull();
    expect(await res.text()).toBe('');
    expect(reports).toHaveLength(before);
  });
});

describe('report guarantees (SPEC 6.1, 10.1, 10.2)', () => {
  it.each(['/not-found', '/mw/not-found'])(
    'reports exactly once with a coherent id (%s)',
    async (path) => {
      const res = await server.fetch(path);
      const text = await res.text();
      const body = JSON.parse(text);
      expect(res.status).toBe(404);
      expect(body).toMatchObject({
        status: 404,
        title: 'Not Found',
        detail: 'Order 42 does not exist',
        code: 'NOT_FOUND',
        instance: path,
      });
      expect(text).not.toContain('secret');
      expect(res.headers.get('x-error-id')).toBe(body.id);
      expect(reports.filter((r) => r.context.path === path)).toHaveLength(1);
      const report = reportFor(body.id);
      expect(report).toMatchObject({
        status: 404,
        code: 'NOT_FOUND',
        handled: true,
        context: { method: 'GET', path },
      });
      expect(report.error.id).toBe(body.id);
      expect(report.context.requestId).toBeUndefined();
      expect(report.context.traceId).toBeUndefined();
      expect(report.handlerFailure).toBeUndefined();
      // A thrown BanError reports its own `cause`, never itself.
      expect(report.cause).toBe(lookupFailure);
    },
  );
});
