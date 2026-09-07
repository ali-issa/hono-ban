/**
 * Valibot 1.x integration (SPEC 8.6). Typed structurally: neither `valibot`
 * nor `@hono/valibot-validator` is imported.
 * @ref https://valibot.dev/api/BaseIssue/
 * @ref https://github.com/honojs/middleware/blob/main/packages/valibot-validator/src/index.ts
 * @packageDocumentation
 */
import type { BanError } from '../core/ban-error';
import type { ValidationOptions } from '../core/types';
import type { HookResultBase, ValidationSource } from './hook';
import type { IssueLocation, ValidationIssue } from './issue';

import { createHook } from './hook';
import { normalizeSegment } from './issue';

/** Every Valibot `IssuePathItem` carries a `key`; map and set keys can be anything. */
export interface ValibotPathItemLike {
  readonly key: unknown;
}

/** The subset of a Valibot `BaseIssue` this module reads. */
export interface ValibotIssueLike {
  readonly type: string;
  readonly message: string;
  readonly expected: string | null;
  readonly received: string;
  readonly path?: ReadonlyArray<ValibotPathItemLike> | undefined;
}

/** Matches `@hono/valibot-validator` hook results (`SafeParseResult & { target }`). */
export interface ValibotHookResult extends HookResultBase {
  readonly issues?: ReadonlyArray<ValibotIssueLike> | undefined;
}

function segment(key: unknown): string | number {
  if (
    typeof key === 'string' ||
    typeof key === 'number' ||
    typeof key === 'symbol'
  ) {
    return normalizeSegment(key);
  }
  if (typeof key === 'boolean' || typeof key === 'bigint') {
    return String(key);
  }
  return '?';
}

export function toIssues(
  issues: ReadonlyArray<ValibotIssueLike>,
): Array<ValidationIssue> {
  return issues.map((issue) => ({
    path: (issue.path ?? []).map((item) => segment(item.key)),
    message: issue.message,
    code: issue.type,
    ...(issue.expected === null ? {} : { expected: issue.expected }),
    received: issue.received,
  }));
}

export function fromValibotIssues(
  ban: ValidationSource,
  issues: ReadonlyArray<ValibotIssueLike>,
  location: IssueLocation,
  options: Omit<ValidationOptions, 'location'> = {},
): BanError {
  return ban.validation(toIssues(issues), { ...options, location });
}

/** Hook for `vValidator(target, schema, hook(ban))`. */
export function hook(
  ban: ValidationSource,
): (result: ValibotHookResult) => void {
  return createHook<ValibotHookResult>(ban, (result) =>
    result.issues === undefined ? undefined : toIssues(result.issues),
  );
}
