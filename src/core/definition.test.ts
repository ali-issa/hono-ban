import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { describe, expect, it } from 'vitest';

import { reasonPhrase, resolveDefinition } from './definition';

// Hono types only official statuses; non-standard ones need a cast.
const NON_STANDARD = 499 as ContentfulStatusCode;

describe('reasonPhrase', () => {
  it('returns the IANA phrase for known statuses only', () => {
    expect(reasonPhrase(404)).toBe('Not Found');
    expect(reasonPhrase(422)).toBe('Unprocessable Content');
    expect(reasonPhrase(499)).toBeUndefined();
  });
});

describe('resolveDefinition', () => {
  it('applies every default', () => {
    expect(resolveDefinition('ORDER_CONFLICT', { status: 409 })).toEqual({
      key: 'ORDER_CONFLICT',
      status: 409,
      title: 'Conflict',
      code: 'ORDER_CONFLICT',
      type: undefined,
      description: 'Conflict',
    });
  });

  it('leaves type undefined for the format to derive (ADR 0010)', () => {
    const resolved = resolveDefinition('ORDER_CONFLICT', {
      status: 409,
      code: 'order_conflict',
    });
    expect(resolved.type).toBeUndefined();
  });

  it('keeps explicit values', () => {
    const resolved = resolveDefinition('X', {
      status: NON_STANDARD,
      title: 'Client Closed',
      type: 'https://example.com/x',
      description: 'The client went away',
    });
    expect(resolved).toMatchObject({
      title: 'Client Closed',
      type: 'https://example.com/x',
      description: 'The client went away',
    });
  });

  it('falls back to "Error" for unknown statuses without a title', () => {
    expect(resolveDefinition('X', { status: NON_STANDARD }).title).toBe(
      'Error',
    );
  });
});
