import type { RunningServer } from './support/server';

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createBan } from 'hono-ban';
import { fromZodError, hook, toIssues } from 'hono-ban/zod';

import { startServer } from './support/server';

/**
 * Direct Zod conversion and catalog wiring (SPEC 8.2, 8.5). A route that
 * calls `schema.safeParse` itself and throws `fromZodError(ban, error,
 * location)` or `ban.validation(toIssues(error), { location })` renders the
 * same Problem Details body as the `zValidator` hook path, including
 * `detail` and `meta` overrides. `createBan({ validationKey })` changes the
 * status and code every one of those paths produces.
 */

const schema = z.object({
  email: z.email(),
  tags: z.array(z.string().min(2)),
});
const invalid = { email: 'nope', tags: ['ok', 'x'] };

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

/** Everything but the per-request members, so two responses can be compared. */
function comparable(body: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, instance: _instance, ...rest } = body;
  return rest;
}

describe('fromZodError and toIssues', () => {
  const ban = createBan();
  const app = new Hono();
  app.onError(ban.onError());
  app.post('/hook', zValidator('json', schema, hook(ban)), (c) => c.text('ok'));
  app.post('/from-zod-error', async (c) => {
    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
      throw fromZodError(ban, result.error, 'body');
    }
    return c.text('ok');
  });
  app.post('/to-issues', async (c) => {
    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
      throw ban.validation(toIssues(result.error), { location: 'body' });
    }
    return c.text('ok');
  });
  app.post('/with-options', async (c) => {
    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
      throw fromZodError(ban, result.error, 'body', {
        detail: 'Fix the signup form',
        meta: { form: 'signup' },
      });
    }
    return c.text('ok');
  });

  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it.each(['/from-zod-error', '/to-issues'])(
    '%s renders the same body as the hook path',
    async (path) => {
      const [viaHook, direct] = await Promise.all([
        postJson(server, '/hook', invalid),
        postJson(server, path, invalid),
      ]);
      expect(viaHook.status).toBe(422);
      expect(direct.status).toBe(422);
      expect(direct.headers.get('content-type')).toBe(
        'application/problem+json',
      );
      const hookBody = (await viaHook.json()) as Record<string, unknown>;
      const directBody = (await direct.json()) as Record<string, unknown>;
      expect(comparable(directBody)).toEqual(comparable(hookBody));
      expect(directBody).toMatchObject({
        status: 422,
        code: 'VALIDATION_FAILED',
        location: 'body',
        instance: path,
        errors: [
          {
            location: 'body',
            pointer: '/email',
            detail: 'Invalid email address',
            code: 'invalid_format',
          },
          {
            location: 'body',
            pointer: '/tags/1',
            detail: 'Too small: expected string to have >=2 characters',
            code: 'too_small',
          },
        ],
      });
      expect(directBody['id']).not.toBe(hookBody['id']);
      expect(direct.headers.get('x-error-id')).toBe(directBody['id']);
    },
  );

  it('forwards detail and meta from fromZodError options', async () => {
    const res = await postJson(server, '/with-options', invalid);
    expect(res.status).toBe(422);
    const body = (await res.json()) as Record<string, unknown>;
    // `meta` keys become top-level extension members; `location` still comes
    // from the third argument (SPEC 8.2, 7.1.2).
    // @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.2
    expect(body).toMatchObject({
      detail: 'Fix the signup form',
      form: 'signup',
      location: 'body',
    });
    expect((body['errors'] as Array<unknown>).length).toBe(2);
  });

  it('passes valid input through both paths', async () => {
    const valid = { email: 'a@b.co', tags: ['ok'] };
    for (const path of ['/hook', '/from-zod-error', '/to-issues']) {
      const res = await postJson(server, path, valid);
      expect(res.status).toBe(200);
      await expect(res.text()).resolves.toBe('ok');
    }
  });
});

describe('custom validationKey', () => {
  const ban = createBan({
    errors: { INVALID_INPUT: { status: 400, title: 'Invalid Input' } },
    validationKey: 'INVALID_INPUT',
  });
  const app = new Hono();
  app.onError(ban.onError());
  app.post('/hook', zValidator('json', schema, hook(ban)), (c) => c.text('ok'));
  app.post('/direct', async (c) => {
    const result = schema.safeParse(await c.req.json());
    if (!result.success) {
      throw fromZodError(ban, result.error, 'body');
    }
    return c.text('ok');
  });

  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it.each(['/hook', '/direct'])(
    '%s uses the configured status, title and code',
    async (path) => {
      const res = await postJson(server, path, invalid);
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 400,
        title: 'Invalid Input',
        code: 'INVALID_INPUT',
        detail: 'Request validation failed',
        location: 'body',
      });
      expect((body['errors'] as Array<Record<string, unknown>>)[0]).toEqual({
        location: 'body',
        pointer: '/email',
        detail: 'Invalid email address',
        code: 'invalid_format',
      });
    },
  );
});
