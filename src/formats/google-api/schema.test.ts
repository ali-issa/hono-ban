import type { GoogleApiBody } from './index';

import { describe, expect, it } from 'vitest';

import { createBan } from '../../core/create-ban';
import { compileWithAjv } from '../../test-support/ajv';
import { assertFormatConformance } from '../../testing';
import { googleApi } from './index';

const DOMAIN = 'orders.example.com';
const schemaCtx = { docsBaseUrl: undefined, dialect: 'draft-2020-12' } as const;

function body(value: unknown): GoogleApiBody {
  return value as GoogleApiBody;
}

describe('googleApi() schemas', () => {
  const ban = createBan({
    format: googleApi({ domain: DOMAIN }),
    errors: { ORDER_CONFLICT: { status: 409 } },
  });

  it('conform for every entry with defaults and with every option set', () => {
    expect(() => {
      assertFormatConformance(googleApi({ domain: DOMAIN }), ban.catalog, {
        compile: compileWithAjv,
        docsBaseUrl: 'https://errors.example.com',
      });
    }).not.toThrow();
    expect(() => {
      assertFormatConformance(
        googleApi({
          domain: DOMAIN,
          rpcCodes: { ORDER_CONFLICT: 'ALREADY_EXISTS' },
          helpLinkBaseUrl: 'https://help.example.com',
          traceIdMetadataKey: false,
          includeRequestInfo: false,
        }),
        ban.catalog,
        { compile: compileWithAjv },
      );
    }).not.toThrow();
  });

  it('pin code, status, reason, and domain and stay closed', () => {
    const schema = googleApi({ domain: DOMAIN }).schema(
      ban.catalog.ORDER_CONFLICT,
      schemaCtx,
    );
    const error = (
      schema['properties'] as Record<string, Record<string, unknown>>
    )['error'];
    expect(error).toMatchObject({
      required: ['code', 'message', 'status', 'details'],
      properties: { code: { const: 409 }, status: { const: 'ABORTED' } },
      additionalProperties: false,
    });
    const validate = compileWithAjv(schema);
    const rendered = ban.render(ban.ORDER_CONFLICT()).body;
    expect(validate(rendered)).toEqual([]);
    // A BadRequest payload is allowed only by validationSchema.
    const withBadRequest = body(
      ban.render(
        ban.validation([{ path: ['a'], message: 'x' }], { location: 'body' }),
      ).body,
    );
    expect(validate(withBadRequest)).not.toEqual([]);
    expect(
      compileWithAjv(
        googleApi({ domain: DOMAIN }).validationSchema(
          ban.catalog.VALIDATION_FAILED,
          schemaCtx,
        ),
      )(withBadRequest),
    ).toEqual([]);
  });

  it('uses enum instead of const for OpenAPI 3.0', () => {
    const schema = googleApi({ domain: DOMAIN }).schema(ban.catalog.NOT_FOUND, {
      docsBaseUrl: undefined,
      dialect: 'openapi-3.0',
    });
    expect(schema).toMatchObject({
      properties: {
        error: {
          properties: {
            code: { enum: [404] },
            status: { enum: ['NOT_FOUND'] },
          },
        },
      },
    });
    expect(JSON.stringify(schema)).not.toContain('"const"');
  });
});
