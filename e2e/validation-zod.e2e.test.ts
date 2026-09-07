import type { Context } from 'hono';

import type { RunningServer } from './support/server';

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createBan } from 'hono-ban';
import { hook } from 'hono-ban/zod';

import { startServer } from './support/server';

/**
 * Zod validation hooks over HTTP (SPEC 8.1 to 8.5). `zValidator(target,
 * schema, hook(ban))` from the built package turns every Zod failure into a
 * 422 Problem Details response with one `errors` entry per issue: RFC 6901
 * pointers for `body` and `form`, names for `query`, `param`, `header` and
 * `cookie` (SPEC 7.1.3, 8.3). Valid input reaches the handler as parsed data.
 * Siblings: `validation-zod-direct` and `validation-zod-openapi`.
 * @ref https://github.com/honojs/middleware/tree/main/packages/zod-validator
 */

const userSchema = z.object({
  email: z.email(),
  profile: z.object({ age: z.number().int().min(18) }),
  items: z.array(z.object({ sku: z.string() })),
  kind: z.enum(['a', 'b']),
});
const escapedKeysSchema = z.object({
  'a/b': z.string(),
  'a~b': z.string(),
  'a~/b': z.string(),
});
const querySchema = z.object({
  page: z.coerce.number().int(),
  limit: z.coerce.number().max(100),
});
const paramSchema = z.object({ id: z.uuid() });
const headerSchema = z.object({ 'X-Api-Key': z.string().min(8) });
const cookieSchema = z.object({ session: z.string().min(4) });
const formSchema = z.object({
  name: z.string().min(2),
  age: z.coerce.number(),
});

const invalidUser = {
  email: 'nope',
  profile: { age: 12 },
  items: [{}, { sku: 3 }],
  kind: 'c',
};
const validUser = {
  email: 'a@b.co',
  profile: { age: 30 },
  items: [{ sku: 'x1' }],
  kind: 'a',
};

/**
 * Zod 4.5.4 issues for `invalidUser`, in Zod's order. `expected` appears only
 * where Zod sets it; Zod 4 `invalid_type` has no scalar `received` (SPEC 8.5).
 * @ref https://zod.dev/error-formatting
 */
const invalidUserEntries = [
  {
    location: 'body',
    pointer: '/email',
    detail: 'Invalid email address',
    code: 'invalid_format',
  },
  {
    location: 'body',
    pointer: '/profile/age',
    detail: 'Too small: expected number to be >=18',
    code: 'too_small',
  },
  {
    location: 'body',
    pointer: '/items/0/sku',
    detail: 'Invalid input: expected string, received undefined',
    code: 'invalid_type',
    expected: 'string',
  },
  {
    location: 'body',
    pointer: '/items/1/sku',
    detail: 'Invalid input: expected string, received number',
    code: 'invalid_type',
    expected: 'string',
  },
  {
    location: 'body',
    pointer: '/kind',
    detail: 'Invalid option: expected one of "a"|"b"',
    code: 'invalid_value',
  },
];

