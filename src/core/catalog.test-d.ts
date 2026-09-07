import type { BuiltinKey } from './catalog';

import { describe, expectTypeOf, it } from 'vitest';

import { FACTORY_NAMES } from './catalog';

describe('catalog types', () => {
  it('maps every factory name to a built-in key', () => {
    expectTypeOf(FACTORY_NAMES).toExtend<
      Readonly<Record<string, BuiltinKey>>
    >();
    expectTypeOf(FACTORY_NAMES.notFound).toEqualTypeOf<'NOT_FOUND'>();
  });
});
