import type {
  BanError,
  JsonSchema,
  RenderContext,
  ResolvedDefinition,
  SchemaContext,
} from 'hono-ban';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createBan, defineFormat, pointerFromPath } from 'hono-ban';
import { assertFormatConformance } from 'hono-ban/testing';

import { compileWithAjv, schemaErrors } from './support/ajv';
import { startServer } from './support/server';

/**
 * `defineFormat` in both SPEC 7.5 forms, served through `createBan({ format })`
 * over real HTTP. The hand-written form proves a custom content type, body,
 * validation body and explicit `validationSchema`; the Standard JSON Schema
 * form is built from a Zod 4 object whose `~standard.jsonSchema` converter
 * produces the schema real bodies are checked against. Both pass SPEC 7.4.
 */

const ACME_CONTENT_TYPE = 'application/vnd.acme.error+json';
const STD_CONTENT_TYPE = 'application/vnd.acme.std+json';
const DRAFT_2020: SchemaContext = {
  docsBaseUrl: undefined,
  dialect: 'draft-2020-12',
};
const OPENAPI_30: SchemaContext = {
  docsBaseUrl: undefined,
  dialect: 'openapi-3.0',
};
// @ref https://www.w3.org/TR/trace-context/#traceparent-header
const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const SKU_ISSUE = { path: ['items', 0, 'sku'], message: 'Required' };
const TEXT = { type: 'string' };

interface AcmeBody {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly id: string;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly issues?: Array<{ readonly at: string; readonly reason: string }>;
}

function renderAcme(error: BanError, ctx: RenderContext): AcmeBody {
  return {
    status: error.status,
    code: error.code,
    message: error.detail ?? error.title,
    id: error.id,
    ...(ctx.requestId === undefined ? {} : { requestId: ctx.requestId }),
    ...(ctx.traceId === undefined ? {} : { traceId: ctx.traceId }),
  };
}

function acmeSchema(
  definition: ResolvedDefinition,
  ctx: SchemaContext,
): JsonSchema {
  // OpenAPI 3.0 predates `const` (SPEC 7).
  // @ref https://spec.openapis.org/oas/v3.0.3#schema-object
  const constant = (value: unknown): JsonSchema =>
    ctx.dialect === 'openapi-3.0' ? { enum: [value] } : { const: value };
  return {
    type: 'object',
    required: ['status', 'code', 'message', 'id'],
    properties: {
      status: constant(definition.status),
      code: constant(definition.code),
      message: TEXT,
      id: TEXT,
      requestId: TEXT,
      traceId: TEXT,
      issues: {
        type: 'array',
        items: {
          type: 'object',
          required: ['at', 'reason'],
          properties: { at: TEXT, reason: TEXT },
          additionalProperties: false,
        },
      },
    },
    additionalProperties: false,
  };
}

const acme = defineFormat({
  name: 'acme',
  contentType: ACME_CONTENT_TYPE,
  render: renderAcme,
  renderValidation: (error, issues, ctx): AcmeBody => ({
    ...renderAcme(error, ctx),
    issues: issues.map((issue) => ({
      at: issue.path.join('.'),
      reason: issue.message,
    })),
  }),
  schema: acmeSchema,
  validationSchema: (definition, ctx) => ({
    ...acmeSchema(definition, ctx),
    required: ['status', 'code', 'message', 'id', 'issues'],
  }),
});

// Zod 4 implements Standard JSON Schema: `~standard.jsonSchema.output()`.
// @ref https://standardschema.dev/json-schema
const StdBody = z.object({
  status: z.number().int(),
  code: z.string(),
  message: z.string(),
  errorId: z.string(),
  traceId: z.string().optional(),
  issues: z
    .array(z.object({ path: z.string(), message: z.string() }))
    .optional(),
});

function renderStd(error: BanError, ctx: RenderContext) {
  return {
    status: error.status,
    code: error.code,
    message: error.detail ?? error.title,
    errorId: error.id,
    ...(ctx.traceId === undefined ? {} : { traceId: ctx.traceId }),
  };
}

