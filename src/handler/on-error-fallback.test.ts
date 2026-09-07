import type { Env } from 'hono';

import type {
  Ban,
  EmptyCatalog,
  ErrorReport,
  HandlerOptions,
} from '../core/types';
import type { ErrorFormat } from '../formats/types';

import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';
import { validator } from 'hono/validator';
import { describe, expect, it } from 'vitest';

import { createBan } from '../core/create-ban';
import { plain } from '../formats/plain';

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

describe('ban.onError mapping and fallback', () => {
  it('uses map to turn domain errors into catalog errors', async () => {
    const { app, reports } = build(ban, {
      map: (error, b) =>
        error instanceof DomainError
          ? b.conflict({ detail: error.message, meta: { sku: error.sku } })
          : undefined,
    });
    const response = await app.request('/domain');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      detail: 'taken',
      sku: 'ABC',
    });
    expect(reports[0]?.handled).toBe(true);
    const other = await app.request('/boom');
    expect(other.status).toBe(500);
  });

  it('prefers the handler map over the instance map', async () => {
    const withInstanceMap = createBan({ map: (_e, b) => b.gone() });
    const { app } = build(withInstanceMap, { map: (_e, b) => b.tooEarly() });
    expect((await app.request('/domain')).status).toBe(425);
    const { app: fallbackApp } = build(withInstanceMap);
    expect((await fallbackApp.request('/domain')).status).toBe(410);
  });

  it('treats a throwing map as a handler failure', async () => {
    const { app, reports } = build(ban, {
      map: () => {
        throw new Error('mapper broke');
      },
    });
    const response = await app.request('/domain');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      detail: 'An unexpected error occurred',
    });
    expect(reports).toHaveLength(1);
    expect(reports[0]?.handled).toBe(false);
    expect(reports[0]?.handlerFailure).toMatchObject({
      message: 'mapper broke',
    });
  });

  it('treats a map returning a non-BanError as a handler failure', async () => {
    const { app, reports } = build(ban, {
      map: () => ({ status: 400 }) as never,
    });
    expect((await app.request('/domain')).status).toBe(500);
    expect(reports[0]?.handlerFailure).toBeInstanceOf(TypeError);
  });

  it('falls back to a hand-built body when the format itself throws', async () => {
    const broken: ErrorFormat = {
      ...plain(),
      name: 'broken',
      render: () => {
        throw new Error('format broke');
      },
    };
    const { app, reports } = build(createBan({ format: broken }), {
      headers: { 'X-Static': 'yes' },
    });
    const response = await app.request('/not-found');
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('application/json');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 500,
      title: 'Internal Server Error',
      detail: 'An unexpected error occurred',
    });
    expect(typeof body['id']).toBe('string');
    // The header merge (SPEC 6.9) still runs, so the id stays coherent
    // across body, header, and report (SPEC 10.2).
    expect(response.headers.get('x-error-id')).toBe(body['id']);
    expect(response.headers.get('x-static')).toBe('yes');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(reports[0]?.id).toBe(body['id']);
    expect(reports[0]?.handlerFailure).toMatchObject({
      message: 'format broke',
    });
  });

  it('still responds when onReport throws, and never rejects', async () => {
    const { app } = build(ban, {
      onReport: () => {
        throw new Error('sink down');
      },
    });
    const response = await app.request('/not-found');
    expect(response.status).toBe(404);
    const { app: brokenMap } = build(ban, {
      map: () => {
        throw new Error('x');
      },
      onReport: () => {
        throw new Error('sink down');
      },
    });
    await expect(brokenMap.request('/domain')).resolves.toHaveProperty(
      'status',
      500,
    );
  });
});
