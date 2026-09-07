import type { RenderContext } from '../context';
import type { StripeBody } from './index';

import { describe, expect, it } from 'vitest';

import { BanError } from '../../core/ban-error';
import { createBan } from '../../core/create-ban';
import { compileWithAjv } from '../../test-support/ajv';
import { assertFormatConformance } from '../../testing';
import { stripe } from './index';

const ctx: RenderContext = {
  requestId: undefined,
  traceId: undefined,
  instance: '/v1/orders/42',
  method: 'GET',
  includeStack: false,
  docsBaseUrl: undefined,
  meta: {},
  stack: undefined,
  truncated: false,
};
const schemaCtx = { docsBaseUrl: undefined, dialect: 'draft-2020-12' } as const;

function body(value: unknown): StripeBody {
  return value as StripeBody;
}

describe('stripe().render', () => {
  it('renders Stripe members in alphabetical order with the code in lower snake case', () => {
    const error = new BanError({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not Found',
      detail: "No such order: 'ord_42'",
      id: 'e1',
    });
    const rendered = stripe().render(error, {
      ...ctx,
      docsBaseUrl: 'https://errors.example.com',
    });
    expect(Object.keys(rendered.error)).toEqual([
      'code',
      'doc_url',
      'message',
      'type',
    ]);
    expect(rendered).toEqual({
      error: {
        code: 'not_found',
        doc_url: 'https://errors.example.com/NOT_FOUND',
        message: "No such order: 'ord_42'",
        type: 'invalid_request_error',
      },
    });
  });

  it('classifies type by status the way Stripe does and lets types override it', () => {
    const ban = createBan({
      format: stripe({ types: { KEY_REUSED: 'idempotency_error' } }),
      errors: { KEY_REUSED: { status: 400 }, TEAPOT: { status: 418 } },
    });
    const type = (error: BanError): string =>
      body(ban.render(error).body).error.type;
    expect(type(ban.badRequest())).toBe('invalid_request_error');
    expect(type(ban.unauthorized())).toBe('invalid_request_error');
    expect(type(ban.paymentRequired())).toBe('card_error');
    expect(type(ban.forbidden())).toBe('invalid_request_error');
    expect(type(ban.tooManyRequests())).toBe('invalid_request_error');
    expect(type(ban.TEAPOT())).toBe('invalid_request_error');
    expect(type(ban.internalServerError())).toBe('api_error');
    expect(type(ban.serviceUnavailable())).toBe('api_error');
    expect(type(ban.KEY_REUSED())).toBe('idempotency_error');
  });

  it('uses the title without a detail, an explicit type as doc_url, and requestLogUrl', () => {
    const format = stripe({
      docUrlBaseUrl: 'https://docs.example.com/errors',
      requestLogUrl: (error) =>
        `https://dashboard.example.com/logs/${error.id}`,
    });
    const bare = new BanError({
      status: 410,
      code: 'GONE',
      title: 'Gone',
      id: 'e2',
    });
    expect(
      format.render(bare, { ...ctx, docsBaseUrl: 'https://other' }),
    ).toEqual({
      error: {
        code: 'gone',
        doc_url: 'https://docs.example.com/errors/GONE',
        message: 'Gone',
        request_log_url: 'https://dashboard.example.com/logs/e2',
        type: 'invalid_request_error',
      },
    });
    const typed = new BanError({ ...bare.toInit(), type: 'https://x/y' });
    expect(format.render(typed, ctx).error.doc_url).toBe('https://x/y');
    expect(stripe().render(bare, ctx).error).not.toHaveProperty('doc_url');
    expect(
      stripe({
        requestLogUrl: (error) => (error.id === 'never' ? 'x' : undefined),
      }).render(bare, ctx).error,
    ).not.toHaveProperty('request_log_url');
  });

  it('never carries meta, the id, the trace id, or the stack', () => {
    const error = new BanError({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
      title: 'Internal Server Error',
      meta: { secret: 1 },
      id: 'e3',
    });
    const text = JSON.stringify(
      stripe().render(error, { ...ctx, traceId: 't', stack: 'Error: x' }),
    );
    expect(text).toBe(
      '{"error":{"code":"internal_server_error","message":"Internal Server Error","type":"api_error"}}',
    );
  });
});

