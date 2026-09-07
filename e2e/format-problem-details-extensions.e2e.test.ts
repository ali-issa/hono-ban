/**
 * RFC 9457 Problem Details over HTTP, part 2: `meta` rendered as extension
 * members (SPEC 7.1.2, ADR 0008) and `ban.validation()` bodies (SPEC 7.1.3,
 * 8.1, 8.2, 8.3). Part 1 (`-members`) covers member order, `type`, and the
 * option toggles; part 3 (`-schema`) covers 7.1.4 and 7.4. Every body a
 * server returns here is checked against the JSON Schema the package
 * publishes for it.
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.2
 */
import type { IssueLocation, JsonSchema, ValidationIssue } from 'hono-ban';

import type { FetchApp, RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { PROBLEM_DETAILS_CONTENT_TYPE } from 'hono-ban/formats/problem-details';
import { errorSchema, validationSchema } from 'hono-ban/openapi';

import { schemaErrors } from './support/ajv';
import { startServer } from './support/server';

const DETAIL = 'Order 42 does not exist';
const LIBRARY_MEMBERS = 'type status title detail instance code id';

/** Starts `app` for the enclosing describe block and closes it afterwards. */
function useServer(app: FetchApp): RunningServer['fetch'] {
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
    const res = await server.fetch(path, init);
    return res;
  };
}

/** Member names in emission order, so order assertions read as one line. */
function keys(body: Record<string, unknown>): string {
  return Object.keys(body).join(' ');
}

/**
 * Reads a Problem Details body and checks the media type, the schema, and
 * that `status` mirrors the HTTP status.
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-3
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.1.2
 */
async function problem(
  res: Response,
  schema: JsonSchema,
): Promise<Record<string, unknown>> {
  expect(res.headers.get('content-type')).toBe(PROBLEM_DETAILS_CONTENT_TYPE);
  const body: Record<string, unknown> = await res.json();
  expect(schemaErrors(schema, body)).toEqual([]);
  expect(body['status']).toBe(res.status);
  return body;
}

describe('extension members (SPEC 7.1.2, ADR 0008)', () => {
  const ban = createBan();
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/flatten', () => {
    throw ban.notFound(DETAIL, {
      meta: {
        status: 'nope',
        title: 'nope',
        type: 'nope',
        code: 'nope',
        id: 'nope',
        instance: 'nope',
        retryAfter: 30,
        snake_case: 1,
        x: 1,
        '1st': true,
        'kebab-case': 3,
        ok: 4,
      },
    });
  });
  app.get('/merge', () => {
    throw ban.notFound(DETAIL, { meta: { meta: { context: { a: 1 } }, x: 2 } });
  });
  app.get('/replace', () => {
    throw ban.notFound(DETAIL, { meta: { meta: 'scalar', x: 2 } });
  });
  app.get('/proto', () => {
    // JSON.parse yields an own `__proto__` property; an object literal would
    // set the prototype instead and never reach the sanitizer.
    throw ban.notFound(DETAIL, {
      meta: JSON.parse(
        '{"__proto__":{"polluted":true},"constructor":"c","prototype":"p","balance":4}',
      ),
    });
  });
  app.get('/bigint', () => {
    throw ban.notFound(DETAIL, { meta: { balance: 12n } });
  });
  app.get('/leak', () => {
    throw ban.notFound({ meta: { detail: 42, traceId: 'not-a-trace-id' } });
  });
  const send = useServer(app);
  const notFound = errorSchema(ban, 'NOT_FOUND');

  it('lifts RFC 9457 names to the top level and keeps the rest under meta', async () => {
    // @ref https://www.rfc-editor.org/rfc/rfc9457#section-4 (names start with ALPHA, use ALPHA / DIGIT / "_", three or more characters)
    const res = await send('/flatten');
    const body = await problem(res, notFound);
    expect(keys(body)).toBe(`${LIBRARY_MEMBERS} retryAfter snake_case meta`);
    // Colliding compliant names (status, title, type, code, instance) are
    // dropped, not nested: standard members win. `id` is two characters, so
    // it is a short name and survives under meta like `x` and `ok`.
    expect(body).toEqual({
      type: 'about:blank',
      status: 404,
      title: 'Not Found',
      detail: DETAIL,
      instance: '/flatten',
      code: 'NOT_FOUND',
      id: res.headers.get('x-error-id'),
      retryAfter: 30,
      snake_case: 1,
      meta: { id: 'nope', x: 1, '1st': true, 'kebab-case': 3, ok: 4 },
    });
  });

  it.each([
    { path: '/merge', meta: { context: { a: 1 }, x: 2 } },
    { path: '/replace', meta: { x: 2 } },
  ])(
    'merges leftovers into a plain meta object at $path',
    async ({ path, meta }) => {
      const body = await problem(await send(path), notFound);
      expect(body['meta']).toEqual(meta);
    },
  );

  it('strips __proto__, constructor, and prototype before flattening', async () => {
    // ADR 0007: meta is shallow-copied without the prototype keys.
    const res = await send('/proto');
    const text = await res.text();
    expect(text).not.toContain('__proto__');
    expect(text).not.toContain('polluted');
    const body: Record<string, unknown> = JSON.parse(text);
    expect(schemaErrors(notFound, body)).toEqual([]);
    expect(Object.hasOwn(body, 'constructor')).toBe(false);
    expect(Object.hasOwn(body, 'prototype')).toBe(false);
    expect(keys(body)).toBe(`${LIBRARY_MEMBERS} balance`);
    expect(body['balance']).toBe(4);
  });

  it('renders a bigint meta value as a string (SPEC 6.8)', async () => {
    const body = await problem(await send('/bigint'), notFound);
    expect(body['balance']).toBe('12');
  });

  it('never lets meta fill a reserved member the error did not emit', async () => {
    // ADR 0008: standard and library members always win, whether or not this
    // error emits them, so the body keeps matching its own schema.
    const body = await problem(await send('/leak'), notFound);
    expect(body).not.toHaveProperty('detail');
    expect(body).not.toHaveProperty('traceId');
    expect(keys(body)).toBe('type status title instance code id');
  });
});

