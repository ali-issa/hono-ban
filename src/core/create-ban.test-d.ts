import type { Hono } from 'hono';

import type { BanError } from './ban-error';
import type { Ban, EmptyCatalog, Factory } from './types';

import { describe, expectTypeOf, it } from 'vitest';

import { createBan } from './create-ban';

type AppEnv = { Bindings: { DB: string }; Variables: { user: string } };
declare const app: Hono<AppEnv>;

describe('createBan types', () => {
  it('returns built-in factories plus custom ones', () => {
    const ban = createBan({ errors: { ORDER_CONFLICT: { status: 409 } } });
    expectTypeOf(ban.notFound).toEqualTypeOf<Factory>();
    expectTypeOf(ban.ORDER_CONFLICT).toEqualTypeOf<Factory>();
    expectTypeOf(ban.ORDER_CONFLICT()).toEqualTypeOf<BanError>();
    expectTypeOf(createBan()).toEqualTypeOf<Ban<EmptyCatalog>>();
  });

  it('accepts only known keys in error() and validationKey', () => {
    const ban = createBan({ errors: { ORDER_CONFLICT: { status: 409 } } });
    ban.error('ORDER_CONFLICT');
    ban.error('NOT_FOUND');
    // @ts-expect-error unknown key is rejected
    ban.error('NOPE');
    createBan({ errors: { A: { status: 400 } }, validationKey: 'A' });
    // @ts-expect-error unknown validation key is rejected
    createBan({ validationKey: 'NOPE' });
  });

  it('fixes code and title through the catalog (ADR 0011)', () => {
    const ban = createBan();
    // @ts-expect-error code is set by the catalog entry, not per call
    ban.notFound({ code: 'ORDER_MISSING' });
    // @ts-expect-error title is set by the catalog entry, not per call
    ban.error('NOT_FOUND', { title: 'Nope' });
    // custom() has no catalog entry and no schema, so both are free.
    ban.custom({ status: 410, code: 'REMOVED', title: 'Removed' });
  });

  it('rejects reserved keys', () => {
    // @ts-expect-error onError is an instance member
    createBan({ errors: { onError: { status: 400 } } });
    // @ts-expect-error notFound is a built-in factory name
    createBan({ errors: { notFound: { status: 404 } } });
  });

  it('produces an ErrorHandler for typed apps', () => {
    const ban = createBan();
    app.onError(ban.onError());
    app.onError(
      ban.onError<AppEnv>({
        requestId: (c) => {
          expectTypeOf(c.env.DB).toEqualTypeOf<string>();
          return c.get('user');
        },
      }),
    );
  });
});
