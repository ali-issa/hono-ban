import type { StandardJsonSchema } from '../internal/standard-schema-types';
import type { ErrorFormat } from './types';

import { describe, expectTypeOf, it } from 'vitest';

import { defineFormat } from './define-format';

declare const schema: StandardJsonSchema<unknown, { readonly code: string }>;

describe('defineFormat types', () => {
  it('types the body from the hand-written render', () => {
    const format = defineFormat({
      name: 'mini',
      contentType: 'application/json',
      render: (e) => ({ error: e.code }),
      schema: () => ({}),
    });
    expectTypeOf(format).toEqualTypeOf<ErrorFormat<{ error: string }>>();
  });

  it('types the body from the Standard JSON Schema output', () => {
    const format = defineFormat({
      name: 'std',
      contentType: 'application/json',
      schema,
      render: (e) => ({ code: e.code }),
    });
    expectTypeOf(format).toEqualTypeOf<
      ErrorFormat<{ readonly code: string }>
    >();
    defineFormat({
      name: 'std',
      contentType: 'application/json',
      schema,
      // @ts-expect-error render must return the schema output type
      render: () => ({ wrong: 1 }),
    });
  });
});
