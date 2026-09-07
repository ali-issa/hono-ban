import { describe, expect, it } from 'vitest';

import { assert } from './assert';
import { createBan } from './create-ban';

const ban = createBan();

describe('assert', () => {
  it('throws the produced error for null, undefined, and false', () => {
    expect(() => {
      assert(null, () => ban.notFound());
    }).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => {
      assert(undefined, () => ban.notFound());
    }).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => {
      assert(false, () => ban.forbidden());
    }).toThrow(expect.objectContaining({ status: 403 }));
  });

  it('passes other falsy values', () => {
    expect(() => {
      assert(0, () => ban.notFound());
    }).not.toThrow();
    expect(() => {
      assert('', () => ban.notFound());
    }).not.toThrow();
  });

  it('does not call the producer when the value is present', () => {
    let calls = 0;
    assert({ id: 1 }, () => {
      calls += 1;
      return ban.notFound();
    });
    expect(calls).toBe(0);
  });
});
