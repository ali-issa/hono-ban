/**
 * Standard Schema validation and `ban.validation` over HTTP (SPEC 8.1 to 8.4,
 * 8.7; 7.1.3 for the rendered entries).
 *
 * Proves that `hook(ban)` from `hono-ban/standard-schema` turns an
 * `sValidator` failure into a 422 for any Standard Schema library (Zod and
 * Valibot here), that `fromIssues` and `toIssues` called from a route produce
 * the same body as the hook, and that `ban.validation` with hand-built
 * `ValidationIssue`s honours `detail`, `meta`, and `location`.
 */
import type { ValidationIssue } from 'hono-ban';

import type { RunningServer } from './support/server';

import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import * as v from 'valibot';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createBan } from 'hono-ban';
import { fromIssues, hook, toIssues } from 'hono-ban/standard-schema';

import { startServer } from './support/server';

const signupSchema = z.object({
  email: z.email(),
  profile: z.object({ age: z.number() }),
  tags: z.array(z.string()),
});
const badSignup = { email: 'nope', profile: { age: 'x' }, tags: ['a', 2] };
const orderSchema = v.object({ items: v.array(v.object({ sku: v.string() })) });
const badOrder = { items: [{ sku: 1 }] };
const pageSchema = v.object({ page: v.pipe(v.string(), v.digits()) });

/**
 * Per SPEC 8.7 an entry carries only the location, the pointer, and the
 * message: the Standard Schema issue defines no code, expected, or received.
 * Zod reports raw PropertyKey path segments and Valibot reports `{ key }`
 * segments; both are allowed and produce the same pointers.
 * @ref https://standardschema.dev
 */
const SIGNUP_ENTRIES = [
  { location: 'body', pointer: '/email', detail: 'Invalid email address' },
  {
    location: 'body',
    pointer: '/profile/age',
    detail: 'Invalid input: expected number, received string',
  },
  {
    location: 'body',
    pointer: '/tags/1',
    detail: 'Invalid input: expected string, received number',
  },
];
const ORDER_ENTRIES = [
  {
    location: 'body',
    pointer: '/items/0/sku',
    detail: 'Invalid type: Expected string but received 1',
  },
];

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

describe('hono-ban/standard-schema hook with sValidator', () => {
  const ban = createBan();
  const app = new Hono();
  app.onError(ban.onError());
  app.post('/zod', sValidator('json', signupSchema, hook(ban)), ok);
  app.post('/valibot', sValidator('json', orderSchema, hook(ban)), ok);
  app.get('/search', sValidator('query', pageSchema, hook(ban)), ok);
  app.post('/zod/from-issues', async (c) => {
    const result = await signupSchema['~standard'].validate(await c.req.json());
    throw fromIssues(ban, result.issues ?? [], 'body');
  });
  app.post('/valibot/to-issues', async (c) => {
    const result = await orderSchema['~standard'].validate(await c.req.json());
    throw ban.validation(toIssues(result.issues ?? []), { location: 'body' });
  });
  app.get('/mixed-paths', () => {
    // Raw keys and `{ key }` segments may be mixed in one path; a missing
    // path is the document root. @ref https://standardschema.dev
    throw ban.validation(
      toIssues([
        { message: 'a', path: ['items', 0, { key: 'sku' }] },
        { message: 'b' },
      ]),
      { location: 'body' },
    );
  });
  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it('lets valid input through to the handler', async () => {
    const res = await postJson(server, '/zod', {
      email: 'a@b.co',
      profile: { age: 30 },
      tags: ['x'],
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it.each([
    { path: '/zod', payload: badSignup, entries: SIGNUP_ENTRIES },
    { path: '/valibot', payload: badOrder, entries: ORDER_ENTRIES },
  ])(
    '$path renders message-only entries',
    async ({ path, payload, entries }) => {
      const res = await postJson(server, path, payload);
      expect(res.status).toBe(422);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
      const body = await res.json();
      expect(body).toMatchObject({
        status: 422,
        code: 'VALIDATION_FAILED',
        title: 'Validation Failed',
        detail: 'Request validation failed',
        location: 'body',
        instance: path,
      });
      expect(res.headers.get('x-error-id')).toBe(body.id);
      expect(body.errors).toStrictEqual(entries);
    },
  );

  it('names query parameters instead of pointing into them', async () => {
    const res = await server.fetch('/search?page=x');
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      location: 'query',
      errors: [
        {
          location: 'query',
          name: 'page',
          detail: 'Invalid digits: Received "x"',
        },
      ],
    });
    expect((await server.fetch('/search?page=2')).status).toBe(200);
  });

  it.each([
    { path: '/zod/from-issues', payload: badSignup, entries: SIGNUP_ENTRIES },
    { path: '/valibot/to-issues', payload: badOrder, entries: ORDER_ENTRIES },
  ])(
    '$path from a route produces the hook body',
    async ({ path, payload, entries }) => {
      const res = await postJson(server, path, payload);
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body).toMatchObject({
        code: 'VALIDATION_FAILED',
        detail: 'Request validation failed',
        location: 'body',
      });
      expect(body.errors).toStrictEqual(entries);
    },
  );

  it('reads raw keys and { key } segments in one path', async () => {
    const res = await server.fetch('/mixed-paths');
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      errors: [
        { location: 'body', pointer: '/items/0/sku', detail: 'a' },
        { location: 'body', pointer: '', detail: 'b' },
      ],
    });
  });
});

describe('ban.validation with hand-built issues', () => {
  const ban = createBan();
  const issues: ReadonlyArray<ValidationIssue> = [
    {
      path: ['email'],
      message: 'Invalid email',
      code: 'invalid_format',
      expected: 'email',
      received: 'string',
    },
    { path: ['a/b', '~x', 0], message: 'Escaped' },
    { path: [], message: 'Root' },
  ];
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/body', () => {
    throw ban.validation(issues, {
      location: 'body',
      detail: 'Fix the highlighted fields',
      meta: { form: 'signup' },
    });
  });
  app.get('/header', () => {
    throw ban.validation(issues, { location: 'header' });
  });
  let server: RunningServer;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it('renders custom detail, meta, and RFC 6901 pointers', async () => {
    const res = await server.fetch('/body');
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      title: 'Validation Failed',
      detail: 'Fix the highlighted fields',
      location: 'body',
      form: 'signup',
    });
    // `~` escapes to `~0` before `/` escapes to `~1`; the empty path is ''.
    // @ref https://www.rfc-editor.org/rfc/rfc6901#section-3
    expect(body.errors).toStrictEqual([
      {
        location: 'body',
        pointer: '/email',
        detail: 'Invalid email',
        code: 'invalid_format',
        expected: 'email',
        received: 'string',
      },
      { location: 'body', pointer: '/a~1b/~0x/0', detail: 'Escaped' },
      { location: 'body', pointer: '', detail: 'Root' },
    ]);
  });

  it('names header entries by their first path segment', async () => {
    const res = await server.fetch('/header');
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({
      detail: 'Request validation failed',
      location: 'header',
    });
    expect(body.errors).toStrictEqual([
      {
        location: 'header',
        name: 'email',
        detail: 'Invalid email',
        code: 'invalid_format',
        expected: 'email',
        received: 'string',
      },
      { location: 'header', name: 'a/b', detail: 'Escaped' },
      { location: 'header', name: '', detail: 'Root' },
    ]);
  });
});
