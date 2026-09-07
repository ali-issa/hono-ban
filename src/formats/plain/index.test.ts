import { describe, expect, it } from 'vitest';

import { createBan } from '../../core/create-ban';
import { compileWithAjv } from '../../test-support/ajv';
import { assertFormatConformance } from '../../testing';
import { plain } from './index';

const ban = createBan({ format: plain() });

describe('plain()', () => {
  it('renders a closed shape with meta nested', () => {
    const error = ban.tooManyRequests('Slow down', {
      meta: { limit: 100, x: 1 },
      id: 'e1',
    });
    const body = ban.render(error, { instance: '/a', traceId: 't' }).body;
    expect(body).toEqual({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
      title: 'Too Many Requests',
      detail: 'Slow down',
      id: 'e1',
      instance: '/a',
      traceId: 't',
      meta: { limit: 100, x: 1 },
    });
  });

  it('omits empty meta and optional members', () => {
    const body = ban.render(ban.notFound({ id: 'e2' })).body;
    expect(body).toEqual({
      status: 404,
      code: 'NOT_FOUND',
      title: 'Not Found',
      id: 'e2',
    });
  });

  it('renders validation issues with a default detail', () => {
    const error = ban.validation([{ path: ['a', 'b'], message: 'Required' }], {
      location: 'body',
    });
    expect(ban.render(error).body).toMatchObject({
      detail: 'Request validation failed',
      errors: [{ location: 'body', pointer: '/a/b', detail: 'Required' }],
    });
  });

  it('conforms to its own schema', () => {
    expect(() => {
      assertFormatConformance(plain(), ban.catalog, {
        compile: compileWithAjv,
      });
    }).not.toThrow();
  });

  it('uses application/json', () => {
    expect(plain().contentType).toBe('application/json');
    expect(ban.render(ban.notFound()).headers.get('content-type')).toBe(
      'application/json',
    );
  });
});
