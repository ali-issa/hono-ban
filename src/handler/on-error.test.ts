import type { Env } from 'hono';

import type {
  Ban,
  EmptyCatalog,
  ErrorReport,
  HandlerOptions,
} from '../core/types';

import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';
import { validator } from 'hono/validator';
import { describe, expect, it } from 'vitest';

import { createBan } from '../core/create-ban';

class DomainError extends Error {
  readonly sku = 'ABC';
}

type Options = HandlerOptions<Env, EmptyCatalog>;

function build(
  ban: Ban<EmptyCatalog>,
  options: Options = {},
  middleware = false,
): { app: Hono; reports: Array<ErrorReport> } {
  const app = new Hono();
  const reports: Array<ErrorReport> = [];
  app.onError(
    ban.onError({
      ...options,
      onReport: async (report, c) => {
        reports.push(report);
        await options.onReport?.(report, c);
      },
    }),
  );
  if (middleware) {
    app.use(async (_c, next) => {
      await next();
    });
  }
  app.get('/not-found', () => {
    throw ban.notFound('Order 42 does not exist', {
      headers: { 'X-A': 'err' },
    });
  });
  app.get('/cacheable', () => {
    throw ban.gone({ headers: { 'Cache-Control': 'public, max-age=3600' } });
  });
  app.get('/boom', () => {
    throw new Error('secret database string');
  });
  app.get('/string', () => {
    // oxlint-disable-next-line typescript/only-throw-error, no-throw-literal -- reason: proves Hono rethrows non-Error values before onError
    throw 'a string';
  });
  app.get('/domain', () => {
    throw new DomainError('taken');
  });
  app.get('/http', () => {
    throw new HTTPException(409, { message: 'taken' });
  });
  app.get('/huge', () => {
    throw ban.badRequest({ meta: { blob: 'x'.repeat(100_000) } });
  });
  app.get('/cookies', () => {
    throw ban.forbidden({
      headers: [
        ['Set-Cookie', 'a=1; Path=/'],
        ['Set-Cookie', 'b=2; Path=/'],
      ],
    });
  });
  app.use('/secure/*', bearerAuth({ token: 'secret' }));
  app.get('/secure/a', (c) => c.text('ok'));
  app.post(
    '/json',
    validator('json', (value) => value),
    (c) => c.text('ok'),
  );
  return { app, reports };
}

const ban = createBan();

