import type { BanError } from '../core/ban-error';
import type { BanCore } from '../core/internal';
import type { ValidationOptions } from '../core/types';
import type { ValidationIssue } from './issue';

/**
 * `ban.validation()` (SPEC 8.2). The location travels in `meta.location` so
 * every format can label issues without a dedicated field on `BanError`.
 */
export function createValidation(
  core: BanCore,
): (
  issues: ReadonlyArray<ValidationIssue>,
  options: ValidationOptions,
) => BanError {
  return (issues, options) =>
    core.build(
      core.definition(core.validationKey),
      {
        detail: options.detail,
        meta: { ...options.meta, location: options.location },
        cause: options.cause,
      },
      issues,
    );
}
