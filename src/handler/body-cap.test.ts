import { describe, expect, it } from 'vitest';

import { createBan } from '../core/create-ban';
import { capBody } from './body-cap';

const ban = createBan();
const identity = (body: unknown): unknown => body;
const redact = (body: unknown): unknown => ({
  ...(body as Record<string, unknown>),
  detail: '[redacted]',
});

describe('capBody', () => {
  it('returns the serialized body when under the cap', () => {
    const error = ban.notFound('x');
    const body = ban.render(error).body;
    expect(capBody(body, error, {}, ban.render, 65_536, identity)).toBe(
      JSON.stringify(body),
    );
  });

  it('re-renders a minimal body when over the cap', () => {
    const error = ban.badRequest({
      detail: 'd'.repeat(2000),
      meta: { blob: 'x'.repeat(10_000) },
    });
    const text = capBody(
      ban.render(error).body,
      error,
      { instance: '/p' },
      ban.render,
      1000,
      identity,
    );
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed['blob']).toBeUndefined();
    expect((parsed['detail'] as string).length).toBe(1024);
    expect(parsed['id']).toBe(error.id);
    expect(parsed['instance']).toBe('/p');
  });

  it('drops validation issues from the minimal body', () => {
    const error = ban.validation(
      Array.from({ length: 500 }, (_, i) => ({
        path: ['f', i],
        message: 'm'.repeat(50),
      })),
      { location: 'body' },
    );
    const text = capBody(
      ban.render(error).body,
      error,
      {},
      ban.render,
      2000,
      identity,
    );
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed['errors']).toBeUndefined();
    expect(parsed['status']).toBe(422);
  });

  it('runs transform on the minimal body so a redaction survives', () => {
    const error = ban.badRequest({
      detail: 'account 4111 1111 1111 1111',
      meta: { blob: 'x'.repeat(10_000) },
    });
    const text = capBody(
      redact(ban.render(error).body),
      error,
      {},
      ban.render,
      1000,
      redact,
    );
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed['blob']).toBeUndefined();
    expect(parsed['detail']).toBe('[redacted]');
    expect(text).not.toContain('4111');
  });

  it('drops the stack from the minimal body', () => {
    const error = ban.internalServerError({
      cause: new Error('root'),
      meta: { blob: 'x'.repeat(10_000) },
    });
    const options = { includeStack: true };
    const full = ban.render(error, options).body as Record<string, unknown>;
    expect(full['stack']).toBeTypeOf('string');
    const text = capBody(full, error, options, ban.render, 1000, identity);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed['stack']).toBeUndefined();
    expect(parsed['status']).toBe(500);
  });

  it('measures multi-byte characters in bytes', () => {
    const error = ban.badRequest({ meta: { text: 'é'.repeat(300) } });
    const body = ban.render(error).body;
    const text = JSON.stringify(body);
    expect(
      capBody(body, error, {}, ban.render, text.length + 100, identity),
    ).not.toBe(text);
    expect(
      capBody(body, error, {}, ban.render, text.length + 400, identity),
    ).toBe(text);
  });
});