describe('stripe().renderValidation', () => {
  const ban = createBan({ format: stripe() });
  const issues = [
    { path: ['items', 0, 'sku'], message: 'Required', code: 'invalid_type' },
    { path: ['page'], message: 'Expected number' },
  ];

  it('renders the first issue as message and param in bracket notation', () => {
    expect(
      ban.render(ban.validation(issues, { location: 'body' })).body,
    ).toEqual({
      error: {
        code: 'validation_failed',
        message: 'Required',
        param: 'items[0][sku]',
        type: 'invalid_request_error',
      },
    });
    expect(
      body(
        ban.render(ban.validation(issues.slice(1), { location: 'query' })).body,
      ).error,
    ).toMatchObject({ message: 'Expected number', param: 'page' });
  });

  it('falls back to detail or title without issues and omits param for an empty path', () => {
    expect(
      body(
        ban.render(ban.validation([], { location: 'body', detail: 'Invalid' }))
          .body,
      ).error,
    ).toMatchObject({ message: 'Invalid' });
    expect(
      body(ban.render(ban.validation([], { location: 'body' })).body).error,
    ).toEqual({
      code: 'validation_failed',
      message: 'Request validation failed',
      type: 'invalid_request_error',
    });
    const whole = body(
      ban.render(
        ban.validation([{ path: [], message: 'Not an object' }], {
          location: 'body',
        }),
      ).body,
    );
    expect(whole.error).toEqual({
      code: 'validation_failed',
      message: 'Not an object',
      type: 'invalid_request_error',
    });
  });
});

describe('stripe() schemas', () => {
  const ban = createBan({
    format: stripe(),
    errors: { ORDER_CONFLICT: { status: 409 } },
  });

  it('conform for every entry with defaults and with every option set', () => {
    expect(() => {
      assertFormatConformance(stripe(), ban.catalog, {
        compile: compileWithAjv,
        docsBaseUrl: 'https://errors.example.com',
      });
    }).not.toThrow();
    expect(() => {
      assertFormatConformance(
        stripe({
          docUrlBaseUrl: 'https://docs.example.com',
          types: { ORDER_CONFLICT: 'idempotency_error' },
          requestLogUrl: (error) => `https://logs.example.com/${error.id}`,
        }),
        ban.catalog,
        { compile: compileWithAjv },
      );
    }).not.toThrow();
  });

  it('pin code and type, allow param only for validation, and stay closed', () => {
    const schema = stripe().schema(ban.catalog.ORDER_CONFLICT, schemaCtx);
    expect(schema).toMatchObject({
      required: ['error'],
      properties: {
        error: {
          required: ['code', 'message', 'type'],
          properties: {
            code: { const: 'order_conflict' },
            type: { const: 'invalid_request_error' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    });
    const error = (
      schema['properties'] as Record<string, Record<string, unknown>>
    )['error'];
    expect(error?.['properties']).not.toHaveProperty('param');
    expect(error?.['properties']).not.toHaveProperty('request_log_url');
    const validation = stripe().validationSchema(
      ban.catalog.VALIDATION_FAILED,
      schemaCtx,
    );
    expect(
      compileWithAjv(validation)({
        error: {
          code: 'validation_failed',
          message: 'Required',
          param: 'items[0][sku]',
          type: 'invalid_request_error',
        },
      }),
    ).toEqual([]);
  });

  it('uses enum instead of const for OpenAPI 3.0', () => {
    const schema = stripe().schema(ban.catalog.NOT_FOUND, {
      docsBaseUrl: undefined,
      dialect: 'openapi-3.0',
    });
    expect(schema).toMatchObject({
      properties: {
        error: {
          properties: {
            code: { enum: ['not_found'] },
            type: { enum: ['invalid_request_error'] },
          },
        },
      },
    });
  });
});