describe('ban.onError', () => {
  it.each([false, true])(
    'renders one response and one report (middleware: %s)',
    async (middleware) => {
      const { app, reports } = build(ban, {}, middleware);
      const response = await app.request('/not-found');
      const body = (await response.json()) as Record<string, unknown>;
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toBe(
        'application/problem+json',
      );
      expect(body).toMatchObject({
        type: 'about:blank',
        status: 404,
        title: 'Not Found',
        detail: 'Order 42 does not exist',
        instance: '/not-found',
        code: 'NOT_FOUND',
      });
      expect(reports).toHaveLength(1);
      expect(reports[0]?.id).toBe(body['id']);
      expect(response.headers.get('x-error-id')).toBe(body['id']);
      expect(reports[0]?.handled).toBe(true);
      expect(reports[0]?.context).toMatchObject({
        method: 'GET',
        path: '/not-found',
      });
    },
  );

  it('keeps status and WWW-Authenticate from hono/bearer-auth', async () => {
    const { app, reports } = build(ban);
    const response = await app.request('/secure/a');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toContain('Bearer');
    await expect(response.json()).resolves.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(reports[0]?.handled).toBe(true);
  });

  it('maps Hono validator JSON failures to MALFORMED_JSON', async () => {
    const { app } = build(ban);
    const response = await app.request('/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'MALFORMED_JSON',
      detail: 'Malformed JSON in request body',
    });
  });

  it('converts HTTPException by status and keeps its message as detail', async () => {
    const { app } = build(ban);
    const response = await app.request('/http');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'CONFLICT',
      detail: 'taken',
    });
  });

  it('hides unknown errors behind a constant 500 and reports the cause', async () => {
    const { app, reports } = build(ban);
    const response = await app.request('/boom');
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(500);
    expect(body['detail']).toBe('An unexpected error occurred');
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(body).not.toHaveProperty('stack');
    expect(reports[0]?.handled).toBe(false);
    expect(reports[0]?.cause).toBeInstanceOf(Error);
    expect(reports[0]?.cause).toMatchObject({
      message: 'secret database string',
    });
  });

  it('never sees non-Error throws because Hono rethrows them before onError', async () => {
    // @ref https://github.com/honojs/hono/blob/main/src/hono-base.ts (handleError)
    const { app, reports } = build(ban);
    let caught: unknown;
    try {
      await app.request('/string');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe('a string');
    expect(reports).toHaveLength(0);
  });

  it('adds the stack on 5xx only when includeStack is on', async () => {
    const { app } = build(ban, { includeStack: true });
    const body = (await (await app.request('/boom')).json()) as Record<
      string,
      unknown
    >;
    expect(body['stack']).toContain('secret database string');
    const client = (await (await app.request('/not-found')).json()) as Record<
      string,
      unknown
    >;
    expect(client).not.toHaveProperty('stack');
  });

  it('applies transform before the size cap', async () => {
    const { app } = build(ban, {
      transform: (body, error) => ({
        ...(body as object),
        localized: `E${error.status}`,
      }),
    });
    await expect(
      (await app.request('/not-found')).json(),
    ).resolves.toMatchObject({
      localized: 'E404',
    });
  });

  it('caps oversized bodies', async () => {
    const { app } = build(ban, { maxBodyBytes: 4096 });
    const response = await app.request('/huge');
    const text = await response.text();
    expect(text.length).toBeLessThan(4096);
    expect(response.status).toBe(400);
    expect(JSON.parse(text)).not.toHaveProperty('blob');
  });

  it('applies transform to the capped body as well', async () => {
    const { app } = build(ban, {
      maxBodyBytes: 4096,
      transform: (body) => ({
        ...(body as Record<string, unknown>),
        detail: '[redacted]',
      }),
    });
    const body = (await (await app.request('/huge')).json()) as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty('blob');
    expect(body['detail']).toBe('[redacted]');
  });

  it('merges headers: options, then error headers, then Content-Type and X-Error-Id', async () => {
    const { app } = build(ban, { headers: { 'X-A': 'opt', 'X-B': 'opt' } });
    const response = await app.request('/not-found');
    expect(response.headers.get('x-a')).toBe('err');
    expect(response.headers.get('x-b')).toBe('opt');
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
    expect(response.headers.get('x-error-id')).toBeTruthy();
  });

  it('adds Cache-Control: no-store unless the options or the error set one', async () => {
    // @ref https://www.rfc-editor.org/rfc/rfc9110#section-15.1
    const { app } = build(ban);
    const cached = async (path: string): Promise<Response> => app.request(path);
    expect((await cached('/not-found')).headers.get('cache-control')).toBe(
      'no-store',
    );
    expect((await cached('/cacheable')).headers.get('cache-control')).toBe(
      'public, max-age=3600',
    );
    const { app: overridden } = build(ban, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
    expect(
      (await overridden.request('/not-found')).headers.get('cache-control'),
    ).toBe('private, max-age=60');
  });

  it('keeps every Set-Cookie from the options and the error', async () => {
    const { app } = build(ban, { headers: { 'Set-Cookie': 'opt=1; Path=/' } });
    const response = await app.request('/cookies');
    expect(response.headers.getSetCookie()).toEqual([
      'opt=1; Path=/',
      'a=1; Path=/',
      'b=2; Path=/',
    ]);
  });

  it('renames or disables the error id header', async () => {
    const { app: renamed } = build(ban, { errorIdHeader: 'X-Trace-Error' });
    const a = await renamed.request('/not-found');
    expect(a.headers.get('x-trace-error')).toBeTruthy();
    expect(a.headers.get('x-error-id')).toBeNull();
    const { app: disabled } = build(ban, { errorIdHeader: false });
    expect(
      (await disabled.request('/not-found')).headers.get('x-error-id'),
    ).toBeNull();
  });
});
