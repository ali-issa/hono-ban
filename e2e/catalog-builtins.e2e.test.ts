import type { FactoryName } from 'hono-ban';

import type { RunningServer } from './support/server';

import { request as httpRequest } from 'node:http';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILTIN_CATALOG, createBan, FACTORY_NAMES } from 'hono-ban';

import { startServer } from './support/server';

/**
 * Built-in catalog and factories, exercised through the built package over
 * real HTTP (SPEC 3, 5.1, 5.2). Proves that every factory name renders its
 * catalog entry's status, title, and code, aliases included, with
 * `about:blank` as the type when no `docsBaseUrl` is set; that the three
 * factory call forms carry detail, meta, and headers to the wire; that options
 * override the definition fields SPEC 5.2 lists; and that a factory rejects a
 * wrong first argument with `TypeError` while never throwing for valid input.
 * The companion `catalog-custom` suite covers SPEC 2, 5.3, and 5.4.
 */

const PROBLEM_JSON = 'application/problem+json';
/** `crypto.randomUUID()` output, the default error id (SPEC 4). */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PROXY_AUTH_REQUIRED = 407;

interface Problem {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly errorId: string | undefined;
  readonly body: Record<string, unknown>;
}

function isFactoryName(name: string): name is FactoryName {
  return Object.hasOwn(FACTORY_NAMES, name);
}

async function viaFetch(server: RunningServer, path: string): Promise<Problem> {
  const res = await server.fetch(path);
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? undefined,
    errorId: res.headers.get('x-error-id') ?? undefined,
    body: await res.json(),
  };
}

/**
 * WHATWG fetch turns a 407 response into a network error when there is no
 * browser window, so undici rejects with "fetch failed" before the test can
 * see the status. A raw request reads the response as it is on the wire.
 * @ref https://fetch.spec.whatwg.org/#http-network-or-cache-fetch
 */
async function viaHttp(server: RunningServer, path: string): Promise<Problem> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${server.url}${path}`, (res) => {
      const chunks: Array<Buffer> = [];
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        const errorId = res.headers['x-error-id'];
        resolve({
          status: res.statusCode ?? 0,
          contentType: res.headers['content-type'],
          errorId: typeof errorId === 'string' ? errorId : undefined,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('built-in catalog over HTTP (SPEC 3)', () => {
  const ban = createBan();
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/errors/:name', (c) => {
    const name = c.req.param('name');
    if (!isFactoryName(name)) {
      throw ban.badRequest(`Unknown factory ${name}`);
    }
    throw ban[name]();
  });
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it.each(Object.entries(FACTORY_NAMES))(
    'ban.%s() renders the %s entry',
    async (name, key) => {
      const definition = BUILTIN_CATALOG[key];
      const path = `/errors/${name}`;
      const res =
        definition.status === PROXY_AUTH_REQUIRED
          ? await viaHttp(server, path)
          : await viaFetch(server, path);
      expect(res.status).toBe(definition.status);
      expect(res.contentType).toBe(PROBLEM_JSON);
      // Without docsBaseUrl the type is about:blank, in which case the title
      // must be the reason phrase; the catalog titles are the IANA phrases.
      // @ref https://www.rfc-editor.org/rfc/rfc9457#section-4.2.1
      expect(res.body).toEqual({
        type: 'about:blank',
        status: definition.status,
        title: definition.title,
        instance: path,
        code: key,
        id: expect.stringMatching(UUID_PATTERN),
      });
      expect(res.errorId).toBe(res.body['id']);
    },
  );

  it.each([
    ['payloadTooLarge', 'contentTooLarge'],
    ['unprocessableEntity', 'unprocessableContent'],
  ])('alias %s renders the same entry as %s', async (alias, primary) => {
    const aliasRes = await viaFetch(server, `/errors/${alias}`);
    const primaryRes = await viaFetch(server, `/errors/${primary}`);
    expect(aliasRes.status).toBe(primaryRes.status);
    expect(aliasRes.body['code']).toBe(primaryRes.body['code']);
    expect(aliasRes.body['title']).toBe(primaryRes.body['title']);
  });
});

describe('factory call forms (SPEC 5.1, 5.2)', () => {
  const ban = createBan();
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/detail', () => {
    throw ban.notFound('Order 42 does not exist');
  });
  app.get('/detail-options', () => {
    throw ban.conflict('Already shipped', {
      meta: { orderId: 42 },
      headers: { 'Retry-After': '30' },
    });
  });
  app.get('/options', () => {
    throw ban.tooManyRequests({
      detail: 'Slow down',
      meta: { limit: 100 },
      headers: { 'Retry-After': '60', 'X-RateLimit-Limit': '100' },
    });
  });
  app.get('/detail-wins', () => {
    throw ban.badRequest('from argument', { detail: 'from options' });
  });
  app.get('/overrides', () => {
    throw ban.conflict({
      type: 'https://example.com/taken',
      instance: '/orders/1',
      id: 'fixed-id',
    });
  });
  app.get('/empty', () => {
    throw ban.badRequest({});
  });
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it('(detail) sets detail and the request path as instance', async () => {
    const res = await server.fetch('/detail');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      detail: 'Order 42 does not exist',
      instance: '/detail',
      code: 'NOT_FOUND',
    });
  });

  it('(detail, options) carries headers and meta to the wire', async () => {
    const res = await server.fetch('/detail-options');
    expect(res.status).toBe(409);
    expect(res.headers.get('retry-after')).toBe('30');
    // meta keys become top-level extension members.
    // @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.2
    expect(await res.json()).toMatchObject({
      detail: 'Already shipped',
      orderId: 42,
    });
  });

  it('(options) accepts detail, meta and headers together', async () => {
    const res = await server.fetch('/options');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('x-ratelimit-limit')).toBe('100');
    expect(await res.json()).toMatchObject({ detail: 'Slow down', limit: 100 });
  });

  it('the detail argument wins over options.detail', async () => {
    const body = await (await server.fetch('/detail-wins')).json();
    expect(body.detail).toBe('from argument');
  });

  it('options override type, instance and id; status, code and title stay the catalog values', async () => {
    // code and title are pinned by the generated schema (ADR 0011).
    const res = await server.fetch('/overrides');
    expect(res.status).toBe(409);
    expect(res.headers.get('x-error-id')).toBe('fixed-id');
    expect(await res.json()).toMatchObject({
      code: 'CONFLICT',
      title: 'Conflict',
      type: 'https://example.com/taken',
      instance: '/orders/1',
      id: 'fixed-id',
    });
  });

  it('an empty options object renders the bare entry', async () => {
    const res = await server.fetch('/empty');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.title).toBe('Bad Request');
    expect(body).not.toHaveProperty('detail');
  });
});

describe('factory argument guards, in-process (SPEC 5.1, 5.2)', () => {
  const ban = createBan();

  it.each([42, null, true])(
    'a factory throws TypeError for a %p first argument',
    (first) => {
      const loose = ban.notFound as (first: unknown) => unknown;
      expect(() => loose(first)).toThrow(TypeError);
    },
  );

  it('factories never throw for valid input', () => {
    expect(() => ban.internalServerError()).not.toThrow();
    expect(() => ban.badRequest({})).not.toThrow();
    expect(() => ban.badRequest('x', {})).not.toThrow();
  });
});