describe('validation bodies (SPEC 7.1.3, 8.1, 8.2, 8.3)', () => {
  const SIGNUP_ISSUES: ReadonlyArray<ValidationIssue> = [
    {
      path: ['email'],
      message: 'Invalid email address',
      code: 'invalid_format',
    },
    { path: ['items', 0, 'sku'], message: 'Required' },
  ];
  const PATH_ISSUES: ReadonlyArray<ValidationIssue> = [
    { path: [], message: 'Whole document' },
    { path: ['a~b', 'c/d'], message: 'Escaped' },
    { path: ['items', 0, 'sku'], message: 'Nested' },
  ];
  const ban = createBan();
  const app = new Hono();
  app.onError(ban.onError());
  app.post('/signup', () => {
    throw ban.validation(SIGNUP_ISSUES, { location: 'body' });
  });
  app.get('/search', () => {
    throw ban.validation(
      [
        {
          path: ['page'],
          message: 'Expected number',
          code: 'invalid_type',
          expected: 'number',
          received: 'string',
        },
      ],
      { location: 'query', detail: 'Bad query' },
    );
  });
  app.get('/at/:location', (c) => {
    // The test only requests the six IssueLocation values.
    const location = c.req.param('location') as IssueLocation;
    throw ban.validation(PATH_ISSUES, { location });
  });
  const send = useServer(app);
  const schema = validationSchema(ban);

  it('adds location and errors after the library members', async () => {
    const res = await send('/signup', { method: 'POST' });
    expect(res.status).toBe(422);
    const body = await problem(res, schema);
    expect(keys(body)).toBe(`${LIBRARY_MEMBERS} errors location`);
    expect(body).toMatchObject({
      type: 'about:blank',
      title: 'Validation Failed',
      detail: 'Request validation failed',
      instance: '/signup',
      code: 'VALIDATION_FAILED',
      location: 'body',
    });
    expect(body['errors']).toEqual([
      {
        location: 'body',
        pointer: '/email',
        detail: 'Invalid email address',
        code: 'invalid_format',
      },
      { location: 'body', pointer: '/items/0/sku', detail: 'Required' },
    ]);
  });

  it('keeps a caller detail and carries code, expected, and received', async () => {
    const body = await problem(await send('/search?page=x'), schema);
    expect(body['detail']).toBe('Bad query');
    expect(body['location']).toBe('query');
    expect(body['errors']).toEqual([
      {
        location: 'query',
        name: 'page',
        detail: 'Expected number',
        code: 'invalid_type',
        expected: 'number',
        received: 'string',
      },
    ]);
  });

  // @ref https://www.rfc-editor.org/rfc/rfc6901#section-3 ("" is the whole document; ~ and / escape as ~0 and ~1)
  const POINTERS = ['', '/a~0b/c~1d', '/items/0/sku'];
  const NAMES = ['', 'a~b', 'items'];
  it.each([
    { location: 'body', key: 'pointer', values: POINTERS },
    { location: 'form', key: 'pointer', values: POINTERS },
    { location: 'query', key: 'name', values: NAMES },
    { location: 'param', key: 'name', values: NAMES },
    { location: 'header', key: 'name', values: NAMES },
    { location: 'cookie', key: 'name', values: NAMES },
  ])(
    'addresses $location issues by $key',
    async ({ location, key, values }) => {
      const body = await problem(await send(`/at/${location}`), schema);
      expect(body['location']).toBe(location);
      const errors = body['errors'] as Array<Record<string, unknown>>;
      expect(errors.map((entry) => entry[key])).toEqual(values);
      expect(errors.map((entry) => keys(entry))).toEqual(
        values.map(() => `location ${key} detail`),
      );
      expect(errors.map((entry) => entry['location'])).toEqual(
        values.map(() => location),
      );
    },
  );
});
