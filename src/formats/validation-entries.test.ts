import { describe, expect, it } from 'vitest';

import { readLocation, toValidationEntries } from './validation-entries';

describe('readLocation', () => {
  it('reads a valid location from meta and defaults to body', () => {
    expect(readLocation({ location: 'query' })).toBe('query');
    expect(readLocation({ location: 'nope' })).toBe('body');
    expect(readLocation({})).toBe('body');
  });
});

describe('toValidationEntries', () => {
  it('uses pointers for body and form, names otherwise', () => {
    const issues = [{ path: ['items', 0, 'sku'], message: 'Required' }];
    expect(toValidationEntries(issues, 'body')).toEqual([
      { location: 'body', pointer: '/items/0/sku', detail: 'Required' },
    ]);
    expect(toValidationEntries(issues, 'form')[0]?.pointer).toBe(
      '/items/0/sku',
    );
    expect(toValidationEntries(issues, 'query')).toEqual([
      { location: 'query', name: 'items', detail: 'Required' },
    ]);
  });

  it('includes code, expected, and received only when present', () => {
    const [entry] = toValidationEntries(
      [
        {
          path: ['a'],
          message: 'm',
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
        },
      ],
      'header',
    );
    expect(entry).toEqual({
      location: 'header',
      name: 'a',
      detail: 'm',
      code: 'invalid_type',
      expected: 'string',
      received: 'number',
    });
  });
});
