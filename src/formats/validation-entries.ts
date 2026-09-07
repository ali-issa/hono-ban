import type { IssueLocation, ValidationIssue } from '../validation/issue';
import type { JsonSchema } from './context';

import {
  isPointerLocation,
  nameFromPath,
  pointerFromPath,
} from '../validation/issue';

/** One rendered issue, shared by the Problem Details and plain formats (SPEC 7.1.3). */
export interface ValidationEntry {
  readonly location: IssueLocation;
  /** RFC 6901 pointer for `body` and `form`. */
  readonly pointer?: string;
  /** First path segment for `query`, `param`, `header`, `cookie`. */
  readonly name?: string;
  readonly detail: string;
  readonly code?: string;
  readonly expected?: string;
  readonly received?: string;
}

const LOCATIONS: ReadonlySet<string> = new Set<IssueLocation>([
  'body',
  'form',
  'query',
  'param',
  'header',
  'cookie',
]);

/** `ban.validation()` records the location in `meta.location` (SPEC 8.2). */
function isIssueLocation(value: unknown): value is IssueLocation {
  return typeof value === 'string' && LOCATIONS.has(value);
}

export function readLocation(
  meta: Readonly<Record<string, unknown>>,
): IssueLocation {
  const value = meta['location'];
  return isIssueLocation(value) ? value : 'body';
}

export function toValidationEntries(
  issues: ReadonlyArray<ValidationIssue>,
  location: IssueLocation,
): Array<ValidationEntry> {
  const pointer = isPointerLocation(location);
  return issues.map((issue): ValidationEntry => ({
    location,
    ...(pointer
      ? { pointer: pointerFromPath(issue.path) }
      : { name: nameFromPath(issue.path) }),
    detail: issue.message,
    ...(issue.code === undefined ? {} : { code: issue.code }),
    ...(issue.expected === undefined ? {} : { expected: issue.expected }),
    ...(issue.received === undefined ? {} : { received: issue.received }),
  }));
}

const VALIDATION_ENTRY_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['location', 'detail'],
  properties: {
    location: { type: 'string', enum: [...LOCATIONS] },
    pointer: { type: 'string' },
    name: { type: 'string' },
    detail: { type: 'string' },
    code: { type: 'string' },
    expected: { type: 'string' },
    received: { type: 'string' },
  },
  additionalProperties: false,
};

export const VALIDATION_ENTRIES_SCHEMA: JsonSchema = {
  type: 'array',
  items: VALIDATION_ENTRY_SCHEMA,
};
