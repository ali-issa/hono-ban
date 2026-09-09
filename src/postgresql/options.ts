/**
 * `postgresMapper()` option types and their construction-time checks (SPEC
 * 6.10, "Construction"): every `TypeError` and `RangeError` the mapper
 * throws before it sees a first error is raised here.
 * @packageDocumentation
 */
import type { BanError } from '../core/ban-error';
import type { BuiltinKey } from '../core/catalog';
import type { ErrorDefinition } from '../core/definition';
import type { Ban, Catalog } from '../core/types';
import type { IssueLocation } from '../validation/issue';

import { assertHeadersInit } from '../handler/headers';

/** What a SQLSTATE, a class, a constraint, or a column maps to. Unset members keep the default. */
export interface PostgresMapping<TKeys extends string = never> {
  readonly key?: BuiltinKey | TKeys | undefined;
  /** Constant client-facing text; never derived from the driver error. */
  readonly detail?: string | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  readonly headers?: HeadersInit | undefined;
  readonly issue?: never;
}

export interface PostgresIssue {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
  /** Default `'body'`. */
  readonly location?: IssueLocation | undefined;
  readonly code?: string | undefined;
}

/**
 * Maps a constraint or column to `ban.validation()` with one issue, so a
 * violation reaches the client the way a validator failure does.
 */
export interface PostgresIssueMapping {
  readonly issue: PostgresIssue;
}

/** A string is the `detail`. */
export type PostgresConstraintMapping<TKeys extends string = never> =
  | string
  | PostgresMapping<TKeys>
  | PostgresIssueMapping;

export interface PostgresMapOptions<TKeys extends string = never> {
  /** By constraint name (field `n`; an index counts as a constraint). Wins over everything below. */
  readonly constraints?:
    | Readonly<Record<string, PostgresConstraintMapping<TKeys>>>
    | undefined;
  /** By `table.column` or bare `column` (fields `t` and `c`), for errors that name no constraint. */
  readonly columns?:
    | Readonly<Record<string, PostgresConstraintMapping<TKeys>>>
    | undefined;
  /** By five-character SQLSTATE or two-character class; a code wins over its class. */
  readonly codes?: Readonly<Record<string, PostgresMapping<TKeys>>> | undefined;
  /** Seconds for `Retry-After` on every 503 the mapper produces. Default: no header. */
  readonly retryAfter?: number | undefined;
}

/** A catalog that defines every custom key a mapper names. */
export type CatalogWith<TKeys extends string> = Catalog &
  Readonly<Record<Exclude<TKeys, BuiltinKey>, ErrorDefinition>>;

/**
 * Accepted as `map` by every ban whose catalog defines the custom keys the
 * options name; a mapper naming only built-in keys fits every ban.
 */
export type PostgresMapper<TKeys extends string = never> = <
  TErrors extends CatalogWith<TKeys>,
>(
  thrown: unknown,
  ban: Ban<TErrors>,
) => BanError | undefined;

/** A SQLSTATE or a class. */
const CODE_KEY_PATTERN = /^(?:[0-9A-Z]{5}|[0-9A-Z]{2})$/u;

export function isIssueMapping(
  mapping: object,
): mapping is PostgresIssueMapping {
  return 'issue' in mapping && mapping.issue !== undefined;
}

function assertMapping(group: string, name: string, mapping: unknown): void {
  if (typeof mapping === 'string') {
    return;
  }
  if (typeof mapping !== 'object' || mapping === null) {
    throw new TypeError(`${group} "${name}" must be a string or an object`);
  }
  if (isIssueMapping(mapping)) {
    const { issue } = mapping;
    if (!Array.isArray(issue.path) || typeof issue.message !== 'string') {
      throw new TypeError(
        `${group} "${name}" issue needs a path array and a message string`,
      );
    }
    return;
  }
  if ('headers' in mapping) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reason: the Headers constructor is the validator; a value of the wrong shape is exactly what this check reports
      assertHeadersInit(mapping.headers as HeadersInit | undefined);
    } catch (cause) {
      throw new TypeError(
        `${group} "${name}" headers holds an invalid header name or value`,
        { cause },
      );
    }
  }
}

export function assertOptions<TKeys extends string>(
  options: PostgresMapOptions<TKeys>,
): void {
  for (const [name, mapping] of Object.entries(options.constraints ?? {})) {
    assertMapping('constraints', name, mapping);
  }
  for (const [name, mapping] of Object.entries(options.columns ?? {})) {
    assertMapping('columns', name, mapping);
  }
  for (const [code, mapping] of Object.entries(options.codes ?? {})) {
    if (!CODE_KEY_PATTERN.test(code)) {
      throw new TypeError(
        `codes "${code}" is not a five-character SQLSTATE or a two-character class`,
      );
    }
    if (typeof mapping === 'string' || isIssueMapping(mapping)) {
      throw new TypeError(`codes "${code}" must be a mapping object`);
    }
    assertMapping('codes', code, mapping);
  }
  // `delay-seconds` is 1*DIGIT (RFC 9110 section 10.2.3); `String(1e21)` is
  // `1e+21`, so integers above the safe range are rejected too.
  // @ref https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3
  const { retryAfter } = options;
  if (
    retryAfter !== undefined &&
    (!Number.isSafeInteger(retryAfter) || retryAfter < 0)
  ) {
    throw new RangeError('retryAfter must be a non-negative safe integer');
  }
}
