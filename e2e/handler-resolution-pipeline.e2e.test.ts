import type { Env } from 'hono';

import type { Ban, EmptyCatalog, ErrorReport, HandlerOptions } from 'hono-ban';

import type { FetchApp, RunningServer } from './support/server';

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan, defineFormat, problemDetails } from 'hono-ban';

import { startServer } from './support/server';

/**
 * Handler resolution, part 2: the pipeline around `from()`. Proves `map`
 * precedence (SPEC 6.3), the two fallback tiers on handler failures
 * (SPEC 6.4), and the report on each path (SPEC 10.1) over real HTTP.
 * Part 1 (`from()` branches, non-Error throws) is
 * `handler-resolution-from.e2e.test.ts`; part 3 (`transform`, body cap,
 * `onReport`) is `handler-resolution-body.e2e.test.ts`.
 */

/** SPEC 13 `UNEXPECTED_DETAIL`. */
const UNEXPECTED_DETAIL = 'An unexpected error occurred';

class DomainError extends Error {
  public readonly sku = 'ABC';
}

type Fetch = RunningServer['fetch'];

/** Starts `app` for the enclosing describe and returns a lazily bound fetch. */
function useServer(app: FetchApp): { fetch: Fetch } {
  let server: RunningServer | undefined;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server?.close();
  });
  return {
    fetch: async (path, init) => {
      if (server === undefined) {
        throw new Error('server not started');
      }
      return server.fetch(path, init);
    },
  };
}

interface Harness {
  readonly reports: Array<ErrorReport>;
  readonly fetch: Fetch;
}

/** One app with the routes every describe below throws from. */
function harness(
  ban: Ban<EmptyCatalog>,
  options: HandlerOptions<Env, EmptyCatalog> = {},
): Harness {
  const reports: Array<ErrorReport> = [];
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
  app.get('/domain', () => {
    throw new DomainError('taken');
  });
  app.get('/boom', () => {
    throw new Error('secret database string');
  });
  app.get('/http', () => {
    throw new HTTPException(409, { message: 'taken' });
  });
  app.get('/not-found', () => {
    throw ban.notFound('Order 42 does not exist');
  });
  return { reports, ...useServer(app) };
}

describe('map precedence (SPEC 6.3)', () => {
  const withInstanceMap = createBan({ map: (_thrown, b) => b.gone() });

  describe('instance map only', () => {
    const { reports, fetch } = harness(withInstanceMap);

    // BanError and HTTPException go through `from` first; the map never sees them.
    it.each([
      { path: '/domain', status: 410, code: 'GONE' },
      { path: '/boom', status: 410, code: 'GONE' },
      { path: '/http', status: 409, code: 'CONFLICT' },
      { path: '/not-found', status: 404, code: 'NOT_FOUND' },
    ])('$path -> $status $code', async ({ path, status, code }) => {
      const res = await fetch(path);
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body).toMatchObject({ status, code, instance: path });
      const report = reports.find((r) => r.id === body.id);
      expect(report).toMatchObject({ status, code, handled: true });
    });
  });

  describe('handler map overrides (does not chain with) the instance map', () => {
    const { reports, fetch } = harness(withInstanceMap, {
      map: (thrown, b) =>
        thrown instanceof DomainError
          ? b.conflict({ detail: thrown.message, meta: { sku: thrown.sku } })
          : undefined,
    });

    it('maps the domain error through the handler map', async () => {
      const res = await fetch('/domain');
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body).toMatchObject({
        status: 409,
        code: 'CONFLICT',
        detail: 'taken',
        sku: 'ABC',
      });
      const report = reports.find((r) => r.id === body.id);
      expect(report).toMatchObject({ handled: true, code: 'CONFLICT' });
      expect(report?.cause).toBeInstanceOf(DomainError);
    });

    it('falls through to from() on undefined instead of the instance map', async () => {
      const res = await fetch('/boom');
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body).toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        detail: UNEXPECTED_DETAIL,
      });
      expect(reports.find((r) => r.id === body.id)?.handled).toBe(false);
    });
  });
});

