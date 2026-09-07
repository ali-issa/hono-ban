/**
 * `googleApi()` options over HTTP (SPEC 7.6): `rpcCodes` overriding the
 * status derivation, `helpLinkBaseUrl` winning over `docsBaseUrl`, a renamed
 * trace id key in `ErrorInfo.metadata`, and `includeRequestInfo: false`
 * leaving the error id to the `X-Error-Id` header alone.
 * @ref https://google.aip.dev/193#errorinfo
 */
import type { GoogleApiBody } from 'hono-ban/formats/google-api';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { googleApi } from 'hono-ban/formats/google-api';

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

describe('googleApi() options', () => {
  const ban = createBan({
    format: googleApi({
      domain: DOMAIN,
      rpcCodes: { SKU_TAKEN: 'ALREADY_EXISTS' },
      helpLinkBaseUrl: 'https://help.example.com',
      traceIdMetadataKey: 'trace',
      includeRequestInfo: false,
    }),
    docsBaseUrl: DOCS_BASE_URL,
    errors: { SKU_TAKEN: { status: 409, title: 'SKU Taken' } },
  });
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/taken', () => {
    throw ban.SKU_TAKEN('SKU A-1 is taken');
  });
  const request = useServer(app);

  it('applies rpcCodes, helpLinkBaseUrl, the trace key, and includeRequestInfo', async () => {
    const response = await request('/taken', {
      headers: { traceparent: TRACEPARENT },
    });
    const body = await readBody(response);
    expect(body).toEqual({
      error: {
        code: 409,
        message: 'SKU A-1 is taken',
        status: 'ALREADY_EXISTS',
        details: [
          {
            '@type': ERROR_INFO,
            reason: 'SKU_TAKEN',
            domain: DOMAIN,
            metadata: { trace: TRACE_ID },
          },
          {
            '@type': HELP,
            links: [
              {
                description: 'Documentation for SKU_TAKEN errors',
                url: 'https://help.example.com/SKU_TAKEN',
              },
            ],
          },
        ],
      },
    });
    // The id still travels in the header even when RequestInfo is off.
    expect(response.headers.get('x-error-id')).toMatch(/^[0-9a-f-]{36}$/u);
    expect(
      schemaErrors(
        ban.format.schema(ban.catalog.SKU_TAKEN, SCHEMA_CONTEXT),
        body,
      ),
    ).toEqual([]);
  });
});
