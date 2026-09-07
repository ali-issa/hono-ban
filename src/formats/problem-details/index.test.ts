import type { RenderContext } from '../context';

import { describe, expect, it } from 'vitest';

import { BanError } from '../../core/ban-error';
import { createBan } from '../../core/create-ban';
import { compileWithAjv } from '../../test-support/ajv';
import { assertFormatConformance } from '../../testing';
import { problemDetails } from './index';

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

describe('problemDetails().render', () => {
  it('emits standard members first, then library members', () => {
    const body = problemDetails().render(notFound, { ...ctx, traceId: 'abc' });
    expect(Object.keys(body)).toEqual([
      'type',
      'status',
      'title',
      'detail',
      'instance',
      'code',
      'id',
      'traceId',
    ]);
    expect(body).toEqual({
      type: 'about:blank',
      status: 404,
      title: 'Not Found',
      detail: 'Order 42 does not exist',
      instance: '/orders/42',
      code: 'NOT_FOUND',
      id: 'e1',
      traceId: 'abc',
    });
  });

  it('omits detail and instance when absent', () => {
    const body = problemDetails().render(
      new BanError({ status: 404, code: 'NOT_FOUND', title: 'Not Found' }),
      { ...ctx, instance: undefined },
    );
    expect(body).not.toHaveProperty('detail');
    expect(body).not.toHaveProperty('instance');
  });

  it('derives type from the error, then the base URL, then about:blank', () => {
    const typed = new BanError({ ...notFound.toInit(), type: 'https://x/y' });
    expect(problemDetails().render(typed, ctx).type).toBe('https://x/y');
    expect(
      problemDetails({ typeBaseUrl: 'https://errors.example.com' }).render(
        notFound,
        ctx,
      ).type,
    ).toBe('https://errors.example.com/NOT_FOUND');
    expect(
      problemDetails().render(notFound, { ...ctx, docsBaseUrl: 'https://docs' })
        .type,
    ).toBe('https://docs/NOT_FOUND');
    expect(problemDetails().render(notFound, ctx).type).toBe('about:blank');
  });

  it('honors the member toggles', () => {
    const body = problemDetails({
      includeCode: false,
      includeId: false,
      traceIdMember: 'trace_id',
      instance: false,
    }).render(notFound, { ...ctx, traceId: 't' });
    expect(body).toEqual({
      type: 'about:blank',
      status: 404,
      title: 'Not Found',
      detail: 'Order 42 does not exist',
      trace_id: 't',
    });
    expect(
      problemDetails({ traceIdMember: false }).render(notFound, {
        ...ctx,
        traceId: 't',
      }),
    ).not.toHaveProperty('traceId');
  });

  it('flattens meta as extension members with standard and library members winning', () => {
    const body = problemDetails().render(notFound, {
      ...ctx,
      meta: {
        status: 'nope',
        title: 'nope',
        code: 'nope',
        id: 'nope',
        retryAfter: 30,
        x: 1,
        '1st': true,
      },
    });
    expect(body).toMatchObject({
      status: 404,
      title: 'Not Found',
      code: 'NOT_FOUND',
      id: 'e1',
      retryAfter: 30,
      meta: { x: 1, '1st': true },
    });
  });

  it('never lets meta fill a reserved member the error did not emit', () => {
    const bare = new BanError({ ...notFound.toInit(), detail: undefined });
    const body = problemDetails({ traceIdMember: 'trace_id' }).render(bare, {
      ...ctx,
      instance: undefined,
      meta: {
        detail: 42,
        instance: '/x',
        traceId: 'bad',
        trace_id: 'bad',
        stack: 's',
        errors: [],
        type: 'nope',
        safe: true,
      },
    });
    expect(body).toEqual({
      type: 'about:blank',
      status: 404,
      title: 'Not Found',
      code: 'NOT_FOUND',
      id: 'e1',
      safe: true,
    });
  });

  it('adds the stack when the context carries one', () => {
    expect(
      problemDetails().render(notFound, { ...ctx, stack: 'Error: x' })['stack'],
    ).toBe('Error: x');
  });
});

describe('problemDetails() options', () => {
  it('rejects a traceIdMember that is reserved or not an extension member name', () => {
    for (const member of ['status', 'id', 'errors', 'stack', 'detail']) {
      expect(() => problemDetails({ traceIdMember: member })).toThrow(
        new TypeError(`traceIdMember "${member}" is reserved`),
      );
    }
    for (const member of ['', 'x', '1st', 'trace-id', '__proto__']) {
      expect(() => problemDetails({ traceIdMember: member })).toThrow(
        TypeError,
      );
    }
    expect(() => problemDetails({ traceIdMember: 'traceId' })).not.toThrow();
    expect(() => problemDetails({ traceIdMember: 'trace_id' })).not.toThrow();
  });
});

describe('problemDetails().renderValidation', () => {
  it('adds an errors array and a default detail', () => {
    const error = new BanError({
      status: 422,
      code: 'VALIDATION_FAILED',
      title: 'Validation Failed',
      meta: { location: 'query' },
      issues: [
        { path: ['page'], message: 'Expected number', code: 'invalid_type' },
      ],
    });
    const body = problemDetails().renderValidation(error, error.issues ?? [], {
      ...ctx,
      meta: error.meta,
    });
    expect(body).toMatchObject({
      status: 422,
      detail: 'Request validation failed',
      location: 'query',
      errors: [
        {
          location: 'query',
          name: 'page',
          detail: 'Expected number',
          code: 'invalid_type',
        },
      ],
    });
  });
});

describe('problemDetails() schemas', () => {
  it('describe the constant members and stay open for extensions', () => {
    const ban = createBan();
    const schema = problemDetails().schema(ban.catalog.NOT_FOUND, {
      docsBaseUrl: undefined,
      dialect: 'draft-2020-12',
    });
    expect(schema).toMatchObject({
      required: ['type', 'status', 'title'],
      properties: {
        status: { const: 404 },
        title: { const: 'Not Found' },
        code: { const: 'NOT_FOUND' },
      },
      additionalProperties: true,
    });
    const validation = problemDetails().validationSchema(
      ban.catalog.VALIDATION_FAILED,
      {
        docsBaseUrl: undefined,
        dialect: 'draft-2020-12',
      },
    );
    expect(validation['required']).toContain('errors');
  });

  it('conform for every catalog entry', () => {
    const ban = createBan({ errors: { ORDER_CONFLICT: { status: 409 } } });
    expect(() => {
      assertFormatConformance(problemDetails(), ban.catalog, {
        compile: compileWithAjv,
      });
    }).not.toThrow();
    expect(() => {
      assertFormatConformance(
        problemDetails({
          includeCode: false,
          traceIdMember: 'trace_id',
          instance: false,
        }),
        ban.catalog,
        { compile: compileWithAjv },
      );
    }).not.toThrow();
  });
});
