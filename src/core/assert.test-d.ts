import type { BanError } from './ban-error';

import { describe, expectTypeOf, it } from 'vitest';

import { assert } from './assert';

interface User {
  readonly id: string;
}

declare const maybeUser: User | undefined;
declare const maybeFlag: boolean | null;
declare const produce: () => BanError;

describe('assert types', () => {
  it('narrows away undefined and null', () => {
    assert(maybeUser, produce);
    expectTypeOf(maybeUser).toEqualTypeOf<User>();
  });

  it('narrows boolean to true', () => {
    assert(maybeFlag, produce);
    expectTypeOf(maybeFlag).toEqualTypeOf<true>();
  });
});
