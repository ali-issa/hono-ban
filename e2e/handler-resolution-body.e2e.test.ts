import type { Env } from 'hono';

import type { Ban, EmptyCatalog, ErrorReport, HandlerOptions } from 'hono-ban';

import type { FetchApp, RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan, defineFormat } from 'hono-ban';

import { compileWithAjv } from './support/ajv';
import { startServer } from './support/server';

/**
 * Handler resolution, part 3: what happens to a resolved error's body and
 * report after rendering. Proves `transform` ordering (SPEC 6.2), the body
 * cap (SPEC 6.8), and `onReport` isolation (SPEC 6.1) over real HTTP. Parts 1
 * and 2 are `handler-resolution-from.e2e.test.ts` and
 * `handler-resolution-pipeline.e2e.test.ts`.
 */

/** SPEC 13 `TRUNCATED_DETAIL_LENGTH`. */
const TRUNCATED_DETAIL_LENGTH = 1024;
/** Small enough that `/huge` (a 100 KB meta blob) always trips it. */
const SMALL_CAP = 4096;
const PADDING_LENGTH = 64;

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
  app.get('/not-found', () => {
    throw ban.notFound('Order 42 does not exist');
  });
  app.get('/huge', () => {
    throw ban.badRequest({
      detail: 'd'.repeat(2000),
      meta: { blob: 'x'.repeat(100_000) },
    });
  });
  return { reports, ...useServer(app) };
}

describe('transform (SPEC 6.2)', () => {
  const { reports, fetch } = harness(createBan(), {
    transform: (body, error, c) => ({
      error: body,
      status: 200,
      code: error.code,
      path: c.req.path,
    }),
  });

  it('reshapes the body but cannot change the status or headers', async () => {
    const res = await fetch('/not-found');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = await res.json();
    expect(body).toMatchObject({
      status: 200,
      code: 'NOT_FOUND',
      path: '/not-found',
      error: { status: 404, code: 'NOT_FOUND', instance: '/not-found' },
    });
    expect(res.headers.get('x-error-id')).toBe(body.error.id);
    expect(reports[0]).toMatchObject({ id: body.error.id, status: 404 });
  });
});

describe('body cap (SPEC 6.8)', () => {
  describe('with the default format', () => {
    const ban = createBan();
    const { fetch } = harness(ban, { maxBodyBytes: SMALL_CAP });

    it('re-renders a minimal body that still matches the format schema', async () => {
      const res = await fetch('/huge');
      const text = await res.text();
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
      expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(
        SMALL_CAP,
      );
      const body = JSON.parse(text);
      expect(body).not.toHaveProperty('blob');
      expect(body).not.toHaveProperty('meta');
      expect(body.detail).toHaveLength(TRUNCATED_DETAIL_LENGTH);
      expect(body).toMatchObject({
        status: 400,
        code: 'BAD_REQUEST',
        instance: '/huge',
      });
      expect(res.headers.get('x-error-id')).toBe(body.id);
      const schema = ban.format.schema(ban.catalog.BAD_REQUEST, {
        docsBaseUrl: undefined,
        dialect: 'draft-2020-12',
      });
      expect(compileWithAjv(schema)(body)).toEqual([]);
    });
  });

  describe('with the default cap', () => {
    const { fetch } = harness(createBan());

    it('applies the 65536-byte default when maxBodyBytes is not set', async () => {
      // 100 KB exceeds the default cap too, so the blob is still dropped;
      // this pins the default rather than assuming it is unbounded (SPEC 13).
      const body = await (await fetch('/huge')).json();
      expect(body).not.toHaveProperty('blob');
      expect(body.detail).toHaveLength(TRUNCATED_DETAIL_LENGTH);
    });
  });

  describe('with a format that exposes ctx.truncated', () => {
    const witness = defineFormat({
      name: 'witness',
      contentType: 'application/json',
      render: (error, ctx) => ({
        status: error.status,
        detail: error.detail,
        truncated: ctx.truncated,
        meta: ctx.meta,
      }),
      schema: () => ({ type: 'object' }),
    });
    const { fetch } = harness(createBan({ format: witness }), {
      maxBodyBytes: SMALL_CAP,
      transform: (body) => ({
        ...(body as object),
        padding: 'p'.repeat(PADDING_LENGTH),
      }),
    });

    it('renders once, untruncated, when the body fits (transform kept)', async () => {
      const body = await (await fetch('/not-found')).json();
      expect(body).toMatchObject({
        status: 404,
        detail: 'Order 42 does not exist',
        truncated: false,
        meta: {},
      });
      expect(body.padding).toHaveLength(PADDING_LENGTH);
    });

    it('renders again with truncated: true and empty meta when it does not', async () => {
      const body = await (await fetch('/huge')).json();
      expect(body).toMatchObject({ status: 400, truncated: true, meta: {} });
      expect(body.detail).toHaveLength(TRUNCATED_DETAIL_LENGTH);
      // transform runs on the minimal body too (SPEC 6.8), so its additions
      // are present in both renders.
      expect(body.padding).toHaveLength(PADDING_LENGTH);
    });
  });

  describe('with a redacting transform', () => {
    const { fetch } = harness(createBan(), {
      maxBodyBytes: SMALL_CAP,
      transform: (body) => ({
        ...(body as Record<string, unknown>),
        detail: '[redacted]',
      }),
    });

    it('does not let the minimal re-render undo the redaction', async () => {
      const res = await fetch('/huge');
      const text = await res.text();
      expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(
        SMALL_CAP,
      );
      expect(text).not.toContain('dddd');
      expect(JSON.parse(text)).toMatchObject({
        status: 400,
        code: 'BAD_REQUEST',
        detail: '[redacted]',
      });
    });
  });
});

describe('onReport isolation (SPEC 6.1)', () => {
  let sinkCalls = 0;
  const { reports, fetch } = harness(createBan(), {
    // Only `/domain` reaches the map: a thrown BanError bypasses it (SPEC 6.3).
    map: () => {
      throw new Error('mapper broke');
    },
    onReport: () => {
      sinkCalls += 1;
      throw new Error('sink down');
    },
  });

  it.each([
    { path: '/not-found', status: 404, handled: true },
    { path: '/domain', status: 500, handled: false },
  ])(
    'keeps $status for $path and calls the throwing sink once',
    async ({ path, status, handled }) => {
      const before = sinkCalls;
      const res = await fetch(path);
      expect(res.status).toBe(status);
      const body = await res.json();
      expect(body.status).toBe(status);
      expect(sinkCalls).toBe(before + 1);
      const matching = reports.filter((r) => r.id === body.id);
      expect(matching).toHaveLength(1);
      expect(matching[0]?.handled).toBe(handled);
    },
  );
});
