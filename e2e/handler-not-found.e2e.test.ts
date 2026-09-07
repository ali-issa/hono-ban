import type { ErrorReport } from 'hono-ban';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';

import { startServer } from './support/server';

/**
 * Unmatched routes through the error contract (README "Unmatched routes").
 * Hono answers a request no route matches from its `notFound` handler, not
 * from `onError`; the handler throwing `ban.notFound()` routes it through
 * `ban.onError()` so it carries the same body, `X-Error-Id`, and report as
 * every other error. Proves both of Hono's dispatch paths over real HTTP:
 * with no handler matched, `compose()` awaits the not-found handler inside
 * its try/catch and calls `onError`; with exactly one middleware matched
 * (the single-handler fast path) the not-found handler runs inside `next()`
 * and the rejected promise reaches `onError` through the `.catch` on the
 * result.
 * @ref https://github.com/honojs/hono/blob/main/src/hono-base.ts (`#dispatch`)
 * @ref https://github.com/honojs/hono/blob/main/src/compose.ts
 */

const ban = createBan({ docsBaseUrl: 'https://errors.example.com' });

function useServer(app: Hono): RunningServer['fetch'] {
  let server: RunningServer | undefined;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server?.close();
  });
  return async (path, init) => {
    if (server === undefined) {
      throw new Error('server not started');
    }
    return server.fetch(path, init);
  };
}

function build(middleware: boolean): {
  app: Hono;
  reports: Array<ErrorReport>;
} {
  const app = new Hono();
  const reports: Array<ErrorReport> = [];
  app.onError(
    ban.onError({
      onReport: (report) => {
        reports.push(report);
      },
    }),
  );
  if (middleware) {
    app.use('*', async (c, next) => {
      c.header('X-Middleware', 'ran');
      await next();
    });
  }
  app.notFound(() => {
    throw ban.notFound();
  });
  app.get('/orders/:id', (c) => c.json({ id: c.req.param('id') }));
  return { app, reports };
}

describe.each([
  { name: 'composed path (no handler matched)', middleware: false },
  {
    name: 'single-handler fast path (one middleware matched)',
    middleware: true,
  },
])('app.notFound throwing ban.notFound(): $name', ({ middleware }) => {
  const { app, reports } = build(middleware);
  const request = useServer(app);

  it('renders the unmatched route like every other error', async () => {
    const response = await request('/nope');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'https://errors.example.com/NOT_FOUND',
      status: 404,
      title: 'Not Found',
      instance: '/nope',
      code: 'NOT_FOUND',
    });
    expect(response.headers.get('x-error-id')).toBe(body['id']);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      id: body['id'],
      handled: true,
      context: { method: 'GET', path: '/nope' },
    });
  });

  it('leaves matched routes alone', async () => {
    const response = await request('/orders/42');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '42' });
  });
});
