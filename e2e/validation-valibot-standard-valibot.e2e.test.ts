/**
 * Valibot validation over HTTP (SPEC 8.1, 8.3, 8.4, 8.6; 7.1.3 and 7.2.2 for
 * the rendered entries).
 *
 * Proves that `hook(ban)` from `hono-ban/valibot` turns a `vValidator`
 * failure into a 422 with one entry per issue (pointer for `json`, name for
 * `query` and `header`), that `fromValibotIssues` and `toIssues` called from
 * a route produce the same body as the hook, and that the hook is format
 * independent: the same failure renders through JSON:API with
 * `source.pointer` per issue.
 */
import type { RunningServer } from './support/server';

import { vValidator } from '@hono/valibot-validator';
import { Hono } from 'hono';
import * as v from 'valibot';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { jsonApi } from 'hono-ban/formats/json-api';
import { fromValibotIssues, hook, toIssues } from 'hono-ban/valibot';

import { startServer } from './support/server';

/** One Problem Details `errors[]` entry for a `body` issue (SPEC 7.1.3). */
interface Entry {
  readonly location: 'body';
  readonly pointer: string;
  readonly detail: string;
  readonly code: string;
  readonly expected?: string;
  readonly received: string;
}

const orderSchema = v.object({
  email: v.pipe(v.string(), v.email()),
  items: v.array(
    v.object({ sku: v.string(), qty: v.pipe(v.number(), v.minValue(1)) }),
  ),
  shipping: v.object({ zip: v.string() }),
});
const pageSchema = v.object({ page: v.pipe(v.string(), v.digits()) });
const apiKeySchema = v.object({
  'x-api-key': v.pipe(v.string(), v.minLength(8)),
});
const badOrder = { email: 'nope', items: [{ sku: 1, qty: 0 }], shipping: {} };
const goodOrder = {
  email: 'a@b.co',
  items: [{ sku: 'A', qty: 1 }],
  shipping: { zip: '10001' },
};

/**
 * Expected entries for `badOrder`, in Valibot's issue order. Per SPEC 8.6 the
 * issue `type` becomes `code`, `expected` is omitted when Valibot reports
 * `null` (the `email` action), and `path[].key` builds the pointer.
 * @ref https://valibot.dev/api/BaseIssue/
 */
const BAD_ORDER_ENTRIES: ReadonlyArray<Entry> = [
  {
    location: 'body',
    pointer: '/email',
    detail: 'Invalid email: Received "nope"',
    code: 'email',
    received: '"nope"',
  },
  {
    location: 'body',
    pointer: '/items/0/sku',
    detail: 'Invalid type: Expected string but received 1',
    code: 'string',
    expected: 'string',
    received: '1',
  },
  {
    location: 'body',
    pointer: '/items/0/qty',
    detail: 'Invalid value: Expected >=1 but received 0',
    code: 'min_value',
    expected: '>=1',
    received: '0',
  },
  {
    location: 'body',
    pointer: '/shipping/zip',
    detail: 'Invalid key: Expected "zip" but received undefined',
    code: 'object',
    expected: '"zip"',
    received: 'undefined',
  },
];

const PAGE_ENTRY = {
  location: 'query',
  name: 'page',
  detail: 'Invalid digits: Received "x"',
  code: 'digits',
  received: '"x"',
};

