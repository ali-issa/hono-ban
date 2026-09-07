/**
 * AIP-193 Google API error bodies over HTTP (SPEC 7.6, 7.6.1, 7.6.2).
 *
 * A consumer configures `createBan({ format: googleApi({ domain }) })`,
 * throws from a Hono route, and a real Node HTTP server answers. This suite
 * proves the answer is the HTTP/1.1+JSON representation of
 * `google.rpc.Status`: `error.code` is the HTTP status, `error.status` the
 * `google.rpc.Code` name derived from the catalog code or the status,
 * `details` opens with an `ErrorInfo` whose `reason` is the catalog code and
 * whose `metadata` holds `meta` as strings, `RequestInfo.requestId` equals the
 * `X-Error-Id` header, `RetryInfo` mirrors a delay-seconds `Retry-After`,
 * `DebugInfo` carries the stack only when the handler includes it, and `Help`
 * links the documentation URL only when it is absolute. Validation bodies and
 * the SPEC 7.4 conformance run live in `format-google-api-validation.e2e.test.ts`;
 * the option matrix in `format-google-api-options.e2e.test.ts`.
 * @ref https://google.aip.dev/193#http11json-representation
 * @ref https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto
 */
import type {
  GoogleApiBody,
  GoogleApiDetail,
} from 'hono-ban/formats/google-api';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import {
  GOOGLE_API_CONTENT_TYPE,
  googleApi,
} from 'hono-ban/formats/google-api';

import { schemaErrors } from './support/ajv';
import { startServer } from './support/server';

const DOMAIN = 'orders.example.com';
const DOCS_BASE_URL = 'https://errors.example.com';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
/** @ref https://www.w3.org/TR/trace-context/#traceparent-header */
const TRACEPARENT = `00-${TRACE_ID}-00f067aa0ba902b7-01`;
const SCHEMA_CONTEXT = {
  docsBaseUrl: DOCS_BASE_URL,
  dialect: 'draft-2020-12',
} as const;
const ERROR_INFO = 'type.googleapis.com/google.rpc.ErrorInfo';
const REQUEST_INFO = 'type.googleapis.com/google.rpc.RequestInfo';
const RETRY_INFO = 'type.googleapis.com/google.rpc.RetryInfo';
const DEBUG_INFO = 'type.googleapis.com/google.rpc.DebugInfo';
const HELP = 'type.googleapis.com/google.rpc.Help';

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

async function readBody(response: Response): Promise<GoogleApiBody> {
  return (await response.json()) as GoogleApiBody;
}

function typesOf(details: ReadonlyArray<GoogleApiDetail>): Array<string> {
  return details.map((detail) => detail['@type']);
}

