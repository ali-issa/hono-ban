/**
 * Stripe-style error bodies over HTTP and format conformance (SPEC 7.7,
 * 7.7.1, 7.7.2, 7.4).
 *
 * A consumer configures `createBan({ format: stripe(...) })`, throws from a
 * Hono route, and a real Node HTTP server answers. This suite proves the
 * answer has the shape of Stripe's `api_errors` object: `application/json`,
 * one `error` object whose members appear in alphabetical order, `code` in
 * lower snake case, `type` classified by HTTP status the way Stripe's SDKs
 * do (402 `card_error`, other 4xx `invalid_request_error`, 5xx `api_error`)
 * or overridden per catalog code, `doc_url` derived from the docs base,
 * `request_log_url` from the option, a validation error reduced to its first
 * issue with `param` in bracket notation, and no member for meta, the id,
 * the trace id, or the stack. Every body validates against the schema the
 * format publishes for its entry.
 * @ref https://docs.stripe.com/api/errors
 * @ref https://github.com/stripe/stripe-node/blob/master/src/Error.ts (generateV1Error)
 */
import type { IssueLocation, ValidationIssue } from 'hono-ban';
import type { StripeBody } from 'hono-ban/formats/stripe';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { stripe, STRIPE_CONTENT_TYPE } from 'hono-ban/formats/stripe';
import { assertFormatConformance } from 'hono-ban/testing';

import { compileWithAjv, schemaErrors } from './support/ajv';
import { startServer } from './support/server';

const DOCS_BASE_URL = 'https://errors.example.com';
const LOG_BASE_URL = 'https://dashboard.example.com/logs';
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
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
  { path: ['page'], message: 'Expected number' },
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

async function readBody(response: Response): Promise<StripeBody> {
  return (await response.json()) as StripeBody;
}

describe('stripe() error bodies', () => {
  const ban = createBan({
    format: stripe({
      types: { KEY_REUSED: 'idempotency_error' },
      requestLogUrl: (error) => `${LOG_BASE_URL}/${error.id}`,
    }),
    docsBaseUrl: DOCS_BASE_URL,
    errors: { KEY_REUSED: { status: 400, title: 'Idempotency Key Reused' } },
  });
  const app = new Hono();
  app.onError(ban.onError({ includeStack: true }));
  app.get('/orders/:id', (c) => {
    throw ban.notFound(`No such order: '${c.req.param('id')}'`, {
      meta: { orderId: c.req.param('id') },
    });
  });
  app.get('/card', () => {
    throw ban.paymentRequired('Your card was declined.');
  });
  app.get('/reused', () => {
    throw ban.KEY_REUSED(
      'Keys for idempotent requests can only be used with the same parameters.',
    );
  });
  app.get('/boom', () => {
    throw new Error('secret database string');
  });
  const request = useServer(app);

  it('answers with application/json and Stripe members in alphabetical order', async () => {
    const response = await request('/orders/ord_42', {
      headers: { traceparent: TRACEPARENT },
    });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe(STRIPE_CONTENT_TYPE);
    expect(response.headers.get('content-type')).toBe('application/json');
    const id = response.headers.get('x-error-id');
    const text = await response.text();
    expect(text).toBe(
      `{"error":{"code":"not_found","doc_url":"${DOCS_BASE_URL}/NOT_FOUND","message":"No such order: 'ord_42'","request_log_url":"${LOG_BASE_URL}/${String(id)}","type":"invalid_request_error"}}`,
    );
    // Nothing that is not a Stripe member leaks: no meta, id, or trace id.
    expect(text).not.toContain('orderId');
    expect(text).not.toContain('4bf92f35');
  });

  it('classifies 402 as card_error and applies the types override', async () => {
    const card = await readBody(await request('/card'));
    expect(card.error).toMatchObject({
      code: 'payment_required',
      message: 'Your card was declined.',
      type: 'card_error',
    });
    const reused = await request('/reused');
    expect(reused.status).toBe(400);
    expect((await readBody(reused)).error).toMatchObject({
      code: 'key_reused',
      type: 'idempotency_error',
    });
  });

  it('answers an unknown Error as api_error with the constant detail and no stack', async () => {
    const response = await request('/boom');
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('secret');
    expect(text).not.toContain('at ');
    expect(JSON.parse(text)).toEqual({
      error: {
        code: 'internal_server_error',
        doc_url: `${DOCS_BASE_URL}/INTERNAL_SERVER_ERROR`,
        message: 'An unexpected error occurred',
        request_log_url: `${LOG_BASE_URL}/${String(response.headers.get('x-error-id'))}`,
        type: 'api_error',
      },
    });
  });

  it('serves bodies that validate against the schema of their entry and no other', async () => {
    const body = await readBody(await request('/orders/ord_42'));
    expect(
      schemaErrors(
        ban.format.schema(ban.catalog.NOT_FOUND, SCHEMA_CONTEXT),
        body,
      ),
    ).toEqual([]);
    expect(
      schemaErrors(ban.format.schema(ban.catalog.GONE, SCHEMA_CONTEXT), body),
    ).not.toEqual([]);
    expect(
      schemaErrors(ban.format.schema(ban.catalog.NOT_FOUND, SCHEMA_CONTEXT), {
        error: { ...body.error, param: 'x' },
      }),
    ).not.toEqual([]);
    const card = await readBody(await request('/card'));
    expect(
      schemaErrors(
        ban.format.schema(ban.catalog.PAYMENT_REQUIRED, SCHEMA_CONTEXT),
        card,
      ),
    ).toEqual([]);
  });
});

