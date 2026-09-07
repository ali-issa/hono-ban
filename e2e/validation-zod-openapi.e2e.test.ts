import type { RunningServer } from './support/server';

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { defaultHook, hook } from 'hono-ban/zod';

import { startServer } from './support/server';

/**
 * `@hono/zod-openapi` integration (SPEC 8.4, 8.5). `new OpenAPIHono({
 * defaultHook: defaultHook(ban) })` routes every failed request part through
 * `ban.onError`, so an invalid body or path parameter renders the same 422
 * Problem Details body as `zValidator(target, schema, hook(ban))` does on a
 * plain `Hono` app, and valid requests reach the handler with parsed data.
 * @ref https://github.com/honojs/middleware/blob/main/packages/zod-openapi/src/index.ts
 */

const ID = '5f2b9c1e-8f56-4d55-9c8a-6a1b2c3d4e5f';
const paramSchema = z.object({ id: z.uuid() });
const bodySchema = z.object({
  email: z.email(),
  address: z.object({ zip: z.string().length(5) }),
});
const invalidBody = { email: 'nope', address: { zip: '123' } };
const validBody = { email: 'a@b.co', address: { zip: '12345' } };

const route = createRoute({
  method: 'post',
  path: '/users/{id}',
  request: {
    params: paramSchema,
    body: {
      required: true,
      content: { 'application/json': { schema: bodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Created',
      content: {
        'application/json': {
          schema: z.object({ id: z.string(), email: z.string() }),
        },
      },
    },
  },
});

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

/** Everything but the error id, so two responses can be compared. */
function comparable(body: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = body;
  return rest;
}

describe('OpenAPIHono with defaultHook(ban)', () => {
  const ban = createBan();
  const app = new OpenAPIHono({ defaultHook: defaultHook(ban) });
  app.onError(ban.onError());
  app.openapi(route, (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json({ id, email: body.email }, 200);
  });

  // The reference: the same schemas wired by hand with `zValidator`.
  const plain = new Hono();
  plain.onError(ban.onError());
  plain.post(
    '/users/:id',
    zValidator('param', paramSchema, hook(ban)),
    zValidator('json', bodySchema, hook(ban)),
    (c) => c.text('ok'),
  );

  let server: RunningServer;
  let reference: RunningServer;
  beforeAll(async () => {
    [server, reference] = await Promise.all([
      startServer(app),
      startServer(plain),
    ]);
  });
  afterAll(async () => {
    await Promise.all([server.close(), reference.close()]);
  });

  it('renders an invalid body as 422 Problem Details with pointers', async () => {
    const res = await postJson(server, `/users/${ID}`, invalidBody);
    expect(res.status).toBe(422);
    // @ref https://www.rfc-editor.org/rfc/rfc9457#section-3
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 'about:blank',
      status: 422,
      title: 'Validation Failed',
      detail: 'Request validation failed',
      instance: `/users/${ID}`,
      code: 'VALIDATION_FAILED',
      location: 'body',
    });
    // @ref https://www.rfc-editor.org/rfc/rfc6901#section-3
    expect(body['errors']).toEqual([
      {
        location: 'body',
        pointer: '/email',
        detail: 'Invalid email address',
        code: 'invalid_format',
      },
      {
        location: 'body',
        pointer: '/address/zip',
        detail: 'Too small: expected string to have exactly 5 characters',
        code: 'too_small',
      },
    ]);
    expect(res.headers.get('x-error-id')).toBe(body['id']);
  });

  it('renders an invalid path parameter by name', async () => {
    const res = await postJson(server, '/users/not-a-uuid', validBody);
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      location: 'param',
      errors: [
        {
          location: 'param',
          name: 'id',
          detail: 'Invalid UUID',
          code: 'invalid_format',
        },
      ],
    });
  });

  it('reports the first failing part when several are invalid', async () => {
    // `@hono/zod-openapi` validates query, params, headers and cookies before
    // the body, and each validator's hook throws on its own failure.
    // @ref https://github.com/honojs/middleware/blob/main/packages/zod-openapi/src/index.ts
    const res = await postJson(server, '/users/not-a-uuid', invalidBody);
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      location: string;
      errors: Array<unknown>;
    };
    expect(body.location).toBe('param');
    expect(body.errors).toHaveLength(1);
  });

  it.each([
    { part: 'body', path: `/users/${ID}`, payload: invalidBody },
    { part: 'param', path: '/users/not-a-uuid', payload: validBody },
  ])(
    'matches the zValidator response for an invalid $part',
    async ({ path, payload }) => {
      const [viaOpenApi, viaValidator] = await Promise.all([
        postJson(server, path, payload),
        postJson(reference, path, payload),
      ]);
      expect(viaOpenApi.status).toBe(viaValidator.status);
      const openApiBody = (await viaOpenApi.json()) as Record<string, unknown>;
      const validatorBody = (await viaValidator.json()) as Record<
        string,
        unknown
      >;
      expect(comparable(openApiBody)).toEqual(comparable(validatorBody));
    },
  );

  it('passes a valid request through with parsed params and body', async () => {
    const res = await postJson(server, `/users/${ID}`, validBody);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: ID, email: 'a@b.co' });
  });
});
