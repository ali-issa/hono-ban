import type { BanError } from './ban-error';

/**
 * Throws the produced error when `value` is `null`, `undefined`, or `false`
 * and narrows it otherwise. Other falsy values (`0`, `''`) pass: the guard is
 * about presence, not truthiness.
 *
 * A standalone function rather than `ban.assert()` because TypeScript only
 * applies assertion signatures when every name in the call target has an
 * explicit type annotation (TS2775); `const ban = createBan()` has none.
 */
export function assert<T>(
  value: T,
  error: () => BanError,
): asserts value is Exclude<NonNullable<T>, false> {
  if (value === undefined || value === null || value === false) {
    throw error();
  }
}
