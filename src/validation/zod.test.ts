import { OpenAPIHono, createRoute, z as zo } from '@hono/zod-openapi';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as z3 from 'zod/v3';

import { createBan } from '../core/create-ban';
import { defaultHook, fromZodError, hook, toIssues } from './zod';

const ban = createBan();
const schema = z.object({
  email: z.email(),
  items: z.array(z.object({ sku: z.string() })),
  kind: z.enum(['a', 'b']),
});

describe('toIssues (Zod 4)', () => {
  it('maps path, message, code, and expected', () => {
    const result = schema.safeParse({ email: 'nope', items: [{}], kind: 'c' });
    expect(result.success).toBe(false);
    const issues = toIssues(result.error as z.ZodError);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['email'], code: 'invalid_format' }),
        expect.objectContaining({
          path: ['items', 0, 'sku'],
          code: 'invalid_type',
          expected: 'string',
        }),
        expect.objectContaining({ path: ['kind'], code: 'invalid_value' }),
      ]),
    );
    for (const issue of issues) {
      expect(typeof issue.message).toBe('string');
    }
  });
});

describe('toIssues (Zod 3 compatibility)', () => {
  it('reads the same fields from a zod/v3 error', () => {
    const result = z3.object({ n: z3.number() }).safeParse({ n: 'x' });
    expect(result.success).toBe(false);
    expect(toIssues(result.error as z3.ZodError)).toEqual([
      {
        path: ['n'],
        message: 'Expected number, received string',
        code: 'invalid_type',
        expected: 'number',
        received: 'string',
      },
    ]);
  });
});

describe('fromZodError', () => {
  it('builds the validation error for a location', () => {
    const result = schema.safeParse({});
    const error = fromZodError(ban, result.error as z.ZodError, 'query', {
      detail: 'Fix it',
    });
    expect(error.status).toBe(422);
    expect(error.detail).toBe('Fix it');
    expect(error.meta).toEqual({ location: 'query' });
    expect(error.issues?.length).toBeGreaterThan(0);
  });
});

describe('hook with zValidator', () => {
  it('throws into onError so the response carries an id and pointers', async () => {
    const app = new Hono();
    app.onError(ban.onError());
    app.post('/', zValidator('json', schema, hook(ban)), (c) => c.text('ok'));
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nope', items: [], kind: 'a' }),
    });
    expect(response.status).toBe(422);
    expect(response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      location: 'body',
      errors: [{ location: 'body', pointer: '/email', code: 'invalid_format' }],
    });
    expect(response.headers.get('x-error-id')).toBe(body['id']);
    const ok = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co', items: [], kind: 'a' }),
    });
    expect(ok.status).toBe(200);
  });

  it('maps query targets to the query location', async () => {
    const app = new Hono();
    app.onError(ban.onError());
    app.get(
      '/',
      zValidator('query', z.object({ page: z.coerce.number() }), hook(ban)),
      (c) => c.text('ok'),
    );
    const response = await app.request('/?page=x');
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      errors: [{ location: 'query', name: 'page' }],
    });
  });
});

describe('defaultHook with OpenAPIHono', () => {
  it('handles every validated target through onError', async () => {
    const app = new OpenAPIHono({ defaultHook: defaultHook(ban) });
    app.onError(ban.onError());
    app.openapi(
      createRoute({
        method: 'post',
        path: '/users/{id}',
        request: {
          params: zo.object({ id: zo.uuid() }),
          body: {
            content: {
              'application/json': { schema: zo.object({ email: zo.email() }) },
            },
          },
        },
        responses: { 200: { description: 'ok' } },
      }),
      (c) => c.text('ok'),
    );
    const bad = await app.request('/users/not-a-uuid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co' }),
    });
    expect(bad.status).toBe(422);
    await expect(bad.json()).resolves.toMatchObject({
      location: 'param',
      errors: [{ location: 'param', name: 'id' }],
    });
    const badBody = await app.request(
      '/users/5f2b9c1e-8f56-4d55-9c8a-6a1b2c3d4e5f',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nope' }),
      },
    );
    expect(badBody.status).toBe(422);
    await expect(badBody.json()).resolves.toMatchObject({
      errors: [{ location: 'body', pointer: '/email' }],
    });
  });
});
