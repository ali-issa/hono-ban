/**
 * JSON:API 1.1 error documents over HTTP (SPEC 7.2, 7.2.1, 7.2.3).
 *
 * A consumer configures `createBan({ format: jsonApi(...) })`, throws from a
 * Hono route, and a real Node HTTP server answers. This suite proves the
 * answer is a JSON:API error document: the bare `application/vnd.api+json`
 * media type, one error object whose members appear in the SPEC order with
 * `status` as a string, `links.type` and `links.about` derived from the
 * configured bases, `meta` kept nested even when its keys collide with
 * standard members, the trace id under the configurable meta key, the
 * `X-Error-Id` header equal to `errors[0].id`, and bodies that validate
 * against the schema the format publishes for their entry. Validation
 * documents (SPEC 7.2.2) and the SPEC 7.4 conformance run live in
 * `format-json-api-validation.e2e.test.ts`.
 * @ref https://jsonapi.org/format/1.1/#errors
 */
import type {
  JsonApiBody,
  JsonApiErrorObject,
} from 'hono-ban/formats/json-api';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { JSON_API_CONTENT_TYPE, jsonApi } from 'hono-ban/formats/json-api';

import { schemaErrors } from './support/ajv';
import { startServer } from './support/server';

const DOCS_BASE_URL = 'https://errors.example.com';
const TYPE_BASE_URL = 'https://types.example.com';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
/** @ref https://www.w3.org/TR/trace-context/#traceparent-header */
const TRACEPARENT = `00-${TRACE_ID}-00f067aa0ba902b7-01`;
/** JSON:API schemas do not read `docsBaseUrl`; one context serves every instance. */
const SCHEMA_CONTEXT = {
  docsBaseUrl: DOCS_BASE_URL,
  dialect: 'draft-2020-12',
} as const;
/** Keys that name error-object members. They must stay under `meta`, never replace the real ones. */
const COLLIDING_META = {
  id: 'meta-id',
  status: 'nope',
  code: 'META_CODE',
  title: 'Meta title',
  detail: 'Meta detail',
  links: { type: 'https://meta.example.com' },
  source: { pointer: '/meta' },
  orderId: 7,
  nested: { a: [1, 2] },
} as const;

/** Starts `app` for the enclosing describe block and stops it afterwards. */
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
      throw new Error('server is not running');
    }
    const response = await server.fetch(path, init);
    return response;
  };
}

async function readBody(response: Response): Promise<JsonApiBody> {
  return (await response.json()) as JsonApiBody;
}

function firstError(body: JsonApiBody): JsonApiErrorObject {
  const [object] = body.errors;
  if (object === undefined) {
    throw new Error('errors array is empty');
  }
  return object;
}

describe('jsonApi() error documents', () => {
  const ban = createBan({ format: jsonApi(), docsBaseUrl: DOCS_BASE_URL });
  const app = new Hono();
  app.onError(ban.onError({ includeStack: true }));
  app.get('/orders/:id', (c) => {
    throw ban.conflict('Already shipped', {
      id: `conflict-${c.req.param('id')}`,
      meta: { orderId: 7, sku: 'A' },
    });
  });
  app.get('/colliding', () => {
    throw ban.notFound({ id: 'e2', meta: COLLIDING_META });
  });
  app.get('/boom', () => {
    throw ban.internalServerError({ cause: new Error('root cause') });
  });
  const request = useServer(app);

  it('answers with the bare JSON:API media type and no parameters', async () => {
    const response = await request('/orders/42');
    expect(response.status).toBe(409);
    // @ref https://jsonapi.org/format/1.1/#content-negotiation-servers
    expect(response.headers.get('content-type')).toBe(JSON_API_CONTENT_TYPE);
    expect(response.headers.get('content-type')).toBe(
      'application/vnd.api+json',
    );
  });

  it('renders one error object with members in SPEC order and status as a string', async () => {
    const body = await readBody(await request('/orders/42'));
    expect(body.errors).toHaveLength(1);
    const object = firstError(body);
    // @ref https://jsonapi.org/format/1.1/#error-objects
    expect(Object.keys(object)).toEqual([
      'id',
      'links',
      'status',
      'code',
      'title',
      'detail',
      'meta',
    ]);
    expect(object).toEqual({
      id: 'conflict-42',
      links: { type: `${DOCS_BASE_URL}/CONFLICT` },
      status: '409',
      code: 'CONFLICT',
      title: 'Conflict',
      detail: 'Already shipped',
      meta: { orderId: 7, sku: 'A' },
    });
  });

  it('sets X-Error-Id to errors[0].id', async () => {
    const response = await request('/orders/7');
    expect(response.headers.get('x-error-id')).toBe('conflict-7');
    expect(firstError(await readBody(response)).id).toBe('conflict-7');
  });

  it('keeps meta nested even when its keys collide with standard members', async () => {
    const object = firstError(await readBody(await request('/colliding')));
    expect(object).toEqual({
      id: 'e2',
      links: { type: `${DOCS_BASE_URL}/NOT_FOUND` },
      status: '404',
      code: 'NOT_FOUND',
      title: 'Not Found',
      meta: COLLIDING_META,
    });
  });

  it('puts a valid W3C trace id inside meta and never renders the request id', async () => {
    const response = await request('/orders/42', {
      headers: { traceparent: TRACEPARENT, 'X-Request-Id': 'req-1' },
    });
    const object = firstError(await readBody(response));
    expect(object.meta).toEqual({ orderId: 7, sku: 'A', traceId: TRACE_ID });
    // SPEC 7.2.1 lists no request id member; it reaches `onReport` only (SPEC 6.5).
    expect(JSON.stringify(object)).not.toContain('req-1');
    const garbage = await request('/orders/42', {
      headers: { traceparent: 'garbage' },
    });
    expect(firstError(await readBody(garbage)).meta).toEqual({
      orderId: 7,
      sku: 'A',
    });
  });

  it('adds the stack to meta on 5xx when includeStack is on', async () => {
    const response = await request('/boom');
    expect(response.status).toBe(500);
    const object = firstError(await readBody(response));
    expect(object.meta?.['stack']).toContain('root cause');
  });

  it('serves bodies that validate against the closed schema for their entry', async () => {
    const conflict = await readBody(
      await request('/orders/42', { headers: { traceparent: TRACEPARENT } }),
    );
    const notFound = await readBody(await request('/colliding'));
    const boom = await readBody(await request('/boom'));
    const conflictSchema = ban.format.schema(
      ban.catalog.CONFLICT,
      SCHEMA_CONTEXT,
    );
    expect(schemaErrors(conflictSchema, conflict)).toEqual([]);
    expect(
      schemaErrors(
        ban.format.schema(ban.catalog.NOT_FOUND, SCHEMA_CONTEXT),
        notFound,
      ),
    ).toEqual([]);
    expect(
      schemaErrors(
        ban.format.schema(ban.catalog.INTERNAL_SERVER_ERROR, SCHEMA_CONTEXT),
        boom,
      ),
    ).toEqual([]);
    // SPEC 7.2.3: status, code, and title are pinned and both objects are closed.
    expect(schemaErrors(conflictSchema, notFound)).not.toEqual([]);
    expect(
      schemaErrors(conflictSchema, { ...conflict, extra: true }),
    ).not.toEqual([]);
    expect(
      schemaErrors(conflictSchema, {
        errors: [{ ...firstError(conflict), extra: true }],
      }),
    ).not.toEqual([]);
  });
});