describe('fallback on handler failures (SPEC 6.4)', () => {
  describe('a throwing map', () => {
    const { reports, fetch } = harness(createBan(), {
      map: () => {
        throw new Error('mapper broke');
      },
    });

    it('answers a constant 500 through the format and reports the failure', async () => {
      const res = await fetch('/domain');
      const text = await res.text();
      const body = JSON.parse(text);
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
      expect(body).toMatchObject({
        status: 500,
        title: 'Internal Server Error',
        detail: UNEXPECTED_DETAIL,
        code: 'INTERNAL_SERVER_ERROR',
      });
      // Tier 1 renders with default options, so no request-derived instance.
      expect(body).not.toHaveProperty('instance');
      expect(text).not.toContain('mapper broke');
      expect(res.headers.get('x-error-id')).toBe(body.id);
      expect(reports).toHaveLength(1);
      const [report] = reports;
      expect(report).toMatchObject({ id: body.id, handled: false });
      expect(report?.handlerFailure).toMatchObject({ message: 'mapper broke' });
      expect(report?.cause).toBeInstanceOf(DomainError);
    });

    it('is never consulted for an HTTPException', async () => {
      expect((await fetch('/http')).status).toBe(409);
    });
  });

  it('treats a map returning a non-BanError as a TypeError failure', async () => {
    const reports: Array<ErrorReport> = [];
    const app = new Hono();
    app.onError(
      createBan().onError({
        map: () => ({ status: 400 }) as never,
        onReport: (report) => {
          reports.push(report);
        },
      }),
    );
    app.get('/domain', () => {
      throw new DomainError('taken');
    });
    const server = await startServer(app);
    try {
      expect((await server.fetch('/domain')).status).toBe(500);
      expect(reports[0]?.handlerFailure).toBeInstanceOf(TypeError);
    } finally {
      await server.close();
    }
  });

  describe('a format whose render throws for everything but 500', () => {
    const base = problemDetails();
    const flaky = defineFormat({
      name: 'flaky',
      contentType: base.contentType,
      render: (error, ctx) => {
        if (error.code === 'INTERNAL_SERVER_ERROR') {
          return base.render(error, ctx);
        }
        throw new Error('format broke');
      },
      schema: (definition, ctx) => base.schema(definition, ctx),
    });
    const { reports, fetch } = harness(createBan({ format: flaky }));

    it('renders the tier-1 fallback 500 through the format with X-Error-Id', async () => {
      const res = await fetch('/not-found');
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
      const body = await res.json();
      expect(body).toMatchObject({
        status: 500,
        title: 'Internal Server Error',
        detail: UNEXPECTED_DETAIL,
        code: 'INTERNAL_SERVER_ERROR',
      });
      expect(res.headers.get('x-error-id')).toBe(body.id);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ id: body.id, handled: false });
      expect(reports[0]?.handlerFailure).toMatchObject({
        message: 'format broke',
      });
      expect(reports[0]?.cause).toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('a format whose render always throws', () => {
    const base = problemDetails();
    const broken = defineFormat({
      name: 'broken',
      contentType: base.contentType,
      render: () => {
        throw new Error('format broke');
      },
      schema: (definition, ctx) => base.schema(definition, ctx),
    });
    const { reports, fetch } = harness(createBan({ format: broken }));

    it('answers the tier-2 hand-built JSON body', async () => {
      const res = await fetch('/not-found');
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toBe('application/json');
      const body = await res.json();
      expect(Object.keys(body).toSorted()).toEqual([
        'detail',
        'id',
        'status',
        'title',
      ]);
      expect(body).toMatchObject({
        status: 500,
        title: 'Internal Server Error',
        detail: UNEXPECTED_DETAIL,
      });
      expect(typeof body.id).toBe('string');
      // SPEC 6.4 step 2 keeps the header merge, so the id is coherent across
      // body, header, and report (SPEC 10.2) even with a broken format.
      expect(res.headers.get('x-error-id')).toBe(body.id);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({ id: body.id, handled: false });
      expect(reports[0]?.handlerFailure).toMatchObject({
        message: 'format broke',
      });
    });
  });
});
