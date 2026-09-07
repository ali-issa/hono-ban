import type { BanError, BanErrorOptions } from './ban-error';
import type { BanCore } from './internal';
import type { Factory } from './types';

function isOptions(value: unknown): value is BanErrorOptions {
  return typeof value === 'object' && value !== null;
}

/**
 * Resolves the two call forms (SPEC 5.1). The first argument is `unknown` on
 * purpose: the runtime check protects JavaScript callers.
 */
export function parseFactoryArgs(
  first: unknown,
  second: BanErrorOptions | undefined,
): BanErrorOptions {
  if (first === undefined) {
    return second ?? {};
  }
  if (typeof first === 'string') {
    return { ...second, detail: first };
  }
  if (isOptions(first)) {
    return first;
  }
  throw new TypeError(
    `Expected a detail string or an options object, received ${typeof first}`,
  );
}

export function createFactory(core: BanCore, key: string): Factory {
  const definition = core.definition(key);
  return (
    first?: string | BanErrorOptions,
    second?: BanErrorOptions,
  ): BanError => core.build(definition, parseFactoryArgs(first, second));
}
