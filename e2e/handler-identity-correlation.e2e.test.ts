/**
 * Handler correlation over HTTP: request ids and W3C `traceparent`
 * (SPEC 6.2, 6.5, 6.6, 10.1, 13). The default Problem Details body carries
 * `traceId` but not the request id (SPEC 7.1.1), so a thin `defineFormat`
 * wrapper echoes `ctx.requestId` where the request id tests need to observe
 * what the handler handed to the format; the report is asserted in every case.
 * Its sibling `handler-identity-ids.e2e.test.ts` covers error ids, header
 * precedence, stacks, and report shape.
 */
import type { Env } from 'hono';

import type { Ban, EmptyCatalog, ErrorReport, HandlerOptions } from 'hono-ban';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan, defineFormat, parseTraceparent } from 'hono-ban';
import { problemDetails } from 'hono-ban/formats/problem-details';

import { startServer } from './support/server';

type Body = Record<string, unknown>;
type Options = HandlerOptions<Env, EmptyCatalog>;

interface Harness {
  readonly reports: Array<ErrorReport>;
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const REQUEST_ID_MAX_LENGTH = 128;
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT = '00f067aa0ba902b7';
const VALID_TRACEPARENT = `00-${TRACE}-${PARENT}-01`;

const base = problemDetails();
/** Problem Details plus a `requestId` member taken from the render context. */
const echoingFormat = defineFormat({
  name: 'problem-details-echo',
  contentType: base.contentType,
  render: (error, ctx) => ({
    ...base.render(error, ctx),
    requestId: ctx.requestId,
  }),
  schema: (definition, ctx) => base.schema(definition, ctx),
});

/** One real server per describe; registers the lifecycle hooks itself. */
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
  headers: Record<string, string> = {},
): Promise<{ res: Response; body: Body; report: ErrorReport | undefined }> {
  const res = await app.fetch('/not-found', { headers });
  const body = (await res.json()) as Body;
  return { res, body, report: app.reports.at(-1) };
}

const echoing = createBan({ format: echoingFormat });
const ban = createBan();

describe('request id from X-Request-Id (SPEC 6.5)', () => {
  const app = useApp(echoing);

  it.each([
    { label: 'letters, digits, dot, underscore, dash', value: 'req-1.2_3' },
    {
      label: `${String(REQUEST_ID_MAX_LENGTH)} characters`,
      value: 'a'.repeat(REQUEST_ID_MAX_LENGTH),
    },
  ])(
    'echoes a valid id ($label) into the body and the report',
    async ({ value }) => {
      const { res, body, report } = await call(app, { 'X-Request-Id': value });
      expect(res.status).toBe(404);
      expect(body['requestId']).toBe(value);
      expect(report?.context.requestId).toBe(value);
    },
  );

  it.each([
    { label: 'too long', value: 'a'.repeat(REQUEST_ID_MAX_LENGTH + 1) },
    { label: 'contains a space', value: 'with space' },
    { label: 'contains angle brackets', value: '<script>' },
    { label: 'empty', value: '' },
  ])('treats an invalid id ($label) as absent', async ({ value }) => {
    const { body, report } = await call(app, { 'X-Request-Id': value });
    expect(body).not.toHaveProperty('requestId');
    expect(report?.context.requestId).toBeUndefined();
  });

  it('never fabricates a request id when the header is missing', async () => {
    const { body, report } = await call(app);
    expect(body).not.toHaveProperty('requestId');
    expect(report?.context.requestId).toBeUndefined();
    expect(report?.id).toBe(body['id']);
  });
});

describe('requestIdHeader renamed', () => {
  const app = useApp(echoing, { requestIdHeader: 'X-Correlation-Id' });

  it('reads the configured header and ignores X-Request-Id', async () => {
    const { body, report } = await call(app, {
      'X-Correlation-Id': 'c1',
      'X-Request-Id': 'r1',
    });
    expect(body['requestId']).toBe('c1');
    expect(report?.context.requestId).toBe('c1');
  });
});

describe('requestIdHeader: false', () => {
  const app = useApp(echoing, { requestIdHeader: false });

  it('disables the lookup even when X-Request-Id is present', async () => {
    const { body, report } = await call(app, { 'X-Request-Id': 'r1' });
    expect(body).not.toHaveProperty('requestId');
    expect(report?.context.requestId).toBeUndefined();
  });
});