const std = defineFormat({
  name: 'std',
  contentType: STD_CONTENT_TYPE,
  schema: StdBody,
  render: renderStd,
  renderValidation: (error, issues, ctx) => ({
    ...renderStd(error, ctx),
    // @ref https://www.rfc-editor.org/rfc/rfc6901#section-3
    issues: issues.map((issue) => ({
      path: pointerFromPath(issue.path),
      message: issue.message,
    })),
  }),
});

describe('defineFormat (hand-written) over HTTP', () => {
  const ban = createBan({ format: acme });
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/forbidden', () => {
    throw ban.forbidden('Token lacks orders:write');
  });
  app.get('/invalid', () => {
    throw ban.validation([SKU_ISSUE], { location: 'body' });
  });
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it('serves the custom content type, status and body', async () => {
    const res = await server.fetch('/forbidden', {
      headers: { traceparent: TRACEPARENT, 'X-Request-Id': 'req-7' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toBe(ACME_CONTENT_TYPE);
    expect(body).toEqual({
      status: 403,
      code: 'FORBIDDEN',
      message: 'Token lacks orders:write',
      id: res.headers.get('x-error-id'),
      requestId: 'req-7',
      traceId: TRACE_ID,
    });
    expect(
      schemaErrors(acme.schema(ban.catalog.FORBIDDEN, DRAFT_2020), body),
    ).toEqual([]);
    // Without the headers the request-scoped members are absent.
    const bare = (await (await server.fetch('/forbidden')).json()) as object;
    expect(Object.keys(bare)).toEqual(['status', 'code', 'message', 'id']);
  });

  it('routes validation errors through renderValidation', async () => {
    const res = await server.fetch('/invalid');
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toBe(ACME_CONTENT_TYPE);
    expect(body).toEqual({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Validation Failed',
      id: expect.any(String),
      issues: [{ at: 'items.0.sku', reason: 'Required' }],
    });
    const schema = acme.validationSchema(
      ban.catalog.VALIDATION_FAILED,
      DRAFT_2020,
    );
    expect(schema).toHaveProperty('required', [
      'status',
      'code',
      'message',
      'id',
      'issues',
    ]);
    expect(schemaErrors(schema, body)).toEqual([]);
  });

  it('passes conformance across the built-in catalog', () => {
    expect(() => {
      assertFormatConformance(acme, ban.catalog, { compile: compileWithAjv });
    }).not.toThrow();
  });
});

describe('defineFormat (Standard JSON Schema from Zod) over HTTP', () => {
  const ban = createBan({ format: std });
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/missing', () => {
    throw ban.notFound('Order 42 does not exist');
  });
  app.get('/invalid', () => {
    throw ban.validation([SKU_ISSUE], { location: 'body' });
  });
  let server: RunningServer;

  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server.close();
  });

  it.each([
    ['draft-2020-12', DRAFT_2020],
    ['openapi-3.0', OPENAPI_30],
  ])('derives the %s schema from the output projection', (target, ctx) => {
    const definition = ban.catalog.NOT_FOUND;
    const expected = StdBody['~standard'].jsonSchema.output({ target });
    expect(std.schema(definition, ctx)).toEqual(expected);
    expect(std.validationSchema(definition, ctx)).toEqual(expected);
  });

  it('serves a body the derived schema and the Zod schema both accept', async () => {
    const res = await server.fetch('/missing', {
      headers: { traceparent: TRACEPARENT },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe(STD_CONTENT_TYPE);
    expect(body).toEqual({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Order 42 does not exist',
      errorId: res.headers.get('x-error-id'),
      traceId: TRACE_ID,
    });
    expect(
      schemaErrors(std.schema(ban.catalog.NOT_FOUND, DRAFT_2020), body),
    ).toEqual([]);
    expect(StdBody.safeParse(body).success).toBe(true);
  });

  it('renders validation issues as RFC 6901 pointers', async () => {
    const res = await server.fetch('/invalid');
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(422);
    expect(body).toMatchObject({
      code: 'VALIDATION_FAILED',
      issues: [{ path: '/items/0/sku', message: 'Required' }],
    });
    expect(
      schemaErrors(
        std.validationSchema(ban.catalog.VALIDATION_FAILED, DRAFT_2020),
        body,
      ),
    ).toEqual([]);
  });

  it('passes conformance with the derived schema', () => {
    expect(() => {
      assertFormatConformance(std, ban.catalog, { compile: compileWithAjv });
    }).not.toThrow();
  });
});
