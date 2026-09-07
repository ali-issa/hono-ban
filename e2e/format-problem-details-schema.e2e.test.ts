/**
 * RFC 9457 Problem Details, part 3: the JSON Schema the built format
 * publishes for catalog entries and validation bodies (SPEC 7.1.4), the
 * `hono-ban/openapi` helpers that expose it, and `assertFormatConformance`
 * from `hono-ban/testing` run against the built format (SPEC 7.4, 11).
 * Parts 1 and 2 (`-members`, `-extensions`) exercise the bodies over HTTP
 * and validate each one against these schemas.
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.1
 */
import type { SchemaValidator } from 'hono-ban/testing';

import { describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { problemDetails } from 'hono-ban/formats/problem-details';
import { errorSchema, validationSchema } from 'hono-ban/openapi';
import { assertFormatConformance } from 'hono-ban/testing';

import { compileWithAjv } from './support/ajv';

const DOCS_BASE = 'https://docs.example.com/errors';
const TYPE_BASE = 'https://errors.example.com';
const SCHEMA_CTX = {
  docsBaseUrl: undefined,
  dialect: 'draft-2020-12',
} as const;
/** SPEC 7.4: three rendered cases plus two validation bodies (two issues, none) per location. */
const CASES_PER_DEFINITION = 3 + 6 * 2;
/** A compiler whose validator rejects every body, to observe failure handling. */
const rejectAll = (): SchemaValidator => () => ['rejected'];

describe('published schemas (SPEC 7.1.4)', () => {
  const ban = createBan();

  it('describes a catalog entry with constant members and stays open', () => {
    const schema = ban.format.schema(ban.catalog.NOT_FOUND, SCHEMA_CTX);
    expect(schema).toEqual({
      type: 'object',
      required: ['type', 'status', 'title'],
      properties: {
        type: { type: 'string', format: 'uri-reference' },
        status: { const: 404 },
        title: { const: 'Not Found' },
        detail: { type: 'string' },
        instance: { type: 'string', format: 'uri-reference' },
        code: { const: 'NOT_FOUND' },
        id: { type: 'string' },
        traceId: { type: 'string', pattern: '^[0-9a-f]{32}$' },
      },
      additionalProperties: true,
    });
    expect(errorSchema(ban, 'NOT_FOUND')).toEqual(schema);
  });

  it('requires errors in the validation schema and closes each entry', () => {
    const schema = ban.format.validationSchema(
      ban.catalog.VALIDATION_FAILED,
      SCHEMA_CTX,
    );
    expect(validationSchema(ban)).toEqual(schema);
    expect(schema['required']).toEqual(['type', 'status', 'title', 'errors']);
    const properties = schema['properties'] as Record<string, unknown>;
    expect(properties['errors']).toEqual({
      type: 'array',
      items: {
        type: 'object',
        required: ['location', 'detail'],
        properties: {
          location: {
            type: 'string',
            enum: ['body', 'form', 'query', 'param', 'header', 'cookie'],
          },
          pointer: { type: 'string' },
          name: { type: 'string' },
          detail: { type: 'string' },
          code: { type: 'string' },
          expected: { type: 'string' },
          received: { type: 'string' },
        },
        additionalProperties: false,
      },
    });
  });
});

describe('conformance (SPEC 7.4)', () => {
  const ban = createBan({
    errors: { ORDER_CONFLICT: { status: 409, title: 'Order Conflict' } },
  });

  it.each([
    { name: 'default options', format: problemDetails() },
    {
      name: 'renamed and disabled members',
      format: problemDetails({
        includeCode: false,
        includeId: false,
        traceIdMember: 'trace_id',
        instance: false,
      }),
    },
    {
      name: 'no trace id member',
      format: problemDetails({ traceIdMember: false }),
    },
    {
      name: 'a typeBaseUrl',
      format: problemDetails({ typeBaseUrl: TYPE_BASE }),
    },
  ])('assertFormatConformance passes with $name', ({ format }) => {
    expect(() => {
      assertFormatConformance(format, ban.catalog, { compile: compileWithAjv });
    }).not.toThrow();
  });

  it('passes with a docsBaseUrl on the instance', () => {
    const documented = createBan({
      docsBaseUrl: DOCS_BASE,
      errors: { ORDER_CONFLICT: { status: 409 } },
    });
    // Not baked into the catalog (ADR 0010); the conformance check derives
    // it from the docsBaseUrl option below, like the renderer does.
    expect(documented.catalog.ORDER_CONFLICT.type).toBeUndefined();
    expect(() => {
      assertFormatConformance(problemDetails(), documented.catalog, {
        compile: compileWithAjv,
        docsBaseUrl: DOCS_BASE,
      });
    }).not.toThrow();
  });

  it('collects every failing body into one AggregateError', () => {
    let thrown: unknown;
    try {
      assertFormatConformance(
        problemDetails(),
        { NOT_FOUND: ban.catalog.NOT_FOUND },
        { compile: rejectAll },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AggregateError);
    expect((thrown as AggregateError).errors).toHaveLength(
      CASES_PER_DEFINITION,
    );
  });
});
