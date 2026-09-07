import type { Hook as StandardHook } from '@hono/standard-validator';
import type { Hook as ValibotHook } from '@hono/valibot-validator';
import type { OpenAPIHonoOptions } from '@hono/zod-openapi';
import type { Hook as ZodHook } from '@hono/zod-validator';
import type { Env } from 'hono';
import type { GenericSchema } from 'valibot';
import type { ZodType } from 'zod';

import { describe, expectTypeOf, it } from 'vitest';

import { createBan } from '../core/create-ban';
import { hook as standardHook } from './standard-schema';
import { hook as valibotHook } from './valibot';
import { defaultHook, hook as zodHook } from './zod';

const ban = createBan();

describe('validator hook types', () => {
  it('fit @hono/zod-validator and @hono/zod-openapi', () => {
    expectTypeOf(zodHook(ban)).toExtend<
      ZodHook<unknown, Env, string, 'json', Record<never, never>, ZodType>
    >();
    expectTypeOf(defaultHook(ban)).toExtend<
      NonNullable<OpenAPIHonoOptions<Env>['defaultHook']>
    >();
  });

  it('fit @hono/valibot-validator', () => {
    expectTypeOf(valibotHook(ban)).toExtend<
      ValibotHook<GenericSchema, Env, string, 'json'>
    >();
  });

  it('fit @hono/standard-validator', () => {
    expectTypeOf(standardHook(ban)).toExtend<
      StandardHook<unknown, Env, string, 'json'>
    >();
  });
});
