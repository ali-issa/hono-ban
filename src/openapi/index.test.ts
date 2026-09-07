import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';

import { createBan } from '../core/create-ban';
import { defineFormat } from '../formats/define-format';
import { jsonApi } from '../formats/json-api';
import {
  errorResponse,
  errorResponses,
  errorSchema,
  validationResponse,
  validationSchema,
} from './index';

const ban = createBan({
  errors: {
    ORDER_CONFLICT: {
      status: 409,
      description: 'The order changed underneath you',
    },
  },
});
const CT = 'application/problem+json';

describe('errorSchema and errorResponse', () => {
  it('resolve keys and statuses to the primary entry', () => {
    expect(errorSchema(ban, 404)).toEqual(errorSchema(ban, 'NOT_FOUND'));
    expect(errorSchema(ban, 400)).toMatchObject({
      properties: { code: { const: 'BAD_REQUEST' } },
    });
    expect(errorSchema(ban, 'MALFORMED_JSON')).toMatchObject({
      properties: { code: { const: 'MALFORMED_JSON' } },
    });
    expect(errorSchema(ban, 409)).toMatchObject({
      properties: { code: { const: 'CONFLICT' } },
    });
  });

  it('build a Response Object with the definition description by default', () => {
    expect(errorResponse(ban, 'ORDER_CONFLICT')).toEqual({
      description: 'The order changed underneath you',
      content: { [CT]: { schema: errorSchema(ban, 'ORDER_CONFLICT') } },
    });
    expect(
      errorResponse(ban, 404, { description: 'No such order' }).description,
    ).toBe('No such order');
  });

  it('throw RangeError for unknown keys, statuses, and CUSTOM', () => {
    expect(() => errorSchema(ban, 'NOPE')).toThrow(RangeError);
    expect(() => errorSchema(ban, 499)).toThrow(RangeError);
    expect(() => errorSchema(ban, 'CUSTOM')).toThrow(RangeError);
  });

  it('switch to enum for OpenAPI 3.0', () => {
    expect(errorSchema(ban, 404, { dialect: 'openapi-3.0' })).toMatchObject({
      properties: { status: { enum: [404] } },
    });
  });
});

describe('errorResponses', () => {
  it('groups by status and merges same-status entries with anyOf', () => {
    const responses = errorResponses(ban, [
      401,
      'NOT_FOUND',
      404,
      'BAD_REQUEST',
      'MALFORMED_JSON',
    ]);
    expect(Object.keys(responses).toSorted()).toEqual(['400', '401', '404']);
    expect(responses['404']).toEqual(errorResponse(ban, 404));
    expect(responses['400']).toEqual({
      description: 'Bad Request or Malformed JSON',
      content: {
        [CT]: {
          schema: {
            anyOf: [
              errorSchema(ban, 'BAD_REQUEST'),
              errorSchema(ban, 'MALFORMED_JSON'),
            ],
          },
        },
      },
    });
  });

  it('collapses identical schemas from a format that does not discriminate', () => {
    // One schema for every entry: `oneOf` would reject every body for
    // matching both branches; the merged response carries the schema once.
    const shape = { type: 'object', required: ['code'] };
    const api = createBan({
      format: defineFormat({
        name: 'flat',
        contentType: 'application/json',
        render: (error) => ({ code: error.code }),
        schema: () => shape,
      }),
    });
    const responses = errorResponses(api, ['BAD_REQUEST', 'MALFORMED_JSON']);
    expect(responses['400']).toEqual({
      description: 'Bad Request or Malformed JSON',
      content: { 'application/json': { schema: shape } },
    });
  });

  it('uses the format content type', () => {
    const api = createBan({ format: jsonApi() });
    expect(
      Object.keys(errorResponses(api, [404])['404']?.content ?? {}),
    ).toEqual(['application/vnd.api+json']);
  });
});

describe('validationResponse', () => {
  it('describes ban.validation() bodies for the configured key', () => {
    expect(validationResponse(ban)).toEqual({
      description: 'Validation Failed',
      content: { [CT]: { schema: validationSchema(ban) } },
    });
    expect(validationSchema(ban)['required']).toContain('errors');
    const strict = createBan({ validationKey: 'BAD_REQUEST' });
    expect(validationResponse(strict).description).toBe('Bad Request');
  });
});

describe('with @hono/zod-openapi', () => {
  it('emits the schemas verbatim in the generated document', () => {
    const app = new OpenAPIHono();
    app.openapi(
      createRoute({
        method: 'get',
        path: '/orders/{id}',
        request: { params: z.object({ id: z.string() }) },
        responses: {
          200: {
            description: 'The order',
            content: {
              'application/json': { schema: z.object({ id: z.string() }) },
            },
          },
          ...errorResponses(ban, [404, 'ORDER_CONFLICT']),
          422: validationResponse(ban),
        },
      }),
      (c) => c.json({ id: c.req.param('id') }),
    );
    const document = app.getOpenAPI31Document({
      openapi: '3.1.0',
      info: { title: 't', version: '1' },
    });
    const responses = document.paths?.['/orders/{id}']?.get
      ?.responses as Record<
      string,
      { description: string; content: Record<string, { schema: unknown }> }
    >;
    expect(responses['404']?.content[CT]?.schema).toEqual(
      errorSchema(ban, 404),
    );
    expect(responses['409']?.description).toBe(
      'The order changed underneath you',
    );
    expect(responses['422']?.content[CT]?.schema).toEqual(
      validationSchema(ban),
    );
  });
});
