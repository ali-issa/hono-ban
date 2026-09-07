import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assert, createBan } from 'hono-ban';

import { startServer } from './support/server';

/**
 * Custom catalogs, `ban.error`, `ban.custom`, and `assert`, exercised through
 * the built package over real HTTP (SPEC 2, 5.3, 5.4). Proves that custom
 * entries get their defaults (title from the reason phrase, code from the key,
 * type from `docsBaseUrl`), that a custom key can replace a built-in while its
 * camelCase factory keeps working, that `ban.error` is the generic factory and
 * `ban.custom` builds catalog-less errors with `CUSTOM` as code, and that the
 * standalone `assert` narrows on the happy path and throws the produced error
 * for `null`, `undefined`, and `false` only. The constructor's `TypeError` /
 * `RangeError` guarantees run in-process because they never reach a request.
 * The companion `catalog-builtins` suite covers SPEC 3, 5.1, and 5.2.
 */

const PROBLEM_JSON = 'application/problem+json';
const DOCS = 'https://errors.example.com';

describe('custom catalog, ban.error and ban.custom (SPEC 2, 5.3)', () => {
  const ban = createBan({
    docsBaseUrl: DOCS,
    errors: {
      ORDER_CONFLICT: {
        status: 409,
        title: 'Order Conflict',
        description: 'The order changed underneath you',
      },
      RESOURCE_LOCKED: { status: 423 },
      QUOTA_EXCEEDED: {
        status: 429,
        code: 'quota_exceeded',
        type: 'https://example.com/quota',
      },
      NOT_FOUND: { status: 404, title: 'Nope', code: 'nope' },
    },
  });
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/order-conflict', () => {
    throw ban.ORDER_CONFLICT('Already shipped');
  });
  app.get('/locked', () => {
    throw ban.RESOURCE_LOCKED();
  });
  app.get('/quota', () => {
    throw ban.QUOTA_EXCEEDED();
  });
  app.get('/overridden', () => {
    throw ban.notFound();
  });
  app.get('/error/builtin', () => {
    throw ban.error('FORBIDDEN', {
      detail: 'No access',
      headers: { 'WWW-Authenticate': 'Bearer' },
    });
  });
  app.get('/error/custom', () => {
    throw ban.error('ORDER_CONFLICT', { meta: { orderId: 7 } });
  });
  app.get('/custom/standard', () => {
    throw ban.custom({ status: 410, detail: 'Removed' });
  });
  // ContentfulStatusCode covers official statuses only; 499 needs the cast (SPEC 2).
  app.get('/custom/499', () => {
    throw ban.custom({
      status: 499 as ContentfulStatusCode,
      title: 'Client Closed Request',
      code: 'CLIENT_CLOSED',
    });
  });
  app.get('/custom/499-defaults', () => {
    throw ban.custom({ status: 499 as ContentfulStatusCode });
  });
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it('resolves catalog defaults: reason phrase title, key as code, no baked type', () => {
    expect(ban.docsBaseUrl).toBe(DOCS);
    // The catalog holds only explicit type URIs; formats derive the wire
    // `type` from docsBaseUrl at render time (ADR 0010).
    expect(ban.catalog.RESOURCE_LOCKED).toEqual({
      key: 'RESOURCE_LOCKED',
      status: 423,
      title: 'Locked',
      code: 'RESOURCE_LOCKED',
      type: undefined,
      description: 'Locked',
    });
    expect(ban.catalog.ORDER_CONFLICT.description).toBe(
      'The order changed underneath you',
    );
    expect(ban.catalog.NOT_FOUND.title).toBe('Nope');
  });

  it.each([
    [
      '/order-conflict',
      409,
      'Order Conflict',
      'ORDER_CONFLICT',
      `${DOCS}/ORDER_CONFLICT`,
    ],
    ['/locked', 423, 'Locked', 'RESOURCE_LOCKED', `${DOCS}/RESOURCE_LOCKED`],
    [
      '/quota',
      429,
      'Too Many Requests',
      'quota_exceeded',
      'https://example.com/quota',
    ],
    ['/overridden', 404, 'Nope', 'nope', `${DOCS}/nope`],
  ])('GET %s renders %i %s', async (path, status, title, code, type) => {
    const res = await server.fetch(path);
    expect(res.status).toBe(status);
    expect(res.headers.get('content-type')).toBe(PROBLEM_JSON);
    expect(await res.json()).toMatchObject({ status, title, code, type });
  });

  it('ban.error builds a built-in entry with options', async () => {
    const res = await server.fetch('/error/builtin');
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect(await res.json()).toMatchObject({
      title: 'Forbidden',
      code: 'FORBIDDEN',
      detail: 'No access',
      type: `${DOCS}/FORBIDDEN`,
    });
  });

  it('ban.error builds a custom entry with options', async () => {
    const res = await server.fetch('/error/custom');
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'ORDER_CONFLICT',
      orderId: 7,
    });
  });

  it.each([
    ['/custom/standard', 410, 'Gone', 'CUSTOM', 'Removed'],
    ['/custom/499', 499, 'Client Closed Request', 'CLIENT_CLOSED', undefined],
    ['/custom/499-defaults', 499, 'Error', 'CUSTOM', undefined],
  ])(
    'ban.custom at %s renders %i %s',
    async (path, status, title, code, detail) => {
      const res = await server.fetch(path);
      expect(res.status).toBe(status);
      const body = await res.json();
      // A catalog-less error still gets `${docsBaseUrl}/${code}` as type (SPEC 7.1.1).
      expect(body).toMatchObject({
        status,
        title,
        code,
        type: `${DOCS}/${code}`,
      });
      if (detail === undefined) {
        expect(body).not.toHaveProperty('detail');
      } else {
        expect(body.detail).toBe(detail);
      }
    },
  );
});

