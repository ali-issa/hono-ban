import type { BanError } from '../core/ban-error';
import type { Ban, Catalog, ErrorMapper } from '../core/types';

import { HTTPException } from 'hono/http-exception';

import { isBanError } from '../core/ban-error';

export interface Resolved {
  readonly error: BanError;
  readonly handled: boolean;
}

/**
 * Thrown value to `BanError` (SPEC 6.3). A `map` that throws or returns
 * something other than `undefined` or a `BanError` is a handler failure and
 * propagates to the fallback.
 */
export function resolveThrown<TErrors extends Catalog>(
  thrown: unknown,
  ban: Ban<TErrors>,
  from: (value: unknown) => BanError,
  map: ErrorMapper<TErrors> | undefined,
): Resolved {
  if (isBanError(thrown) || thrown instanceof HTTPException) {
    return { error: from(thrown), handled: true };
  }
  if (map !== undefined) {
    const mapped: unknown = map(thrown, ban);
    if (isBanError(mapped)) {
      return { error: mapped, handled: true };
    }
    if (mapped !== undefined) {
      throw new TypeError(
        'map() must return a BanError or undefined; use ban.custom() for other shapes',
      );
    }
  }
  return { error: from(thrown), handled: false };
}