async function postJson(
  server: RunningServer,
  path: string,
  body: unknown,
): Promise<Response> {
  return server.fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Routes whose only job is to prove the validator let the request through. */
const ok = (c: Context): Response => c.text('ok');

interface TargetCase {
  readonly target: string;
  readonly path: string;
  readonly init: RequestInit;
  readonly errors: ReadonlyArray<Record<string, string>>;
}

describe('zValidator with hook(ban)', () => {
  const ban = createBan();
  const app = new Hono();
  app.onError(ban.onError());
  app.post('/users', zValidator('json', userSchema, hook(ban)), (c) => {
    const user = c.req.valid('json');
    return c.json({
      email: user.email,
      age: user.profile.age,
      count: user.items.length,
    });
  });
  app.post('/escaped', zValidator('json', escapedKeysSchema, hook(ban)), ok);
  app.get('/search', zValidator('query', querySchema, hook(ban)), (c) =>
    c.json(c.req.valid('query')),
  );
  app.get('/orders/:id', zValidator('param', paramSchema, hook(ban)), ok);
  app.get('/secure', zValidator('header', headerSchema, hook(ban)), ok);
  app.get('/me', zValidator('cookie', cookieSchema, hook(ban)), ok);
  app.post('/signup', zValidator('form', formSchema, hook(ban)), ok);

  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it('renders one Problem Details entry per Zod issue, in Zod order', async () => {
    const res = await postJson(server, '/users', invalidUser);
    expect(res.status).toBe(422);
    // @ref https://www.rfc-editor.org/rfc/rfc9457#section-3
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'about:blank',
      status: 422,
      title: 'Validation Failed',
      detail: 'Request validation failed',
      instance: '/users',
      code: 'VALIDATION_FAILED',
      location: 'body',
    });
    // Parsed JSON has no undefined members: equality also proves omission.
    expect(body['errors']).toEqual(invalidUserEntries);
    expect(res.headers.get('x-error-id')).toBe(body['id']);
  });

  it('escapes ~ and / in body keys as RFC 6901 pointers', async () => {
    const res = await postJson(server, '/escaped', {});
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: Array<{ pointer: string }> };
    // @ref https://www.rfc-editor.org/rfc/rfc6901#section-3
    expect(body.errors.map((entry) => entry.pointer)).toEqual([
      '/a~1b',
      '/a~0b',
      '/a~0~1b',
    ]);
  });

  it('passes valid input through to the handler as parsed data', async () => {
    const res = await postJson(server, '/users', validUser);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      email: 'a@b.co',
      age: 30,
      count: 1,
    });
    const search = await server.fetch('/search?page=2&limit=10');
    expect(search.status).toBe(200);
    await expect(search.json()).resolves.toEqual({ page: 2, limit: 10 });
  });

  it.each<TargetCase>([
    {
      target: 'query',
      path: '/search?page=x&limit=500',
      init: {},
      errors: [
        {
          location: 'query',
          name: 'page',
          detail: 'Invalid input: expected number, received NaN',
          code: 'invalid_type',
          expected: 'number',
          received: 'NaN',
        },
        {
          location: 'query',
          name: 'limit',
          detail: 'Too big: expected number to be <=100',
          code: 'too_big',
        },
      ],
    },
    {
      target: 'param',
      path: '/orders/not-a-uuid',
      init: {},
      errors: [
        {
          location: 'param',
          name: 'id',
          detail: 'Invalid UUID',
          code: 'invalid_format',
        },
      ],
    },
    {
      // `@hono/zod-validator` maps the lowercased wire header back onto the
      // schema key, so the entry name keeps the schema's casing (SPEC 8.3).
      // @ref https://github.com/honojs/middleware/blob/main/packages/zod-validator/src/index.ts
      target: 'header',
      path: '/secure',
      init: { headers: { 'x-api-key': 'short' } },
      errors: [
        {
          location: 'header',
          name: 'X-Api-Key',
          detail: 'Too small: expected string to have >=8 characters',
          code: 'too_small',
        },
      ],
    },
    {
      target: 'cookie',
      path: '/me',
      init: { headers: { cookie: 'session=ab' } },
      errors: [
        {
          location: 'cookie',
          name: 'session',
          detail: 'Too small: expected string to have >=4 characters',
          code: 'too_small',
        },
      ],
    },
    {
      // `form` is a pointer location like `body` (SPEC 7.1.3).
      target: 'form',
      path: '/signup',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ name: 'x', age: 'abc' }).toString(),
      },
      errors: [
        {
          location: 'form',
          pointer: '/name',
          detail: 'Too small: expected string to have >=2 characters',
          code: 'too_small',
        },
        {
          location: 'form',
          pointer: '/age',
          detail: 'Invalid input: expected number, received NaN',
          code: 'invalid_type',
          expected: 'number',
          received: 'NaN',
        },
      ],
    },
  ])(
    'maps the $target target to its location',
    async ({ path, init, errors }) => {
      const res = await server.fetch(path, init);
      expect(res.status).toBe(422);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body['code']).toBe('VALIDATION_FAILED');
      // The top-level `location` member mirrors the one on every entry (8.2).
      expect(body['location']).toBe(errors[0]?.['location']);
      expect(body['errors']).toEqual(errors);
    },
  );
});