describe('jsonApi() with typeLinkBaseUrl, aboutLink, includeId: false, and a renamed trace key', () => {
  const ban = createBan({
    format: jsonApi({
      includeId: false,
      traceIdMetaKey: 'trace',
      typeLinkBaseUrl: TYPE_BASE_URL,
      aboutLink: (error, ctx) =>
        `https://status.example.com${ctx.instance ?? ''}/${error.id}`,
    }),
  });
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/gone', () => {
    throw ban.gone({ id: 'e3' });
  });
  const request = useServer(app);

  it('derives links.type from typeLinkBaseUrl and links.about from aboutLink(error, ctx)', async () => {
    const response = await request('/gone', {
      headers: { traceparent: TRACEPARENT },
    });
    const object = firstError(await readBody(response));
    // @ref https://jsonapi.org/format/1.1/#error-objects (`links.about`, `links.type`)
    expect(object).toEqual({
      links: {
        type: `${TYPE_BASE_URL}/GONE`,
        about: 'https://status.example.com/gone/e3',
      },
      status: '410',
      code: 'GONE',
      title: 'Gone',
      meta: { trace: TRACE_ID },
    });
    expect(object).not.toHaveProperty('id');
    // includeId only affects the body; the header keeps correlating (SPEC 6.9).
    expect(response.headers.get('x-error-id')).toBe('e3');
  });

  it('publishes a closed schema without id when includeId is false', async () => {
    const body = await readBody(await request('/gone'));
    const schema = ban.format.schema(ban.catalog.GONE, SCHEMA_CONTEXT);
    expect(schemaErrors(schema, body)).toEqual([]);
    expect(
      schemaErrors(schema, { errors: [{ ...firstError(body), id: 'e3' }] }),
    ).not.toEqual([]);
  });
});

describe('jsonApi() with traceIdMetaKey: false on an instance with docsBaseUrl', () => {
  const ban = createBan({
    format: jsonApi({ typeLinkBaseUrl: TYPE_BASE_URL, traceIdMetaKey: false }),
    docsBaseUrl: DOCS_BASE_URL,
  });
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/gone', () => {
    throw ban.gone({ id: 'e4' });
  });
  const request = useServer(app);

  it('drops the trace id, omits the empty meta, and derives links.type from typeLinkBaseUrl', async () => {
    const response = await request('/gone', {
      headers: { traceparent: TRACEPARENT },
    });
    const object = firstError(await readBody(response));
    expect(object).not.toHaveProperty('meta');
    // typeLinkBaseUrl overrides the instance docsBaseUrl (SPEC 7.2.1,
    // ADR 0010); the catalog holds no derived type that could win first.
    expect(object).toEqual({
      id: 'e4',
      links: { type: `${TYPE_BASE_URL}/GONE` },
      status: '410',
      code: 'GONE',
      title: 'Gone',
    });
  });
});
