import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createBan } from '../core/create-ban';
import { fromIssues, hook, toIssues } from './standard-schema';

const ban = createBan();

describe('toIssues (Standard Schema)', () => {
  it('reads raw keys and PathSegment objects', () => {
    expect(
      toIssues([
        { message: 'a', path: ['items', 0, { key: 'sku' }] },
        { message: 'b' },
        { message: 'c', path: [Symbol('tag')] },
      ]),
    ).toEqual([
      { path: ['items', 0, 'sku'], message: 'a' },
      { path: [], message: 'b' },
      { path: ['tag'], message: 'c' },
    ]);
  });

  it('works with real Zod and Valibot results through ~standard', async () => {
    const zodSchema = z.object({ n: z.number() });
    const zodResult = await zodSchema['~standard'].validate({ n: 'x' });
    expect(toIssues(zodResult.issues ?? [])).toEqual([
      { path: ['n'], message: expect.stringContaining('expected number') },
    ]);
    const valibotSchema = v.object({ n: v.number() });
    const valibotResult = await valibotSchema['~standard'].validate({
      n: 'x',
    });
    expect(toIssues(valibotResult.issues ?? [])[0]?.path).toEqual(['n']);
  });
});

describe('fromIssues', () => {
  it('builds the validation error', () => {
    const error = fromIssues(ban, [{ message: 'm', path: ['a'] }], 'header');
    expect(error.status).toBe(422);
    expect(error.meta).toEqual({ location: 'header' });
    expect(error.issues).toEqual([{ path: ['a'], message: 'm' }]);
  });
});

describe('hook with sValidator', () => {
  it('throws into onError for any Standard Schema library', async () => {
    const app = new Hono();
    app.onError(ban.onError());
    app.post(
      '/zod',
      sValidator('json', z.object({ email: z.email() }), hook(ban)),
      (c) => c.text('ok'),
    );
    app.get(
      '/valibot',
      sValidator(
        'query',
        v.object({ page: v.pipe(v.string(), v.digits()) }),
        hook(ban),
      ),
      (c) => c.text('ok'),
    );
    const zodResponse = await app.request('/zod', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nope' }),
    });
    expect(zodResponse.status).toBe(422);
    await expect(zodResponse.json()).resolves.toMatchObject({
      errors: [{ location: 'body', pointer: '/email' }],
    });
    const valibotResponse = await app.request('/valibot?page=x');
    expect(valibotResponse.status).toBe(422);
    await expect(valibotResponse.json()).resolves.toMatchObject({
      errors: [{ location: 'query', name: 'page' }],
    });
    expect((await app.request('/valibot?page=1')).status).toBe(200);
  });
});