describe('assert (SPEC 5.4)', () => {
  const ban = createBan();
  const records = new Map<string, { id: string; name: string }>([
    ['1', { id: '1', name: 'Ada' }],
  ]);
  const samples: Readonly<Record<string, unknown>> = {
    zero: 0,
    empty: '',
    false: false,
    null: null,
  };
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/records/:id', (c) => {
    const id = c.req.param('id');
    const record = records.get(id);
    assert(record, () => ban.notFound(`Record ${id} does not exist`));
    // `record` is narrowed to the value type here; `.name` compiles.
    return c.json({ name: record.name });
  });
  app.get('/samples/:kind', (c) => {
    const value = samples[c.req.param('kind')];
    assert(value, () => ban.forbidden('Value is absent'));
    return c.json({ value });
  });
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it('passes a present record through narrowed', async () => {
    const res = await server.fetch('/records/1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'Ada' });
  });

  it('throws the produced error for a missing record', async () => {
    const res = await server.fetch('/records/2');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe(PROBLEM_JSON);
    expect(await res.json()).toMatchObject({
      code: 'NOT_FOUND',
      detail: 'Record 2 does not exist',
      instance: '/records/2',
    });
  });

  it.each([
    ['zero', 200, 0],
    ['empty', 200, ''],
    ['false', 403, undefined],
    ['null', 403, undefined],
    ['missing', 403, undefined],
  ])('sample %s yields %i', async (kind, status, value) => {
    const res = await server.fetch(`/samples/${kind}`);
    expect(res.status).toBe(status);
    const body = await res.json();
    if (value === undefined) {
      expect(body).toMatchObject({
        code: 'FORBIDDEN',
        detail: 'Value is absent',
      });
    } else {
      expect(body).toEqual({ value });
    }
  });
});

describe('constructor guards, in-process (SPEC 2, 5.3)', () => {
  it.each(['onError', 'catalog', 'render', 'notFound', 'payloadTooLarge'])(
    'rejects the reserved key %s with TypeError',
    (key) => {
      expect(() =>
        createBan({ errors: { [key]: { status: 400 } } as never }),
      ).toThrow(TypeError);
    },
  );

  it('rejects an unknown validationKey with RangeError', () => {
    expect(() => createBan({ validationKey: 'NOPE' as never })).toThrow(
      RangeError,
    );
  });

  it('ban.error throws RangeError for an unknown key', () => {
    expect(() => createBan().error('NOPE' as never)).toThrow(RangeError);
  });
});
