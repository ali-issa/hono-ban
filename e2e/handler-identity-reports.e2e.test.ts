/**
 * Handler reports over HTTP: `ErrorReport` shape and context, `handled` per
 * resolution path, stack exposure, and the `onReport` contract (SPEC 6.1, 6.7,
 * 10.1). Siblings: `handler-identity-ids.e2e.test.ts` (error ids, header
 * precedence) and `handler-identity-correlation.e2e.test.ts` (request ids,
 * `traceparent`).
 */
import type { Env } from 'hono';

import type { Ban, EmptyCatalog, ErrorReport, HandlerOptions } from 'hono-ban';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan, isBanError } from 'hono-ban';

import { startServer } from './support/server';

type Body = Record<string, unknown>;
type Options = HandlerOptions<Env, EmptyCatalog>;

interface Harness {
  readonly reports: Array<ErrorReport>;
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

class DomainError extends Error {
  public readonly sku = 'ABC';
}

/** One real server per describe; registers the lifecycle hooks itself. */
function useApp(ban: Ban<EmptyCatalog>, options: Options = {}): Harness {
  const reports: Array<ErrorReport> = [];
  let server: RunningServer | undefined;
  beforeAll(async () => {
    const app = new Hono();
    app.onError(
      ban.onError({
        ...options,
        onReport: async (report, c) => {
          reports.push(report);
          await options.onReport?.(report, c);
        },
      }),
    );
    app.get('/not-found', () => {
      throw ban.notFound('Order 42 does not exist');
    });
    app.get('/boom', () => {
      throw new Error('secret database string');
    });
    app.get('/wrapped', () => {
      throw ban.internalServerError('outer detail text', {
        cause: new Error('root cause message'),
      });
    });
    app.get('/http', () => {
      throw new HTTPException(409, { message: 'taken' });
    });
    app.get('/domain', () => {
      throw new DomainError('taken');
    });
    app.post('/orders/:id/items', () => {
      throw ban.conflict('Item already exists');
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
): Promise<{ res: Response; body: Body; report: ErrorReport | undefined }> {
  const res = await app.fetch(path, init);
  const body = (await res.json()) as Body;
  return { res, body, report: app.reports.at(-1) };
}

const ban = createBan();

describe('report shape (SPEC 10.1)', () => {
  const app = useApp(ban);

  it('describes a thrown BanError', async () => {
    const { body, report } = await call(app, '/not-found');
    expect(report).toBeDefined();
    expect(isBanError(report?.error)).toBe(true);
    expect(report?.error.id).toBe(body['id']);
    expect(report).toMatchObject({
      id: body['id'],
      status: 404,
      code: 'NOT_FOUND',
      handled: true,
      context: {
        requestId: undefined,
        traceId: undefined,
        spanId: undefined,
        method: 'GET',
        path: '/not-found',
      },
    });
    // The BanError itself was thrown, so `cause` is its (absent) cause.
    expect(report?.cause).toBeUndefined();
    expect(report?.handlerFailure).toBeUndefined();
  });

  it('carries the thrown value as cause when it was not a BanError', async () => {
    const { body, report } = await call(app, '/boom');
    expect(report?.handled).toBe(false);
    expect(report?.cause).toBeInstanceOf(Error);
    expect(report?.cause).toMatchObject({ message: 'secret database string' });
    expect(report?.handlerFailure).toBeUndefined();
    // The client sees the constant 500, not the internal message.
    expect(body['detail']).toBe('An unexpected error occurred');
  });
});

describe('report context and handled per resolution path (SPEC 10.1)', () => {
  const app = useApp(ban, {
    map: (error, instance) =>
      error instanceof DomainError
        ? instance.conflict(error.message)
        : undefined,
  });

  it.each([
    ['/not-found', 'GET', true, 404, 'NOT_FOUND'],
    ['/http', 'GET', true, 409, 'CONFLICT'],
    ['/domain', 'GET', true, 409, 'CONFLICT'],
    ['/boom', 'GET', false, 500, 'INTERNAL_SERVER_ERROR'],
    ['/orders/42/items', 'POST', true, 409, 'CONFLICT'],
  ])(
    '%s %s reports handled: %s',
    async (path, method, handled, status, code) => {
      // The query string is not part of `c.req.path`.
      // @ref https://hono.dev/docs/api/request#path
      const { res, body, report } = await call(app, `${path}?x=1`, { method });
      expect(res.status).toBe(status);
      expect(body['instance']).toBe(path);
      expect(report).toMatchObject({
        id: body['id'],
        status,
        code,
        handled,
        context: { method, path },
      });
    },
  );
});

describe('includeStack default (SPEC 6.7)', () => {
  const app = useApp(ban);

  it('omits the stack and the cause message from a 500', async () => {
    const res = await app.fetch('/boom');
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).not.toHaveProperty('stack');
    expect(text).not.toContain('secret');
  });
});

describe('includeStack: true (SPEC 6.7)', () => {
  const app = useApp(ban, { includeStack: true });

  it('adds the thrown error stack to a 5xx body', async () => {
    const { body } = await call(app, '/boom');
    expect(body['stack']).toContain('secret database string');
  });

  it('never adds a stack to a 4xx body', async () => {
    const { res, body } = await call(app, '/not-found');
    expect(res.status).toBe(404);
    expect(body).not.toHaveProperty('stack');
  });

  it('prefers the cause stack when a BanError wraps an Error', async () => {
    const { body } = await call(app, '/wrapped');
    expect(body['detail']).toBe('outer detail text');
    expect(body['stack']).toContain('root cause message');
    expect(body['stack']).not.toContain('outer detail text');
  });
});

describe('onReport contract (SPEC 6.1)', () => {
  const app = useApp(ban, {
    onReport: () => {
      throw new Error('sink is down');
    },
  });

  it('is called once per error and its failure does not change the response', async () => {
    const { res, body } = await call(app, '/not-found');
    expect(res.status).toBe(404);
    expect(body['code']).toBe('NOT_FOUND');
    expect(app.reports).toHaveLength(1);
    await call(app, '/boom');
    expect(app.reports).toHaveLength(2);
  });
});
