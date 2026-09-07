import type { BanError } from '../core/ban-error';
import type { ValidationOptions } from '../core/types';
import type { HookTarget, ValidationIssue } from './issue';

import { locationFromTarget } from './issue';

/** The part of a `Ban` instance the validator hooks need. */
export interface ValidationSource {
  readonly validation: (
    issues: ReadonlyArray<ValidationIssue>,
    options: ValidationOptions,
  ) => BanError;
}

/** What every Hono validator passes to its hook, structurally (SPEC 8.4). */
export interface HookResultBase {
  readonly success: boolean;
  readonly target: HookTarget;
}

/**
 * Builds a validator hook that throws `ban.validation()` on failure so the
 * error reaches `onError` and gets an id, header, report, and trace id.
 * Returning nothing on success lets the validator continue.
 */
export function createHook<TResult extends HookResultBase>(
  ban: ValidationSource,
  extract: (result: TResult) => ReadonlyArray<ValidationIssue> | undefined,
): (result: TResult) => void {
  return (result: TResult): void => {
    if (result.success) {
      return;
    }
    const issues = extract(result);
    if (issues !== undefined) {
      throw ban.validation(issues, {
        location: locationFromTarget(result.target),
      });
    }
  };
}

/** Stringifies validator-provided scalars; objects are not rendered. */
export function scalarToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return undefined;
}