describe('googleApi() error bodies', () => {
  const ban = createBan({
    format: googleApi({ domain: DOMAIN }),
    docsBaseUrl: DOCS_BASE_URL,
    errors: { ORDER_CONFLICT: { status: 409, title: 'Order Conflict' } },
  });
  const app = new Hono();
  app.onError(ban.onError({ includeStack: true }));
  app.get('/orders/:id', (c) => {
    throw ban.notFound(`Order ${c.req.param('id')} does not exist`, {
      meta: { orderId: c.req.param('id'), attempts: 2, tags: ['a', 'b'] },
    });
  });
  app.get('/conflict', () => {
    throw ban.ORDER_CONFLICT('Already shipped', {
      headers: { 'Retry-After': '30' },
    });
  });
  app.get('/boom', () => {
    throw ban.internalServerError({ cause: new Error('root cause') });
  });
  app.get('/typed', () => {
    throw ban.gone({ type: 'https://docs.example.com/gone' });
  });
  app.get('/relative', () => {
    throw ban.gone({ type: '/errors/gone' });
  });
  const request = useServer(app);

  it('answers with application/json and the AIP-193 shape in member order', async () => {
    const response = await request('/orders/42');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe(GOOGLE_API_CONTENT_TYPE);
    expect(response.headers.get('content-type')).toBe('application/json');
    const body = await readBody(response);
    expect(Object.keys(body)).toEqual(['error']);
    expect(Object.keys(body.error)).toEqual([
      'code',
      'message',
      'status',
      'details',
    ]);
    expect(body).toEqual({
      error: {
        code: 404,
        message: 'Order 42 does not exist',
        status: 'NOT_FOUND',
        details: [
          {
            '@type': ERROR_INFO,
            reason: 'NOT_FOUND',
            domain: DOMAIN,
            // map<string, string>: every value is a string.
            metadata: { orderId: '42', attempts: '2', tags: '["a","b"]' },
          },
          {
            '@type': REQUEST_INFO,
            requestId: response.headers.get('x-error-id'),
          },
          {
            '@type': HELP,
            links: [
              {
                description: 'Documentation for NOT_FOUND errors',
                url: `${DOCS_BASE_URL}/NOT_FOUND`,
              },
            ],
          },
        ],
      },
    });
  });

  it('puts the trace id into ErrorInfo.metadata', async () => {
    const body = await readBody(
      await request('/orders/42', { headers: { traceparent: TRACEPARENT } }),
    );
    expect(body.error.details[0]).toMatchObject({
      '@type': ERROR_INFO,
      metadata: { traceId: TRACE_ID },
    });
  });

  it('derives status from the HTTP status for custom codes and adds RetryInfo from Retry-After', async () => {
    const response = await request('/conflict');
    expect(response.status).toBe(409);
    expect(response.headers.get('retry-after')).toBe('30');
    const body = await readBody(response);
    expect(body.error).toMatchObject({
      code: 409,
      message: 'Already shipped',
      status: 'ABORTED',
    });
    expect(typesOf(body.error.details)).toEqual([
      ERROR_INFO,
      RETRY_INFO,
      REQUEST_INFO,
      HELP,
    ]);
    expect(body.error.details[1]).toEqual({
      '@type': RETRY_INFO,
      retryDelay: '30s',
    });
  });

  it('carries the stack as DebugInfo on a 5xx when includeStack is on', async () => {
    const body = await readBody(await request('/boom'));
    expect(body.error).toMatchObject({
      code: 500,
      message: 'Internal Server Error',
      status: 'INTERNAL',
    });
    expect(typesOf(body.error.details)).toEqual([
      ERROR_INFO,
      REQUEST_INFO,
      DEBUG_INFO,
      HELP,
    ]);
    const debug = body.error.details[2];
    expect(debug).toMatchObject({ '@type': DEBUG_INFO });
    if (
      debug !== undefined &&
      '@type' in debug &&
      debug['@type'] === DEBUG_INFO
    ) {
      expect(debug.stackEntries[0]).toBe('Error: root cause');
      expect(debug.stackEntries.length).toBeGreaterThan(1);
    }
  });

  it('links an explicit absolute type and drops Help for a relative one', async () => {
    const typed = await readBody(await request('/typed'));
    expect(typed.error.details.at(-1)).toEqual({
      '@type': HELP,
      links: [
        {
          description: 'Documentation for GONE errors',
          url: 'https://docs.example.com/gone',
        },
      ],
    });
    const relative = await readBody(await request('/relative'));
    expect(typesOf(relative.error.details)).toEqual([ERROR_INFO, REQUEST_INFO]);
  });

  it('serves bodies that validate against the schema of their entry and no other', async () => {
    const body = await readBody(await request('/orders/42'));
    expect(
      schemaErrors(
        ban.format.schema(ban.catalog.NOT_FOUND, SCHEMA_CONTEXT),
        body,
      ),
    ).toEqual([]);
    expect(
      schemaErrors(ban.format.schema(ban.catalog.GONE, SCHEMA_CONTEXT), body),
    ).not.toEqual([]);
    // Closed at every level: an extra member anywhere is rejected.
    expect(
      schemaErrors(ban.format.schema(ban.catalog.NOT_FOUND, SCHEMA_CONTEXT), {
        error: { ...body.error, extra: true },
      }),
    ).not.toEqual([]);
    const conflict = await readBody(await request('/conflict'));
    expect(
      schemaErrors(
        ban.format.schema(ban.catalog.ORDER_CONFLICT, SCHEMA_CONTEXT),
        conflict,
      ),
    ).toEqual([]);
    const boom = await readBody(await request('/boom'));
    expect(
      schemaErrors(
        ban.format.schema(ban.catalog.INTERNAL_SERVER_ERROR, SCHEMA_CONTEXT),
        boom,
      ),
    ).toEqual([]);
  });
});
