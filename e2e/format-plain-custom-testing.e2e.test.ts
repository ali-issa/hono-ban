import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan, defineFormat } from 'hono-ban';
import { plain } from 'hono-ban/formats/plain';
import {
  assertFormatConformance,
  expectBanError,
  renderError,
} from 'hono-ban/testing';

import { compileWithAjv } from './support/ajv';
import { startServer } from './support/server';

/**
 * The consumer testing helpers (SPEC 11) used against the built package:
 * `renderError` reproduces what a real request returned, `expectBanError`
 * asserts on the error the handler received and explains mismatches, and
 * `assertFormatConformance` (SPEC 7.4) both accepts a minimal `defineFormat`
 * relying on its defaults (SPEC 7.5) and lists every failing check of a
 * format whose schema disagrees with its render.
 */

// @ref https://www.w3.org/TR/trace-context/#traceparent-header
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

describe('hono-ban/testing helpers used by a consumer', () => {
  const ban = createBan({ format: plain() });
  const shared = ban.conflict('Order 42 already exists', {
    meta: { resource: 'order' },
  });
  const reported: Array<unknown> = [];
  const app = new Hono();
  app.onError(
    ban.onError({
      onReport: (report) => {
        reported.push(report.error);
      },
    }),
  );
  app.get('/shared', () => {
    throw shared;
  });
  app.get('/missing', () => {
    throw ban.notFound('No such order');
  });
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it('renderError matches the HTTP body except request-scoped members', async () => {
    const res = await server.fetch('/shared', {
      headers: { traceparent: TRACEPARENT },
    });
    const wire = (await res.json()) as Record<string, unknown>;
    expect(wire).toMatchObject({ instance: '/shared', traceId: TRACE_ID });
    // Supplying the request-scoped values reproduces the wire body exactly.
    expect(
      renderError(ban, shared, { instance: '/shared', traceId: TRACE_ID }).body,
    ).toEqual(wire);
    const local = renderError(ban, shared).body as Record<string, unknown>;
    expect(local).not.toHaveProperty('instance');
    expect(local).not.toHaveProperty('traceId');
    for (const key of ['instance', 'traceId']) {
      delete wire[key];
    }
    expect(local).toEqual(wire);
  });

  it('expectBanError passes for the error the handler received', async () => {
    reported.splice(0);
    await server.fetch('/missing');
    const caught: unknown = reported[0];
    expect(() => {
      expectBanError(caught, {
        status: 404,
        code: 'NOT_FOUND',
        detail: 'No such order',
      });
    }).not.toThrow();
    expectBanError(caught, { status: 404 });
    expect(caught.code).toBe('NOT_FOUND');
  });

  it.each([
    [
      'a plain Error',
      new Error('boom'),
      {},
      'Expected a BanError, received Error: boom',
    ],
    ['a string', 'nope', {}, 'Expected a BanError, received "nope"'],
    [
      'every mismatch at once',
      ban.notFound('x'),
      { status: 409, code: 'C', detail: 'y' },
      'BanError mismatch: status 404 !== 409; code "NOT_FOUND" !== "C"; detail "x" !== "y"',
    ],
    [
      'a missing detail',
      ban.notFound(),
      { detail: 'y' },
      'detail undefined !== "y"',
    ],
  ])('expectBanError explains %s', (_label, value, expected, message) => {
    expect(() => {
      expectBanError(value, expected);
    }).toThrow(message);
  });

  it('accepts a minimal defineFormat that relies on the SPEC 7.5 defaults', () => {
    // Only `render` and `schema`: validation errors reuse both.
    const mini = defineFormat({
      name: 'mini',
      contentType: 'application/json',
      render: (error) => ({ code: error.code, issues: error.issues?.length }),
      schema: (definition) => ({
        type: 'object',
        required: ['code'],
        properties: {
          code: { const: definition.code },
          issues: { type: 'integer' },
        },
        additionalProperties: false,
      }),
    });
    const miniBan = createBan({ format: mini });
    const invalid = miniBan.validation(
      [{ path: ['items', 0, 'sku'], message: 'Required' }],
      { location: 'query' },
    );
    expect(renderError(miniBan, invalid).body).toEqual({
      code: 'VALIDATION_FAILED',
      issues: 1,
    });
    const definition = miniBan.catalog.VALIDATION_FAILED;
    const ctx = { docsBaseUrl: undefined, dialect: 'draft-2020-12' } as const;
    expect(mini.validationSchema(definition, ctx)).toEqual(
      mini.schema(definition, ctx),
    );
    expect(() => {
      assertFormatConformance(mini, miniBan.catalog, {
        compile: compileWithAjv,
      });
    }).not.toThrow();
  });

  it('assertFormatConformance lists every failing check of a broken format', () => {
    // The schema requires `status`, which render never emits.
    const broken = defineFormat({
      name: 'broken',
      contentType: 'application/json',
      render: (error) => ({ code: error.code }),
      schema: () => ({
        type: 'object',
        required: ['code', 'status'],
        properties: { code: { type: 'string' }, status: { type: 'integer' } },
        additionalProperties: false,
      }),
    });
    const catalog = {
      NOT_FOUND: ban.catalog.NOT_FOUND,
      CONFLICT: ban.catalog.CONFLICT,
    };
    let caught: unknown;
    try {
      assertFormatConformance(broken, catalog, { compile: compileWithAjv });
    } catch (failure) {
      caught = failure;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError;
    // SPEC 7.4: three render cases plus one validation case per location.
    expect(aggregate.message).toBe('broken failed 18 conformance check(s)');
    const messages = aggregate.errors.map((entry) => (entry as Error).message);
    expect(
      messages.filter((m) => m.startsWith('broken NOT_FOUND ')),
    ).toHaveLength(9);
    expect(
      messages.filter((m) => m.startsWith('broken CONFLICT ')),
    ).toHaveLength(9);
    expect(messages[0]).toBe(
      "broken NOT_FOUND minimal: / must have required property 'status'",
    );
    expect(messages).toContainEqual(
      expect.stringMatching(/^broken CONFLICT validation\/cookie: /u),
    );
  });
});
