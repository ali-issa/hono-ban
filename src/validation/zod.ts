/**
 * Zod 3.25+ and Zod 4 integration (SPEC 8.5). Everything is typed
 * structurally: neither `zod` nor `@hono/zod-validator` is imported.
 * @ref https://zod.dev/error-formatting
 * @ref https://github.com/honojs/middleware/blob/main/packages/zod-validator/src/index.ts
 * @ref https://github.com/honojs/middleware/blob/main/packages/zod-openapi/src/index.ts
 * @packageDocumentation
 */
import type { BanError } from '../core/ban-error';
import type { ValidationOptions } from '../core/types';
import type { HookResultBase, ValidationSource } from './hook';
import type { IssueLocation, ValidationIssue } from './issue';

import { createHook, scalarToString } from './hook';
import { normalizeSegment } from './issue';

/** The subset of a Zod 3 `ZodIssue` or Zod 4 `$ZodIssue` this module reads. */
export interface ZodIssueLike {
  readonly code?: string | undefined;
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
  readonly expected?: unknown;
  readonly received?: unknown;
}

export interface ZodErrorLike {
  readonly issues: ReadonlyArray<ZodIssueLike>;
}

/** Matches `@hono/zod-validator` and `@hono/zod-openapi` hook results. */
export interface ZodHookResult extends HookResultBase {
  readonly error?: ZodErrorLike | undefined;
}

export function toIssues(error: ZodErrorLike): Array<ValidationIssue> {
  return error.issues.map((issue) => ({
    path: issue.path.map(normalizeSegment),
    message: issue.message,
    ...(issue.code === undefined ? {} : { code: issue.code }),
    ...(scalarToString(issue.expected) === undefined
      ? {}
      : { expected: scalarToString(issue.expected) }),
    ...(scalarToString(issue.received) === undefined
      ? {}
      : { received: scalarToString(issue.received) }),
  }));
}

export function fromZodError(
  ban: ValidationSource,
  error: ZodErrorLike,
  location: IssueLocation,
  options: Omit<ValidationOptions, 'location'> = {},
): BanError {
  return ban.validation(toIssues(error), { ...options, location });
}

/** Hook for `zValidator(target, schema, hook(ban))`. */
export function hook(ban: ValidationSource): (result: ZodHookResult) => void {
  return createHook<ZodHookResult>(ban, (result) =>
    result.error === undefined ? undefined : toIssues(result.error),
  );
}

/** Hook for `new OpenAPIHono({ defaultHook: defaultHook(ban) })`. */
export function defaultHook(
  ban: ValidationSource,
): (result: ZodHookResult) => void {
  return hook(ban);
}