describe('stripe() validation bodies', () => {
  const ban = createBan({ format: stripe() });
  const app = new Hono();
  app.onError(ban.onError());
  for (const location of LOCATIONS) {
    app.get(`/validate/${location}`, () => {
      throw ban.validation(ISSUES, { location, detail: 'Order is invalid' });
    });
  }
  app.get('/empty', () => {
    throw ban.validation([], { location: 'body' });
  });
  const request = useServer(app);

  it.each(LOCATIONS)(
    'renders the first issue as message and param for %s',
    async (location) => {
      const response = await request(`/validate/${location}`);
      expect(response.status).toBe(422);
      const body = await readBody(response);
      // Stripe reports one problem per response; the second issue is dropped.
      expect(body).toEqual({
        error: {
          code: 'validation_failed',
          message: 'Required',
          param: 'items[0][sku]',
          type: 'invalid_request_error',
        },
      });
      expect(
        schemaErrors(
          ban.format.validationSchema(
            ban.catalog.VALIDATION_FAILED,
            SCHEMA_CONTEXT,
          ),
          body,
        ),
      ).toEqual([]);
    },
  );

  it('falls back to the shared validation detail without issues', async () => {
    const body = await readBody(await request('/empty'));
    expect(body).toEqual({
      error: {
        code: 'validation_failed',
        message: 'Request validation failed',
        type: 'invalid_request_error',
      },
    });
  });
});

describe('stripe() conformance (SPEC 7.4)', () => {
  const ban = createBan({
    format: stripe(),
    docsBaseUrl: DOCS_BASE_URL,
    errors: { ORDER_CONFLICT: { status: 409 } },
  });

  it.each([
    { name: 'defaults', format: stripe() },
    {
      name: 'every option set',
      format: stripe({
        docUrlBaseUrl: 'https://docs.example.com/errors',
        types: {
          ORDER_CONFLICT: 'idempotency_error',
          PAYMENT_REQUIRED: 'invalid_request_error',
        },
        requestLogUrl: (error) => `${LOG_BASE_URL}/${error.id}`,
      }),
    },
  ])('passes assertFormatConformance with $name', ({ format }) => {
    expect(() => {
      assertFormatConformance(format, ban.catalog, {
        compile: compileWithAjv,
        docsBaseUrl: DOCS_BASE_URL,
      });
    }).not.toThrow();
  });

  it('spells constants as enum for OpenAPI 3.0', () => {
    const legacy = JSON.stringify(
      stripe().schema(ban.catalog.NOT_FOUND, {
        docsBaseUrl: undefined,
        dialect: 'openapi-3.0',
      }),
    );
    expect(legacy).toContain('"code":{"enum":["not_found"]}');
    expect(legacy).toContain('"type":{"enum":["invalid_request_error"]}');
    expect(legacy).not.toContain('"const"');
  });
});
