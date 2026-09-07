import type { BanError, RenderedError } from '../../core/ban-error';
import type { RenderOptions } from '../context';
import type { JsonApiBody } from './index';

import { describe, expect, it } from 'vitest';

import { createBan } from '../../core/create-ban';
import { compileWithAjv } from '../../test-support/ajv';
import { assertFormatConformance } from '../../testing';
import { jsonApi } from './index';

const ban = createBan({
  format: jsonApi(),
  docsBaseUrl: 'https://errors.example.com',
});

function toBody(rendered: RenderedError): JsonApiBody {
  return rendered.body as JsonApiBody;
}

function render(error: BanError, options?: RenderOptions): JsonApiBody {
  return toBody(ban.render(error, options));
}

describe('jsonApi().render', () => {
  it('renders one error object with status as a string and meta nested', () => {
    const error = ban.conflict('Already shipped', {
      meta: { sku: 'A', x: 1 },
      id: 'e1',
    });
    const body = ban.render(error, {
      traceId: 't1',
      instance: '/orders/1',
    }).body;
    expect(body).toEqual({
      errors: [
        {
          id: 'e1',
          links: { type: 'https://errors.example.com/CONFLICT' },
          status: '409',
          code: 'CONFLICT',
          title: 'Conflict',
          detail: 'Already shipped',
          meta: { sku: 'A', x: 1, traceId: 't1' },
        },
      ],
    });
  });

  it('omits links, detail, and meta when there is nothing to say', () => {
    const bare = createBan({ format: jsonApi() });
    expect(bare.render(bare.notFound({ id: 'e2' })).body).toEqual({
      errors: [
        { id: 'e2', status: '404', code: 'NOT_FOUND', title: 'Not Found' },
      ],
    });
  });

  it('supports about links, disabling the id, and renaming the trace key', () => {
    const custom = createBan({
      format: jsonApi({
        includeId: false,
        traceIdMetaKey: 'trace',
        aboutLink: (error) => `https://status.example.com/${error.id}`,
        typeLinkBaseUrl: 'https://types',
      }),
    });
    const error = custom.gone({ id: 'e3' });
    const [object] = toBody(custom.render(error, { traceId: 't' })).errors;
    expect(object).toEqual({
      links: {
        type: 'https://types/GONE',
        about: 'https://status.example.com/e3',
      },
      status: '410',
      code: 'GONE',
      title: 'Gone',
      meta: { trace: 't' },
    });
    expect(
      custom.render(error, { traceId: 't' }).headers.get('content-type'),
    ).toBe('application/vnd.api+json');
  });

  it('puts the stack into meta', () => {
    const error = ban.internalServerError({ cause: new Error('root') });
    const [object] = render(error, { includeStack: true }).errors;
    expect(object?.meta?.['stack']).toContain('root');
  });
});

describe('jsonApi().renderValidation', () => {
  const issues = [
    { path: ['items', 0, 'sku'], message: 'Required', code: 'invalid_type' },
    { path: ['a/b'], message: 'Bad', expected: 'string', received: 'number' },
  ];

  it('renders one error object per issue with source by location', () => {
    const rendered = render(ban.validation(issues, { location: 'body' }));
    expect(rendered.errors).toHaveLength(2);
    expect(rendered.errors[0]).toMatchObject({
      status: '422',
      code: 'VALIDATION_FAILED',
      title: 'Validation Failed',
      detail: 'Required',
      source: { pointer: '/items/0/sku' },
      meta: { location: 'body', code: 'invalid_type' },
    });
    expect(rendered.errors[1]).toMatchObject({
      source: { pointer: '/a~1b' },
      meta: { expected: 'string', received: 'number' },
    });
    expect(
      render(ban.validation(issues, { location: 'query' })).errors[0],
    ).toMatchObject({
      source: { parameter: 'items' },
    });
    expect(
      render(ban.validation(issues, { location: 'header' })).errors[0],
    ).toMatchObject({
      source: { header: 'items' },
    });
  });

  it('describes path and cookie parameters in meta because JSON:API has no source member for them', () => {
    for (const location of ['param', 'cookie'] as const) {
      const [object] = render(ban.validation(issues, { location })).errors;
      expect(object).not.toHaveProperty('source');
      expect(object?.meta).toMatchObject({ location, name: 'items' });
    }
  });
});

describe('jsonApi() schemas', () => {
  it('conform for every entry and stay closed', () => {
    expect(() => {
      assertFormatConformance(jsonApi(), ban.catalog, {
        compile: compileWithAjv,
      });
    }).not.toThrow();
    const schema = jsonApi().schema(ban.catalog.NOT_FOUND, {
      docsBaseUrl: undefined,
      dialect: 'draft-2020-12',
    });
    expect(schema).toMatchObject({ additionalProperties: false });
    const items = (
      schema['properties'] as Record<string, Record<string, unknown>>
    )['errors']?.['items'];
    expect(items).toMatchObject({
      properties: { status: { const: '404' }, code: { const: 'NOT_FOUND' } },
      additionalProperties: false,
    });
  });

  it('uses enum instead of const for OpenAPI 3.0', () => {
    const schema = jsonApi().schema(ban.catalog.NOT_FOUND, {
      docsBaseUrl: undefined,
      dialect: 'openapi-3.0',
    });
    const items = (
      schema['properties'] as Record<string, Record<string, unknown>>
    )['errors']?.['items'];
    expect(items).toMatchObject({ properties: { status: { enum: ['404'] } } });
  });
});
