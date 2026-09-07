import type { HTTPException } from 'hono/http-exception';

import type { BanError, BanErrorInit } from './ban-error';

import { describe, expectTypeOf, it } from 'vitest';

import { isBanError } from './ban-error';

describe('BanError types', () => {
  it('is assignable to HTTPException', () => {
    expectTypeOf<BanError>().toExtend<HTTPException>();
  });

  it('rejects contentless status codes', () => {
    expectTypeOf<BanErrorInit['status']>().not.toExtend<204>();
  });

  it('narrows unknown to BanError', () => {
    expectTypeOf(isBanError).guards.toEqualTypeOf<BanError>();
  });
});
