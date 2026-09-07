import { vValidator } from '@hono/valibot-validator';
import { Hono } from 'hono';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';

import { createBan } from '../core/create-ban';
import { fromValibotIssues, hook, toIssues } from './valibot';

const ban = createBan();
const { map: mapSchema } = v;
const schema = v.object({
  email: v.pipe(v.string(), v.email()),
  items: v.array(v.object({ sku: v.string() })),
  tags: mapSchema(v.string(), v.number()),
});

describe('toIssues (Valibot)', () => {
  it('keeps type, expected, received, and nested paths', () => {
    const result = v.safeParse(schema, {
      email: 'nope',
      items: [{ sku: 1 }],
      tags: new Map([['a', 'x']]),
    });
    expect(result.success).toBe(false);
    const issues = toIssues(result.issues ?? []);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['email'],
          code: 'email',
          received: '"nope"',
        }),
        expect.objectContaining({
          path: ['items', 0, 'sku'],
          code: 'string',
          expected: 'string',
          received: '1',
        }),
        expect.objectContaining({ path: ['tags', 'a'], code: 'number' }),
      ]),
    );
  });

  it('omits expected when Valibot reports null and tolerates exotic keys', () => {
    expect(
      toIssues([
        {
          type: 'custom',
          message: 'm',
          expected: null,
          received: 'x',
          path: [{ key: { object: true } }, { key: true }, { key: 3n }],
        },
      ]),
    ).toEqual([
      { path: ['?', 'true', '3'], message: 'm', code: 'custom', received: 'x' },
    ]);
  });
});

describe('fromValibotIssues', () => {
  it('builds the validation error', () => {
    const result = v.safeParse(schema, {});
    const error = fromValibotIssues(ban, result.issues ?? [], 'form');
    expect(error.status).toBe(422);
    expect(error.meta).toEqual({ location: 'form' });
  });
});

describe('hook with vValidator', () => {
  it('throws into onError', async () => {
    const app = new Hono();
    app.onError(ban.onError());
    app.post(
      '/',
      vValidator(
        'json',
        v.object({ email: v.pipe(v.string(), v.email()) }),
        hook(ban),
      ),
      (c) => c.text('ok'),
    );
    const response = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nope' }),
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ location: 'body', pointer: '/email', code: 'email' }],
    });
    const ok = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co' }),
    });
    expect(ok.status).toBe(200);
  });
});