describe('requestId function override', () => {
  const app = useApp(echoing, {
    requestId: (c) => c.req.header('X-Other'),
  });

  it('replaces the header lookup and its validation', async () => {
    const { body, report } = await call(app, {
      'X-Other': 'anything goes',
      'X-Request-Id': 'r1',
    });
    expect(body['requestId']).toBe('anything goes');
    expect(report?.context.requestId).toBe('anything goes');
  });

  it('yields no request id when the override returns undefined', async () => {
    const { body, report } = await call(app, { 'X-Request-Id': 'r1' });
    expect(body).not.toHaveProperty('requestId');
    expect(report?.context.requestId).toBeUndefined();
  });
});

describe('traceparent (SPEC 6.6)', () => {
  const app = useApp(ban);

  // @ref https://www.w3.org/TR/trace-context/#traceparent-header
  it.each([
    { label: 'sampled', header: VALID_TRACEPARENT },
    { label: 'not sampled', header: `00-${TRACE}-${PARENT}-00` },
    // @ref https://www.w3.org/TR/trace-context/#versioning-of-traceparent
    {
      label: 'future version with extra field',
      header: `01-${TRACE}-${PARENT}-01-future`,
    },
    {
      label: 'future version without extra field',
      header: `01-${TRACE}-${PARENT}-01`,
    },
  ])(
    'reads trace and parent ids from a valid header ($label)',
    async ({ header }) => {
      const { body, report } = await call(app, { traceparent: header });
      expect(body['traceId']).toBe(TRACE);
      expect(report?.context.traceId).toBe(TRACE);
      expect(report?.context.spanId).toBe(PARENT);
      expect(parseTraceparent(header)?.traceId).toBe(TRACE);
    },
  );

  // @ref https://www.w3.org/TR/trace-context/#traceparent-header-field-values
  it.each([
    { label: 'version ff', header: `ff-${TRACE}-${PARENT}-01` },
    { label: 'all-zero trace id', header: `00-${'0'.repeat(32)}-${PARENT}-01` },
    { label: 'all-zero parent id', header: `00-${TRACE}-${'0'.repeat(16)}-01` },
    {
      label: 'uppercase hex',
      header: `00-${TRACE.toUpperCase()}-${PARENT}-01`,
    },
    { label: 'flags too short', header: `00-${TRACE}-${PARENT}-0` },
    {
      label: 'version 00 with trailing field',
      header: `00-${TRACE}-${PARENT}-01-extra`,
    },
    {
      label: 'future version without dash separator',
      header: `01-${TRACE}-${PARENT}-01x`,
    },
    { label: 'garbage', header: 'garbage' },
    { label: 'empty', header: '' },
  ])('ignores an invalid header ($label)', async ({ header }) => {
    const { res, body, report } = await call(app, { traceparent: header });
    expect(res.status).toBe(404);
    expect(body).not.toHaveProperty('traceId');
    expect(report?.context.traceId).toBeUndefined();
    expect(report?.context.spanId).toBeUndefined();
    expect(parseTraceparent(header)).toBeUndefined();
  });

  it('keeps the request id out of the default Problem Details body (SPEC 7.1.1)', async () => {
    const { body, report } = await call(app, {
      'X-Request-Id': 'req-1',
      traceparent: VALID_TRACEPARENT,
    });
    expect(body).not.toHaveProperty('requestId');
    expect(body['traceId']).toBe(TRACE);
    expect(report?.context).toMatchObject({
      requestId: 'req-1',
      traceId: TRACE,
      spanId: PARENT,
    });
  });
});

describe('traceId function override', () => {
  const app = useApp(ban, { traceId: (c) => c.req.header('X-Trace') });

  it('replaces traceparent parsing and leaves spanId unset', async () => {
    const { body, report } = await call(app, {
      'X-Trace': 'custom-trace',
      traceparent: VALID_TRACEPARENT,
    });
    expect(body['traceId']).toBe('custom-trace');
    expect(report?.context.traceId).toBe('custom-trace');
    expect(report?.context.spanId).toBeUndefined();
  });

  it('does not fall back to traceparent when the override returns undefined', async () => {
    const { body, report } = await call(app, {
      traceparent: VALID_TRACEPARENT,
    });
    expect(body).not.toHaveProperty('traceId');
    expect(report?.context.traceId).toBeUndefined();
    expect(report?.context.spanId).toBeUndefined();
  });
});
