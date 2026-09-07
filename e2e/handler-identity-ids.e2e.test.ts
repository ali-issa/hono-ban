/**
 * Handler identity over HTTP. The error id is the correlation key: the same
 * value must reach the `X-Error-Id` header, the body, and the `ErrorReport`
 * (SPEC 6.9, 10.2, 13). Also proves the `errorIdHeader` option, header
 * precedence, deterministic ids from `createBan({ id })`, and id/report
 * coherence under concurrency. Siblings: `handler-identity-reports.e2e.test.ts`
 * (stack exposure, report shape, `onReport`) and
 * `handler-identity-correlation.e2e.test.ts` (request ids, `traceparent`).
 */
import type { Env } from 'hono';

import type { Ban, EmptyCatalog, ErrorReport, HandlerOptions } from 'hono-ban';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';

import { startServer } from './support/server';

type Body = Record<string, unknown>;
type Options = HandlerOptions<Env, EmptyCatalog>;

interface Harness {
  readonly reports: Array<ErrorReport>;
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

// Default ids come from `crypto.randomUUID()` (SPEC 2).
// @ref https://www.rfc-editor.org/rfc/rfc9562#name-uuid-format
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PARALLEL_REQUESTS = 20;

/**
 * One real server per describe; registers the lifecycle hooks itself. The
 * error thrown by `/colliding` carries headers that deliberately collide with
 * the option headers and the library headers (SPEC 6.9).
 */
function useApp(ban: Ban<EmptyCatalog>, options: Options = {}): Harness {
  const reports: Array<ErrorReport> = [];
  let server: RunningServer | undefined;
  beforeAll(async () => {
    const app = new Hono();
    app.onError(
      ban.onError({
        ...options,
        onReport: (report) => {
          reports.push(report);
        },
      }),
    );
    app.get('/not-found', () => {
      throw ban.notFound('Order 42 does not exist');
    });
    app.get('/colliding', () => {
      throw ban.notFound('Order 42 does not exist', {
        headers: {
          'X-A': 'err',
          'Content-Type': 'text/html',
          'X-Error-Id': 'err-id',
        },
      });
    });
    app.get('/cookies', () => {
      throw ban.forbidden({
        headers: [
          ['Set-Cookie', 'a=1; Path=/'],
          ['Set-Cookie', 'b=2; Path=/'],
        ],
      });
    });
    app.get('/boom', () => {
      throw new Error('secret database string');
    });
    server = await startServer(app);
  });
  afterAll(async () => {
    await server?.close();
  });
  return {
    reports,
    fetch: async (path, init) => {
      if (server === undefined) {
        throw new Error('server not started');
      }
      return server.fetch(path, init);
    },
  };
}

async function call(
  app: Harness,
  path: string,
  init?: RequestInit,
): Promise<{ res: Response; body: Body }> {
  const res = await app.fetch(path, init);
  const body = (await res.json()) as Body;
  return { res, body };
}

const ban = createBan();

describe('error id coherence (SPEC 10.2)', () => {
  const app = useApp(ban);

  it('puts one id in the X-Error-Id header, the body, and the report', async () => {
    const { res, body } = await call(app, '/not-found');
    expect(res.status).toBe(404);
    expect(body['id']).toMatch(UUID_PATTERN);
    expect(res.headers.get('x-error-id')).toBe(body['id']);
    expect(app.reports).toHaveLength(1);
    expect(app.reports[0]?.id).toBe(body['id']);
    expect(app.reports[0]?.error.id).toBe(body['id']);
  });

  it('keeps ids coherent for unknown errors wrapped by ban.from()', async () => {
    const { res, body } = await call(app, '/boom');
    expect(res.status).toBe(500);
    expect(body['id']).toMatch(UUID_PATTERN);
    expect(res.headers.get('x-error-id')).toBe(body['id']);
    expect(app.reports.at(-1)?.id).toBe(body['id']);
  });
});

describe('errorIdHeader renamed', () => {
  const app = useApp(ban, { errorIdHeader: 'X-Trace-Error' });

  it('moves the id to the new header and drops X-Error-Id', async () => {
    const { res, body } = await call(app, '/not-found');
    expect(res.headers.get('x-trace-error')).toBe(body['id']);
    expect(res.headers.get('x-error-id')).toBeNull();
    expect(app.reports[0]?.id).toBe(body['id']);
  });
});

describe('errorIdHeader disabled', () => {
  const app = useApp(ban, { errorIdHeader: false });

  it('removes the header while the body and report keep the id', async () => {
    const { res, body } = await call(app, '/not-found');
    expect(res.headers.get('x-error-id')).toBeNull();
    expect(body['id']).toMatch(UUID_PATTERN);
    expect(app.reports[0]?.id).toBe(body['id']);
  });
});

describe('header merge order (SPEC 6.9)', () => {
  const app = useApp(ban, {
    headers: {
      'X-A': 'opt',
      'X-B': 'opt',
      'Content-Type': 'text/plain',
      'X-Error-Id': 'opt-id',
      'Set-Cookie': 'opt=1; Path=/',
    },
  });

  it('lets error headers beat options and library headers beat both', async () => {
    const { res, body } = await call(app, '/colliding');
    // Options lose to the error's own headers on a conflict.
    expect(res.headers.get('x-a')).toBe('err');
    // Options survive when nothing else sets the header.
    expect(res.headers.get('x-b')).toBe('opt');
    // Content-Type is the format's, even when the error or options set one.
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    // The error id header is always the real id, never a supplied value.
    expect(res.headers.get('x-error-id')).toBe(body['id']);
    expect(res.headers.get('x-error-id')).not.toBe('opt-id');
    expect(res.headers.get('x-error-id')).not.toBe('err-id');
    // The handler never sets Vary.
    expect(res.headers.get('vary')).toBeNull();
    // Error bodies carry occurrence ids, so they are never cacheable by
    // default (SPEC 6.9). @ref https://www.rfc-editor.org/rfc/rfc9110#section-15.1
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps every Set-Cookie instead of collapsing them to the last one', async () => {
    // Set-Cookie values never combine, so the merge appends each cookie.
    // @ref https://fetch.spec.whatwg.org/#dom-headers-getsetcookie
    const { res } = await call(app, '/cookies');
    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([
      'opt=1; Path=/',
      'a=1; Path=/',
      'b=2; Path=/',
    ]);
  });
});

describe('Cache-Control supplied through options (SPEC 6.9)', () => {
  const app = useApp(ban, {
    headers: { 'Cache-Control': 'private, max-age=60' },
  });

  it('replaces the no-store default', async () => {
    const { res } = await call(app, '/not-found');
    expect(res.headers.get('cache-control')).toBe('private, max-age=60');
  });
});

describe('header merge with errorIdHeader renamed (SPEC 6.9)', () => {
  const app = useApp(ban, {
    errorIdHeader: 'X-Trace-Error',
    headers: { 'X-Error-Id': 'opt-id' },
  });

  it('only owns the configured header; other names pass through the merge', async () => {
    const { res, body } = await call(app, '/colliding');
    expect(res.headers.get('x-trace-error')).toBe(body['id']);
    // `X-Error-Id` is now an ordinary header: the error's value beats the option's.
    expect(res.headers.get('x-error-id')).toBe('err-id');
  });
});

describe('createBan({ id })', () => {
  let counter = 0;
  const deterministic = createBan({
    id: () => {
      counter += 1;
      return `err-${String(counter).padStart(4, '0')}`;
    },
  });
  const app = useApp(deterministic);

  it('feeds generated ids to the header, body, and report', async () => {
    const first = await call(app, '/not-found');
    expect(first.body['id']).toBe('err-0001');
    expect(first.res.headers.get('x-error-id')).toBe('err-0001');
    expect(app.reports[0]?.id).toBe('err-0001');
    // Unknown errors are wrapped by `ban.from()` and use the same generator.
    const second = await call(app, '/boom');
    expect(second.body['id']).toBe('err-0002');
    expect(second.res.headers.get('x-error-id')).toBe('err-0002');
    expect(app.reports[1]?.id).toBe('err-0002');
  });
});

describe('concurrent requests', () => {
  const app = useApp(ban);

  it('gives every response a unique id that matches its own report', async () => {
    const results = await Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, async (_unused, index) => {
        const requestId = `req-${String(index)}`;
        const { res, body } = await call(app, '/not-found', {
          headers: { 'X-Request-Id': requestId },
        });
        return {
          requestId,
          id: body['id'],
          header: res.headers.get('x-error-id'),
        };
      }),
    );
    expect(app.reports).toHaveLength(PARALLEL_REQUESTS);
    expect(new Set(results.map((r) => r.id)).size).toBe(PARALLEL_REQUESTS);
    for (const result of results) {
      expect(result.header).toBe(result.id);
      const report = app.reports.find(
        (r) => r.context.requestId === result.requestId,
      );
      expect(report?.id).toBe(result.id);
    }
  });
});
