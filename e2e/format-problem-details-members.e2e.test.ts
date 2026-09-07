/**
 * RFC 9457 Problem Details over HTTP, part 1: member order, `instance`,
 * `type` derivation, and the `ProblemDetailsOptions` toggles (SPEC 7.1,
 * 7.1.1). Part 2 (`-extensions`) covers 7.1.2 and 7.1.3 with 8.1; part 3
 * (`-schema`) covers 7.1.4 and 7.4. Every body a server returns here is
 * checked against the JSON Schema the package publishes for it.
 * @ref https://www.rfc-editor.org/rfc/rfc9457
 */
import type { Ban, EmptyCatalog, JsonSchema } from 'hono-ban';

import type { FetchApp, RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import {
  PROBLEM_DETAILS_CONTENT_TYPE,
  problemDetails,
} from 'hono-ban/formats/problem-details';
import { errorSchema } from 'hono-ban/openapi';

import { schemaErrors } from './support/ajv';
import { startServer } from './support/server';

/**
 * The W3C example header; its second field is the trace id.
 * @ref https://www.w3.org/TR/trace-context/#examples-of-http-traceparent-headers
 */
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const DETAIL = 'Order 42 does not exist';
const DOCS_BASE = 'https://docs.example.com/errors';
const TYPE_BASE = 'https://errors.example.com';
const EXPLICIT_TYPE = 'https://example.com/problems/order-missing';
const LIBRARY_MEMBERS = 'type status title detail instance code id';
const SCHEMA_CTX = {
  docsBaseUrl: undefined,
  dialect: 'draft-2020-12',
} as const;

/** Starts `app` for the enclosing describe block and closes it afterwards. */
function useServer(app: FetchApp): RunningServer['fetch'] {
  let server: RunningServer | undefined;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server?.close();
  });
  return async (path, init) => {
    if (server === undefined) {
      throw new Error('server is not running');
    }
    const res = await server.fetch(path, init);
    return res;
  };
}

/** One route that throws `ban.notFound(DETAIL)`, for per-instance servers. */
function appFor(ban: Ban<EmptyCatalog>): Hono {
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/missing', () => {
    throw ban.notFound(DETAIL);
  });
  return app;
}

/** Member names in emission order, so order assertions read as one line. */
function keys(body: Record<string, unknown>): string {
  return Object.keys(body).join(' ');
}

/**
 * Reads a Problem Details body and checks the media type, the schema, and
 * that `status` mirrors the HTTP status.
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-3
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.1.2
 */
async function problem(
  res: Response,
  schema: JsonSchema,
): Promise<Record<string, unknown>> {
  expect(res.headers.get('content-type')).toBe(PROBLEM_DETAILS_CONTENT_TYPE);
  const body: Record<string, unknown> = await res.json();
  expect(schemaErrors(schema, body)).toEqual([]);
  expect(body['status']).toBe(res.status);
  return body;
}

describe('member order (SPEC 7.1.1)', () => {
  const ban = createBan();
  const app = new Hono();
  app.onError(ban.onError({ includeStack: true }));
  app.get('/orders/:id', () => {
    throw ban.notFound(DETAIL);
  });
  app.get('/bare', () => {
    throw ban.notFound();
  });
  app.get('/boom', () => {
    throw ban.internalServerError('Database unavailable');
  });
  const send = useServer(app);
  const notFound = errorSchema(ban, 'NOT_FOUND');

  it('emits standard members first, then library members', async () => {
    const res = await send('/orders/42', {
      headers: { traceparent: TRACEPARENT },
    });
    expect(res.status).toBe(404);
    const body = await problem(res, notFound);
    expect(keys(body)).toBe(`${LIBRARY_MEMBERS} traceId`);
    // @ref https://www.rfc-editor.org/rfc/rfc9457#section-4.2.1 (about:blank pairs with the reason phrase)
    expect(body).toEqual({
      type: 'about:blank',
      status: 404,
      title: 'Not Found',
      detail: DETAIL,
      instance: '/orders/42',
      code: 'NOT_FOUND',
      id: res.headers.get('x-error-id'),
      traceId: TRACE_ID,
    });
  });

  it('omits detail and the trace id when neither is known', async () => {
    const body = await problem(await send('/bare'), notFound);
    expect(keys(body)).toBe('type status title instance code id');
  });

  it('places stack after the library members on a 500', async () => {
    const res = await send('/boom');
    expect(res.status).toBe(500);
    const body = await problem(res, errorSchema(ban, 'INTERNAL_SERVER_ERROR'));
    expect(keys(body)).toBe(`${LIBRARY_MEMBERS} stack`);
    expect(body['stack']).toContain('Database unavailable');
  });

  it('uses the request path without the query string as instance', async () => {
    // @ref https://hono.dev/docs/api/request#path (`c.req.path` excludes the query)
    // @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.1.5
    const body = await problem(
      await send('/orders/42?expand=items&page=2'),
      notFound,
    );
    expect(body['instance']).toBe('/orders/42');
  });
});

