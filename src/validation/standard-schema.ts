/**
 * Standard Schema integration (SPEC 8.7): ArkType, Effect Schema, Zod,
 * Valibot, and anything else implementing the spec, through one interface.
 * The spec carries only `message` and `path`.
 * @ref https://standardschema.dev
 * @ref https://github.com/honojs/middleware/blob/main/packages/standard-validator/src/index.ts
 * @packageDocumentation
 */
import type { BanError } from '../core/ban-error';
import type { ValidationOptions } from '../core/types';
import type { StandardSchemaIssue } from '../internal/standard-schema-types';
import type { HookResultBase, ValidationSource } from './hook';
import type { IssueLocation, ValidationIssue } from './issue';

import { createHook } from './hook';
import { normalizeSegment } from './issue';

/** Matches `@hono/standard-validator` hook results. */
export interface StandardHookResult extends HookResultBase {
  readonly error?: ReadonlyArray<StandardSchemaIssue> | undefined;
}

export function toIssues(
  issues: ReadonlyArray<StandardSchemaIssue>,
): Array<ValidationIssue> {
  return issues.map((issue) => ({
    path: (issue.path ?? []).map((item) =>
      normalizeSegment(typeof item === 'object' ? item.key : item),
    ),
    message: issue.message,
  }));
}

export function fromIssues(
  ban: ValidationSource,
  issues: ReadonlyArray<StandardSchemaIssue>,
  location: IssueLocation,
  options: Omit<ValidationOptions, 'location'> = {},
): BanError {
  return ban.validation(toIssues(issues), { ...options, location });
}

/** Hook for `sValidator(target, schema, hook(ban))`. */
export function hook(
  ban: ValidationSource,
): (result: StandardHookResult) => void {
  return createHook<StandardHookResult>(ban, (result) =>
    result.error === undefined ? undefined : toIssues(result.error),
  );
}
