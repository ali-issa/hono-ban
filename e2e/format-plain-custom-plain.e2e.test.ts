import type { IssueLocation, SchemaContext } from 'hono-ban';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { plain, PLAIN_CONTENT_TYPE } from 'hono-ban/formats/plain';
import { assertFormatConformance } from 'hono-ban/testing';

import { compileWithAjv, schemaErrors } from './support/ajv';
import { startServer } from './support/server';

/**
 * Plain format driven through the built package over real HTTP. Proves the
 * SPEC 7.3 body (closed shape, nested `meta`, member order, `traceId` from
 * `traceparent`, validation entries with pointers or names) and that every
 * real body conforms to the schema the format publishes (SPEC 7.4).
 */

const SCHEMA_CTX: SchemaContext = {
  docsBaseUrl: undefined,
  dialect: 'draft-2020-12',
};
// @ref https://www.w3.org/TR/trace-context/#traceparent-header
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const LOCATIONS: Array<IssueLocation> = [
  'body',
  'form',
  'query',
  'param',
  'header',
  'cookie',
];
const ISSUES = [
  { path: ['items', 0, 'sku'], message: 'Required', code: 'invalid_type' },
  {
    path: ['email'],
    message: 'Invalid email',
    expected: 'string',
    received: 'number',
  },
];

describe('plain() over HTTP', () => {
  const ban = createBan({ format: plain() });
  const app = new Hono();
  app.onError(ban.onError({ includeStack: true }));
  app.get('/full', () => {
    throw ban.tooManyRequests('Slow down', {
      meta: { limit: 100, nested: { a: [1, 2] } },
    });
  });
  app.get('/minimal', () => {
    throw ban.notFound();
  });
  app.get('/boom', () => {
    throw ban.internalServerError('Database unreachable', {
      cause: new Error('ECONNREFUSED 10.0.0.7:5432'),
    });
  });
  app.get('/validation/:location', (c) => {
    throw ban.validation(ISSUES, {
      location: c.req.param('location') as IssueLocation,
    });
  });
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it('serves application/json with meta nested and members in SPEC order', async () => {
    const res = await server.fetch('/full', {
      headers: { traceparent: TRACEPARENT, 'X-Request-Id': 'req-7' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toBe(PLAIN_CONTENT_TYPE);
    expect(body).toEqual({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      title: 'Too Many Requests',
      detail: 'Slow down',
      id: res.headers.get('x-error-id'),
      instance: '/full',
      traceId: TRACE_ID,
      meta: { limit: 100, nested: { a: [1, 2] } },
    });
    // SPEC 7.3 fixes the member order; the request id is not a plain member.
    expect(Object.keys(body)).toEqual([
      'status',
      'code',
      'title',
      'detail',
      'id',
      'instance',
      'traceId',
      'meta',
    ]);
    expect(
      schemaErrors(
        plain().schema(ban.catalog.TOO_MANY_REQUESTS, SCHEMA_CTX),
        body,
      ),
    ).toEqual([]);
  });

  it('omits detail, traceId and meta when there is nothing to render', async () => {
    const res = await server.fetch('/minimal');
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(404);
    expect(body).toEqual({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not Found',
      id: expect.any(String),
      instance: '/minimal',
    });
    expect(
      schemaErrors(plain().schema(ban.catalog.NOT_FOUND, SCHEMA_CTX), body),
    ).toEqual([]);
  });

  it('adds the cause stack on 5xx when includeStack is on', async () => {
    const res = await server.fetch('/boom');
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(500);
    expect(body).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      detail: 'Database unreachable',
    });
    // SPEC 6.7: the cause's stack wins over the error's own.
    expect(body['stack']).toContain('ECONNREFUSED 10.0.0.7:5432');
    expect(
      schemaErrors(
        plain().schema(ban.catalog.INTERNAL_SERVER_ERROR, SCHEMA_CTX),
        body,
      ),
    ).toEqual([]);
  });

  it.each(LOCATIONS)(
    'renders validation entries for location %s',
    async (location) => {
      const res = await server.fetch(`/validation/${location}`);
      const body = (await res.json()) as Record<string, unknown>;
      // Pointers for body and form (RFC 6901), the first segment otherwise.
      // @ref https://www.rfc-editor.org/rfc/rfc6901#section-3
      const pointer = location === 'body' || location === 'form';
      const address = (path: string, name: string) =>
        pointer ? { pointer: path } : { name };
      expect(res.status).toBe(422);
      expect(res.headers.get('content-type')).toBe(PLAIN_CONTENT_TYPE);
      expect(body).toEqual({
        status: 422,
        code: 'VALIDATION_FAILED',
        title: 'Validation Failed',
        detail: 'Request validation failed',
        id: expect.any(String),
        instance: `/validation/${location}`,
        meta: { location },
        errors: [
          {
            location,
            ...address('/items/0/sku', 'items'),
            detail: 'Required',
            code: 'invalid_type',
          },
          {
            location,
            ...address('/email', 'email'),
            detail: 'Invalid email',
            expected: 'string',
            received: 'number',
          },
        ],
      });
      expect(
        schemaErrors(
          plain().validationSchema(ban.catalog.VALIDATION_FAILED, SCHEMA_CTX),
          body,
        ),
      ).toEqual([]);
    },
  );

  it('conforms to its own schema across the built-in catalog', () => {
    expect(() => {
      assertFormatConformance(plain(), ban.catalog, {
        compile: compileWithAjv,
      });
    }).not.toThrow();
  });
});