describe('type derivation (SPEC 7.1.1)', () => {
  const bare = createBan();
  const docs = createBan({ docsBaseUrl: DOCS_BASE });
  const typed = createBan({
    format: problemDetails({ typeBaseUrl: TYPE_BASE }),
  });
  const both = createBan({
    docsBaseUrl: DOCS_BASE,
    format: problemDetails({ typeBaseUrl: TYPE_BASE }),
  });
  const bans = { bare, docs, typed, both };
  const bothApp = appFor(both);
  bothApp.get('/explicit', () => {
    throw both.notFound({ detail: DETAIL, type: EXPLICIT_TYPE });
  });
  bothApp.get('/custom', () => {
    throw both.custom({ status: 409, detail: DETAIL });
  });
  const apps = {
    bare: appFor(bare),
    docs: appFor(docs),
    typed: appFor(typed),
    both: bothApp,
  };
  const servers = new Map<string, RunningServer>();

  function serverFor(name: string): RunningServer {
    const server = servers.get(name);
    if (server === undefined) {
      throw new Error(`no server for ${name}`);
    }
    return server;
  }

  beforeAll(async () => {
    for (const [name, app] of Object.entries(apps)) {
      servers.set(name, await startServer(app));
    }
  });
  afterAll(async () => {
    for (const server of servers.values()) {
      await server.close();
    }
  });

  it.each([
    { name: 'bare', type: 'about:blank' },
    { name: 'docs', type: `${DOCS_BASE}/NOT_FOUND` },
    { name: 'typed', type: `${TYPE_BASE}/NOT_FOUND` },
    // The format option overrides the instance docsBaseUrl (SPEC 7.1.1,
    // ADR 0010): the catalog holds no derived type for it to compete with.
    { name: 'both', type: `${TYPE_BASE}/NOT_FOUND` },
  ] as const)(
    'renders type $type for the $name instance',
    async ({ name, type }) => {
      const body = await problem(
        await serverFor(name).fetch('/missing'),
        errorSchema(bans[name], 'NOT_FOUND'),
      );
      expect(body['type']).toBe(type);
    },
  );

  it('prefers an explicit type and derives custom errors from typeBaseUrl', async () => {
    const server = serverFor('both');
    const explicit = await problem(
      await server.fetch('/explicit'),
      errorSchema(both, 'NOT_FOUND'),
    );
    expect(explicit['type']).toBe(EXPLICIT_TYPE);
    // `ban.custom()` has no catalog definition (SPEC 5.3); its type is
    // derived exactly like a catalog error's.
    const custom = await problem(
      await server.fetch('/custom'),
      both.format.schema(
        { ...both.catalog.CONFLICT, code: 'CUSTOM' },
        SCHEMA_CTX,
      ),
    );
    expect(custom['type']).toBe(`${TYPE_BASE}/CUSTOM`);
    expect(custom['code']).toBe('CUSTOM');
  });
});

describe('member toggles (SPEC 7.1, 7.1.4)', () => {
  const renamed = createBan({
    format: problemDetails({
      includeCode: false,
      includeId: false,
      traceIdMember: 'trace_id',
      instance: false,
    }),
  });
  const untraced = createBan({
    format: problemDetails({ traceIdMember: false }),
  });
  const sendRenamed = useServer(appFor(renamed));
  const sendUntraced = useServer(appFor(untraced));

  it('drops code, id, and instance and renames the trace id member', async () => {
    const schema = errorSchema(renamed, 'NOT_FOUND');
    const res = await sendRenamed('/missing', {
      headers: { traceparent: TRACEPARENT },
    });
    const body = await problem(res, schema);
    expect(body).toEqual({
      type: 'about:blank',
      status: 404,
      title: 'Not Found',
      detail: DETAIL,
      trace_id: TRACE_ID,
    });
    // The error id header is the handler's, not the format's (SPEC 6.9).
    expect(res.headers.get('x-error-id')).not.toBeNull();
    // Optional members appear in the schema only when their option is on.
    const properties = schema['properties'] as Record<string, unknown>;
    expect(keys(properties)).toBe('type status title detail trace_id');
  });

  it('omits the trace id entirely when traceIdMember is false', async () => {
    const schema = errorSchema(untraced, 'NOT_FOUND');
    const res = await sendUntraced('/missing', {
      headers: { traceparent: TRACEPARENT },
    });
    const body = await problem(res, schema);
    expect(keys(body)).toBe(LIBRARY_MEMBERS);
    expect(schema['properties']).not.toHaveProperty('traceId');
  });
});
