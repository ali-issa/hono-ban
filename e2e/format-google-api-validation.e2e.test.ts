/**
 * AIP-193 validation bodies over HTTP and format conformance (SPEC 7.6.2,
 * 7.6.3, 7.4, 8.2).
 *
 * `ban.validation(issues, { location })` thrown from a Hono route reaches the
 * client as a 422 whose `details` carry one `google.rpc.BadRequest` with a
 * `fieldViolations` entry per issue: `field` in the proto path syntax
 * (`items[0].sku`), `description` from the issue message, `reason` from the
 * issue code in UPPER_SNAKE_CASE, and the location in `ErrorInfo.metadata`.
 * The suite also proves every validation body validates against
 * `validationSchema` and not against `schema`, and runs
 * `assertFormatConformance` over the whole catalog in both dialects' shapes.
 * @ref https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto (BadRequest)
 * @ref https://google.aip.dev/193#status-details
 */
import type { IssueLocation, ValidationIssue } from 'hono-ban';
import type { GoogleApiBody } from 'hono-ban/formats/google-api';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { googleApi } from 'hono-ban/formats/google-api';
import { assertFormatConformance } from 'hono-ban/testing';

import { compileWithAjv, schemaErrors } from './support/ajv';
import { startServer } from './support/server';

const DOMAIN = 'orders.example.com';
const DOCS_BASE_URL = 'https://errors.example.com';
const UNPROCESSABLE = 422;
const SCHEMA_CONTEXT = {
  docsBaseUrl: DOCS_BASE_URL,
  dialect: 'draft-2020-12',
} as const;
const LOCATIONS: ReadonlyArray<IssueLocation> = [
  'body',
  'form',
  'query',
  'param',
  'header',
  'cookie',
];
const ISSUES: ReadonlyArray<ValidationIssue> = [
  { path: ['items', 0, 'sku'], message: 'Required', code: 'invalid_type' },
  {
    path: ['page'],
    message: 'Expected number',
    expected: 'number',
    received: 'string',
  },
  { path: [], message: 'Unrecognized keys' },
];

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

describe('googleApi() validation bodies', () => {
  const ban = createBan({
    format: googleApi({ domain: DOMAIN }),
    docsBaseUrl: DOCS_BASE_URL,
  });
  const app = new Hono();
  app.onError(ban.onError());
  for (const location of LOCATIONS) {
    app.get(`/validate/${location}`, () => {
      throw ban.validation(ISSUES, {
        location,
        detail: 'Order is invalid',
        meta: { orderId: 7 },
      });
    });
  }
  app.get('/default-detail', () => {
    throw ban.validation(ISSUES.slice(0, 1), { location: 'body' });
  });
  const request = useServer(app);

  it.each(LOCATIONS)(
    'renders one BadRequest with a violation per issue for %s',
    async (location) => {
      const response = await request(`/validate/${location}`);
      expect(response.status).toBe(UNPROCESSABLE);
      const body = await readBody(response);
      expect(body).toEqual({
        error: {
          code: 422,
          message: 'Order is invalid',
          status: 'FAILED_PRECONDITION',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: 'VALIDATION_FAILED',
              domain: DOMAIN,
              metadata: { orderId: '7', location },
            },
            {
              '@type': 'type.googleapis.com/google.rpc.BadRequest',
              fieldViolations: [
                {
                  field: 'items[0].sku',
                  description: 'Required',
                  reason: 'INVALID_TYPE',
                },
                { field: 'page', description: 'Expected number' },
                { description: 'Unrecognized keys' },
              ],
            },
            {
              '@type': 'type.googleapis.com/google.rpc.RequestInfo',
              requestId: response.headers.get('x-error-id'),
            },
            {
              '@type': 'type.googleapis.com/google.rpc.Help',
              links: [
                {
                  description: 'Documentation for VALIDATION_FAILED errors',
                  url: `${DOCS_BASE_URL}/VALIDATION_FAILED`,
                },
              ],
            },
          ],
        },
      });
    },
  );

  it('uses the shared validation detail as message when none is given', async () => {
    const body = await readBody(await request('/default-detail'));
    expect(body.error.message).toBe('Request validation failed');
  });

  it('validates against validationSchema for every location and never against schema', async () => {
    const validation = compileWithAjv(
      ban.format.validationSchema(
        ban.catalog.VALIDATION_FAILED,
        SCHEMA_CONTEXT,
      ),
    );
    const plain = ban.format.schema(
      ban.catalog.VALIDATION_FAILED,
      SCHEMA_CONTEXT,
    );
    for (const location of LOCATIONS) {
      const body = await readBody(await request(`/validate/${location}`));
      expect(validation(body), location).toEqual([]);
      // SPEC 7.6.3: BadRequest is a payload only the validation schema admits.
      expect(schemaErrors(plain, body), location).not.toEqual([]);
    }
  });
});

describe('googleApi() conformance (SPEC 7.4)', () => {
  const ban = createBan({
    format: googleApi({ domain: DOMAIN }),
    docsBaseUrl: DOCS_BASE_URL,
    errors: { ORDER_CONFLICT: { status: 409 }, TEAPOT: { status: 418 } },
  });

  it.each([
    { name: 'defaults', format: googleApi({ domain: DOMAIN }) },
    {
      name: 'every option set',
      format: googleApi({
        domain: DOMAIN,
        rpcCodes: { ORDER_CONFLICT: 'ALREADY_EXISTS', TEAPOT: 'UNKNOWN' },
        helpLinkBaseUrl: 'https://help.example.com',
        traceIdMetadataKey: 'trace',
        includeRequestInfo: false,
      }),
    },
    {
      name: 'no trace id',
      format: googleApi({ domain: DOMAIN, traceIdMetadataKey: false }),
    },
  ])('passes assertFormatConformance with $name', ({ format }) => {
    expect(() => {
      assertFormatConformance(format, ban.catalog, {
        compile: compileWithAjv,
        docsBaseUrl: DOCS_BASE_URL,
      });
    }).not.toThrow();
  });

  it('spells constants as enum for OpenAPI 3.0 and const for 2020-12', () => {
    const format = googleApi({ domain: DOMAIN });
    const modern = JSON.stringify(
      format.schema(ban.catalog.NOT_FOUND, SCHEMA_CONTEXT),
    );
    const legacy = JSON.stringify(
      format.schema(ban.catalog.NOT_FOUND, {
        docsBaseUrl: DOCS_BASE_URL,
        dialect: 'openapi-3.0',
      }),
    );
    expect(modern).toContain('"status":{"const":"NOT_FOUND"}');
    expect(legacy).toContain('"status":{"enum":["NOT_FOUND"]}');
    expect(legacy).not.toContain('"const"');
    expect(legacy).not.toContain('prefixItems');
    expect(legacy).not.toContain('contains');
  });
});
