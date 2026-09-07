/**
 * The standard `google.rpc` detail payloads this format renders (SPEC 7.6.2)
 * in their proto3 JSON form: each message packed as a `google.protobuf.Any`
 * carries an `@type` member holding its type URL, field names are
 * lowerCamelCase, and fields at their default value (empty string, empty
 * repeated, empty map) are omitted.
 * @ref https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto
 * @ref https://protobuf.dev/programming-guides/json/
 * @packageDocumentation
 */
import type { ValidationIssue } from '../../validation/issue';

import { safeStringify } from '../../internal/json';

/** `google.protobuf.Any` type URLs: the `type.googleapis.com/` prefix plus the full message name. */
export const ERROR_INFO_TYPE =
  'type.googleapis.com/google.rpc.ErrorInfo' as const;
export const BAD_REQUEST_TYPE =
  'type.googleapis.com/google.rpc.BadRequest' as const;
export const RETRY_INFO_TYPE =
  'type.googleapis.com/google.rpc.RetryInfo' as const;
export const REQUEST_INFO_TYPE =
  'type.googleapis.com/google.rpc.RequestInfo' as const;
export const DEBUG_INFO_TYPE =
  'type.googleapis.com/google.rpc.DebugInfo' as const;
export const HELP_TYPE = 'type.googleapis.com/google.rpc.Help' as const;

/**
 * `google.rpc.ErrorInfo`: the machine-readable identifier AIP-193 requires
 * in every error. `reason` is the catalog code, `domain` the format option.
 * @ref https://google.aip.dev/193#errorinfo
 */
export interface GoogleApiErrorInfo {
  readonly '@type': 'type.googleapis.com/google.rpc.ErrorInfo';
  readonly reason: string;
  readonly domain: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

/** `google.rpc.BadRequest.FieldViolation`, one per validation issue. */
export interface GoogleApiFieldViolation {
  /** Dot path with `[index]` for array positions, for example `items[0].sku`. */
  readonly field?: string;
  readonly description: string;
  /** The issue code in UPPER_SNAKE_CASE, when the validator gave one. */
  readonly reason?: string;
}

export interface GoogleApiBadRequest {
  readonly '@type': 'type.googleapis.com/google.rpc.BadRequest';
  readonly fieldViolations: ReadonlyArray<GoogleApiFieldViolation>;
}

/** `google.rpc.RetryInfo`, from a delay-seconds `Retry-After` header. */
export interface GoogleApiRetryInfo {
  readonly '@type': 'type.googleapis.com/google.rpc.RetryInfo';
  /** A `google.protobuf.Duration` in JSON form, for example `30s`. */
  readonly retryDelay: string;
}

/** `google.rpc.RequestInfo` carrying the error id (SPEC 10.2). */
export interface GoogleApiRequestInfo {
  readonly '@type': 'type.googleapis.com/google.rpc.RequestInfo';
  readonly requestId: string;
}

/** `google.rpc.DebugInfo`, present only when the handler includes the stack. */
export interface GoogleApiDebugInfo {
  readonly '@type': 'type.googleapis.com/google.rpc.DebugInfo';
  readonly stackEntries: ReadonlyArray<string>;
}

export interface GoogleApiHelpLink {
  readonly description: string;
  readonly url: string;
}

/** `google.rpc.Help` with one link to the error's documentation. */
export interface GoogleApiHelp {
  readonly '@type': 'type.googleapis.com/google.rpc.Help';
  readonly links: ReadonlyArray<GoogleApiHelpLink>;
}

export type GoogleApiDetail =
  | GoogleApiErrorInfo
  | GoogleApiBadRequest
  | GoogleApiRetryInfo
  | GoogleApiRequestInfo
  | GoogleApiDebugInfo
  | GoogleApiHelp;

/**
 * `ErrorInfo.metadata` is `map<string, string>`, so every value becomes a
 * string: strings as they are, everything else as JSON. Values JSON cannot
 * represent (`undefined`, functions, symbols) are dropped.
 * @ref https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto
 */
export function toMetadata(
  meta: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const key of Object.keys(meta)) {
    const value = meta[key];
    if (typeof value === 'string') {
      metadata[key] = value;
    } else if (typeof value === 'bigint') {
      metadata[key] = value.toString();
    } else if (
      value !== undefined &&
      typeof value !== 'function' &&
      typeof value !== 'symbol'
    ) {
      metadata[key] = safeStringify(value);
    }
  }
  return metadata;
}

/**
 * `BadRequest.FieldViolation.field`: "a sequence of dot-separated identifiers"
 * with repeated-field positions in square brackets, so `['items', 0, 'sku']`
 * is `items[0].sku`. An empty path names the whole request and yields no
 * `field` (proto3 JSON omits empty strings).
 * @ref https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto
 */
export function fieldPath(path: ReadonlyArray<string | number>): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${String(segment)}]`;
    } else {
      out += out === '' ? segment : `.${segment}`;
    }
  }
  return out;
}

/**
 * `FieldViolation.reason` "should be at most 63 characters and match
 * `[A-Z][A-Z0-9_]+[A-Z0-9]`"; validator codes are lower snake case
 * (`invalid_type`), so they are upper-cased. Not validated further.
 */
export function fieldViolation(
  issue: ValidationIssue,
): GoogleApiFieldViolation {
  const field = fieldPath(issue.path);
  return {
    ...(field === '' ? {} : { field }),
    description: issue.message,
    ...(issue.code === undefined ? {} : { reason: issue.code.toUpperCase() }),
  };
}

const DELAY_SECONDS_PATTERN = /^[0-9]+$/u;

/**
 * `RetryInfo.retry_delay` from a `Retry-After` header in its delay-seconds
 * form. The HTTP-date form needs the current time to become a duration, and
 * formats are pure, so it is left out.
 * @ref https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3
 * @ref https://protobuf.dev/programming-guides/json/ (Duration)
 */
export function retryInfo(headers: Headers): GoogleApiRetryInfo | undefined {
  const value = headers.get('retry-after');
  if (value === null || !DELAY_SECONDS_PATTERN.test(value)) {
    return undefined;
  }
  return { '@type': RETRY_INFO_TYPE, retryDelay: `${value}s` };
}

/** RFC 3986 section 3.1 scheme followed by a colon: an absolute URI. */
const ABSOLUTE_URI_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/u;

/**
 * `Help.Link.url` "must be an absolute URL, including scheme", so a relative
 * `type` yields no `Help` payload.
 * @ref https://google.aip.dev/193#help
 * @ref https://www.rfc-editor.org/rfc/rfc3986#section-3.1
 */
export function help(code: string, url?: string): GoogleApiHelp | undefined {
  if (url === undefined || !ABSOLUTE_URI_PATTERN.test(url)) {
    return undefined;
  }
  return {
    '@type': HELP_TYPE,
    links: [{ description: `Documentation for ${code} errors`, url }],
  };
}