async function postJson(
  server: RunningServer,
  path: string,
  payload: unknown,
): Promise<Response> {
  return server.fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Handler reached only when the validator accepted the request. */
const ok = (): Response => Response.json({ ok: true });

describe('hono-ban/valibot hook with vValidator', () => {
  const ban = createBan();
  const app = new Hono();
  app.onError(ban.onError());
  app.post('/orders', vValidator('json', orderSchema, hook(ban)), ok);
  app.get('/search', vValidator('query', pageSchema, hook(ban)), ok);
  app.get('/secure', vValidator('header', apiKeySchema, hook(ban)), ok);
  app.post('/orders/from-issues', async (c) => {
    const result = v.safeParse(orderSchema, await c.req.json());
    throw fromValibotIssues(ban, result.issues ?? [], 'body');
  });
  app.post('/orders/to-issues', async (c) => {
    const result = v.safeParse(orderSchema, await c.req.json());
    throw ban.validation(toIssues(result.issues ?? []), { location: 'body' });
  });
  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it('lets valid input through to the handler', async () => {
    const res = await postJson(server, '/orders', goodOrder);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('renders one entry per issue with pointers from nested and array keys', async () => {
    const res = await postJson(server, '/orders', badOrder);
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = await res.json();
    expect(body).toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      title: 'Validation Failed',
      detail: 'Request validation failed',
      location: 'body',
      instance: '/orders',
    });
    expect(res.headers.get('x-error-id')).toBe(body.id);
    expect(body.errors).toStrictEqual(BAD_ORDER_ENTRIES);
  });

  it('names query parameters instead of pointing into them', async () => {
    const res = await server.fetch('/search?page=x');
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      location: 'query',
      errors: [PAGE_ENTRY],
    });
    expect((await server.fetch('/search?page=2')).status).toBe(200);
  });

  // Hono hands the validator every request header keyed in lowercase, so the
  // schema key and the reported name are the lowercase header name.
  // @ref https://hono.dev/docs/api/request#header
  it.each([
    {
      given: 'a missing header',
      headers: {},
      detail: 'Invalid key: Expected "x-api-key" but received undefined',
      code: 'object',
      expected: '"x-api-key"',
      received: 'undefined',
    },
    {
      given: 'a short header',
      headers: { 'x-api-key': 'abc' },
      detail: 'Invalid length: Expected >=8 but received 3',
      code: 'min_length',
      expected: '>=8',
      received: '3',
    },
  ])(
    'names the header for $given',
    async ({ given: _given, headers, ...entry }) => {
      const res = await server.fetch('/secure', { headers });
      expect(res.status).toBe(422);
      await expect(res.json()).resolves.toMatchObject({
        location: 'header',
        errors: [{ location: 'header', name: 'x-api-key', ...entry }],
      });
    },
  );

  it('accepts a header that satisfies the schema', async () => {
    const res = await server.fetch('/secure', {
      headers: { 'x-api-key': 'long-enough-key' },
    });
    expect(res.status).toBe(200);
  });

  it.each(['/orders/from-issues', '/orders/to-issues'])(
    '%s from a route produces the hook body',
    async (path) => {
      const res = await postJson(server, path, badOrder);
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body).toMatchObject({
        code: 'VALIDATION_FAILED',
        detail: 'Request validation failed',
        location: 'body',
      });
      expect(body.errors).toStrictEqual(BAD_ORDER_ENTRIES);
    },
  );
});

describe('the same Valibot failure through JSON:API', () => {
  const ban = createBan({ format: jsonApi() });
  const app = new Hono();
  app.onError(ban.onError());
  app.post('/orders', vValidator('json', orderSchema, hook(ban)), ok);
  app.get('/search', vValidator('query', pageSchema, hook(ban)), ok);
  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  // One error object per issue sharing id, status, code, and title;
  // `source.pointer` addresses the body member (SPEC 7.2.2).
  // @ref https://jsonapi.org/format/#error-objects
  it('renders one error object per issue with source.pointer', async () => {
    const res = await postJson(server, '/orders', badOrder);
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toBe('application/vnd.api+json');
    const body = await res.json();
    const id = res.headers.get('x-error-id');
    expect(id).not.toBeNull();
    expect(body.errors).toStrictEqual(
      BAD_ORDER_ENTRIES.map((entry) => ({
        id,
        status: '422',
        code: 'VALIDATION_FAILED',
        title: 'Validation Failed',
        detail: entry.detail,
        source: { pointer: entry.pointer },
        meta: {
          location: 'body',
          code: entry.code,
          ...(entry.expected === undefined ? {} : { expected: entry.expected }),
          received: entry.received,
        },
      })),
    );
  });

  it('addresses query parameters with source.parameter', async () => {
    const res = await server.fetch('/search?page=x');
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      errors: [
        {
          status: '422',
          detail: PAGE_ENTRY.detail,
          source: { parameter: 'page' },
          meta: { location: 'query', code: 'digits', received: '"x"' },
        },
      ],
    });
  });
});
