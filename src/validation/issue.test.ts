import { describe, expect, it } from 'vitest';

import {
  isPointerLocation,
  locationFromTarget,
  nameFromPath,
  normalizeSegment,
  pointerFromPath,
} from './issue';

describe('pointerFromPath', () => {
  it('escapes ~ before / per RFC 6901', () => {
    expect(pointerFromPath(['a/b'])).toBe('/a~1b');
    expect(pointerFromPath(['a~b'])).toBe('/a~0b');
    expect(pointerFromPath(['a~/b'])).toBe('/a~0~1b');
  });

  it('handles numbers, empty paths, and empty segments', () => {
    expect(pointerFromPath(['items', 0, 'sku'])).toBe('/items/0/sku');
    expect(pointerFromPath([])).toBe('');
    expect(pointerFromPath([''])).toBe('/');
  });
});

describe('normalizeSegment', () => {
  it('turns symbols into their description', () => {
    expect(normalizeSegment(Symbol('tag'))).toBe('tag');
    // oxlint-disable-next-line symbol-description -- reason: the undescribed case is what is under test
    expect(normalizeSegment(Symbol())).toBe('symbol');
    expect(normalizeSegment(3)).toBe(3);
    expect(normalizeSegment('x')).toBe('x');
  });
});

describe('nameFromPath and locations', () => {
  it('uses the first segment as the name', () => {
    expect(nameFromPath(['page', 'x'])).toBe('page');
    expect(nameFromPath([2])).toBe('2');
    expect(nameFromPath([])).toBe('');
  });

  it('maps Hono targets to locations', () => {
    expect(locationFromTarget('json')).toBe('body');
    expect(locationFromTarget('form')).toBe('form');
    expect(locationFromTarget('query')).toBe('query');
    expect(locationFromTarget('param')).toBe('param');
    expect(locationFromTarget('header')).toBe('header');
    expect(locationFromTarget('cookie')).toBe('cookie');
  });

  it('addresses body and form by pointer, everything else by name', () => {
    expect(isPointerLocation('body')).toBe(true);
    expect(isPointerLocation('form')).toBe(true);
    expect(isPointerLocation('query')).toBe(false);
  });
});
