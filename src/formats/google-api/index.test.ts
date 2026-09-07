import type { RenderContext } from '../context';
import type { GoogleApiBody } from './index';

import { describe, expect, it } from 'vitest';

import { BanError } from '../../core/ban-error';
import { createBan } from '../../core/create-ban';
import { googleApi } from './index';

const DOMAIN = 'orders.example.com';
const ctx: RenderContext = {
  requestId: undefined,
  traceId: undefined,
  instance: '/orders/42',
  method: 'GET',
  includeStack: false,
  docsBaseUrl: undefined,
  meta: {},
  stack: undefined,
  truncated: false,
};

const notFound = new BanError({
  status: 404,
  code: 'NOT_FOUND',
  title: 'Not Found',
  detail: 'Order 42 does not exist',
  id: 'e1',
});

function body(value: unknown): GoogleApiBody {
  return value as GoogleApiBody;
}

describe('googleApi().render', () => {
  it('renders the AIP-193 HTTP/1.1+JSON shape with ErrorInfo first', () => {
    const rendered = googleApi({ domain: DOMAIN }).render(notFound, {
      ...ctx,
      docsBaseUrl: 'https://errors.example.com',
      traceId: 't1',
      meta: { zone: 'us-east1-a', attempts: 2 },
    });
    expect(Object.keys(rendered.error)).toEqual([
      'code',
      'message',
      'status',
      'details',
    ]);
    expect(rendered).toEqual({
      error: {
        code: 404,
        message: 'Order 42 does not exist',
        status: 'NOT_FOUND',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'NOT_FOUND',
            domain: DOMAIN,
            metadata: { zone: 'us-east1-a', attempts: '2', traceId: 't1' },
          },
          {
            '@type': 'type.googleapis.com/google.rpc.RequestInfo',
            requestId: 'e1',
          },
          {
            '@type': 'type.googleapis.com/google.rpc.Help',
            links: [
              {
                description: 'Documentation for NOT_FOUND errors',
                url: 'https://errors.example.com/NOT_FOUND',
              },
            ],
          },
        ],
      },
    });
  });

  it('falls back to the title as message and omits empty metadata and Help', () => {
    const bare = new BanError({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not Found',
      id: 'e2',
    });
    expect(googleApi({ domain: DOMAIN }).render(bare, ctx)).toEqual({
      error: {
        code: 404,
        message: 'Not Found',
        status: 'NOT_FOUND',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            reason: 'NOT_FOUND',
            domain: DOMAIN,
          },
          {
            '@type': 'type.googleapis.com/google.rpc.RequestInfo',
            requestId: 'e2',
          },
        ],
      },
    });
  });

  it('derives status from the code name, the HTTP status, or the rpcCodes option', () => {
    const ban = createBan({
      format: googleApi({
        domain: DOMAIN,
        rpcCodes: { SKU_TAKEN: 'ALREADY_EXISTS' },
      }),
      errors: {
        ORDER_CONFLICT: { status: 409 },
        SKU_TAKEN: { status: 409 },
        TEAPOT: { status: 418 },
      },
    });
    const status = (error: BanError): string =>
      body(ban.render(error).body).error.status;
    expect(status(ban.notFound())).toBe('NOT_FOUND');
    expect(status(ban.unauthorized())).toBe('UNAUTHENTICATED');
    expect(status(ban.ORDER_CONFLICT())).toBe('ABORTED');
    expect(status(ban.SKU_TAKEN())).toBe('ALREADY_EXISTS');
    expect(status(ban.TEAPOT())).toBe('FAILED_PRECONDITION');
    expect(status(ban.badGateway())).toBe('INTERNAL');
    expect(status(ban.validation([], { location: 'body' }))).toBe(
      'FAILED_PRECONDITION',
    );
  });

  it('adds RetryInfo from a delay-seconds Retry-After and DebugInfo from the stack', () => {
    const error = new BanError({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      title: 'Too Many Requests',
      headers: { 'Retry-After': '30' },
      id: 'e3',
    });
    const rendered = googleApi({ domain: DOMAIN }).render(error, {
      ...ctx,
      stack: 'Error: x\n    at a\n    at b',
    });
    expect(rendered.error.status).toBe('RESOURCE_EXHAUSTED');
    expect(rendered.error.details.map((detail) => detail['@type'])).toEqual([
      'type.googleapis.com/google.rpc.ErrorInfo',
      'type.googleapis.com/google.rpc.RetryInfo',
      'type.googleapis.com/google.rpc.RequestInfo',
      'type.googleapis.com/google.rpc.DebugInfo',
    ]);
    expect(rendered.error.details[1]).toEqual({
      '@type': 'type.googleapis.com/google.rpc.RetryInfo',
      retryDelay: '30s',
    });
    expect(rendered.error.details[3]).toEqual({
      '@type': 'type.googleapis.com/google.rpc.DebugInfo',
      stackEntries: ['Error: x', '    at a', '    at b'],
    });
  });

  it('honors helpLinkBaseUrl over docsBaseUrl, an explicit type over both, and the toggles', () => {
    const format = googleApi({
      domain: DOMAIN,
      helpLinkBaseUrl: 'https://help.example.com',
      traceIdMetadataKey: 'trace',
      includeRequestInfo: false,
    });
    const rendered = format.render(notFound, {
      ...ctx,
      docsBaseUrl: 'https://errors.example.com',
      traceId: 't',
    });
    expect(rendered.error.details).toEqual([
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'NOT_FOUND',
        domain: DOMAIN,
        metadata: { trace: 't' },
      },
      {
        '@type': 'type.googleapis.com/google.rpc.Help',
        links: [
          {
            description: 'Documentation for NOT_FOUND errors',
            url: 'https://help.example.com/NOT_FOUND',
          },
        ],
      },
    ]);
    const typed = new BanError({ ...notFound.toInit(), type: 'https://x/y' });
    expect(format.render(typed, ctx).error.details[1]).toMatchObject({
      links: [{ url: 'https://x/y' }],
    });
    const relative = new BanError({ ...notFound.toInit(), type: '/errors/y' });
    expect(format.render(relative, ctx).error.details).toHaveLength(1);
    expect(
      googleApi({ domain: DOMAIN, traceIdMetadataKey: false }).render(
        notFound,
        {
          ...ctx,
          traceId: 't',
        },
      ).error.details[0],
    ).not.toHaveProperty('metadata');
  });
});

describe('googleApi().renderValidation', () => {
  it('adds one BadRequest with a field violation per issue', () => {
    const ban = createBan({ format: googleApi({ domain: DOMAIN }) });
    const error = ban.validation(
      [
        {
          path: ['items', 0, 'sku'],
          message: 'Required',
          code: 'invalid_type',
        },
        { path: [], message: 'Unknown keys' },
      ],
      { location: 'body', meta: { orderId: 7 } },
    );
    const rendered = body(ban.render(error).body);
    expect(rendered.error).toMatchObject({
      code: 422,
      message: 'Request validation failed',
      status: 'FAILED_PRECONDITION',
    });
    expect(rendered.error.details[0]).toEqual({
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason: 'VALIDATION_FAILED',
      domain: DOMAIN,
      metadata: { orderId: '7', location: 'body' },
    });
    expect(rendered.error.details[1]).toEqual({
      '@type': 'type.googleapis.com/google.rpc.BadRequest',
      fieldViolations: [
        {
          field: 'items[0].sku',
          description: 'Required',
          reason: 'INVALID_TYPE',
        },
        { description: 'Unknown keys' },
      ],
    });
  });
});
