/**
 * `postgresMapper(options?)` (SPEC 6.10, ADR 0015): an error mapper for
 * `createBan({ map })` or `ban.onError({ map })` that turns a Postgres
 * driver error into a catalog entry by SQLSTATE. The driver's `message`,
 * `detail`, and `hint` never reach `detail`, `meta`, or `headers` (ADR
 * 0007); under `includeStack` a 5xx body carries the driver error's stack
 * as SPEC 6.7 describes. The thrown value stays on `ErrorReport.cause` and
 * the driver error on `ErrorReport.error.cause`.
 * @ref https://www.postgresql.org/docs/current/errcodes-appendix.html
 * @packageDocumentation
 */
import type { BanError, BanErrorOptions } from '../core/ban-error';
import type { BuiltinKey } from '../core/catalog';
import type { ErrorDefinition } from '../core/definition';
import type { Ban, Catalog } from '../core/types';
import type { IssueLocation, ValidationIssue } from '../validation/issue';
import type { PostgresErrorFields } from './error';
import type { SqlstateDefault } from './sqlstate';

import { assertHeadersInit } from '../handler/headers';
import { UNEXPECTED_DETAIL } from '../internal/constants';
import { findPostgresError, readPostgresFields } from './error';
import { sqlstateDefault } from './sqlstate';

export type { PostgresErrorFields, PostgresErrorLike } from './error';
export { findPostgresError, readPostgresFields } from './error';

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

const SERVICE_UNAVAILABLE = 503;
const RETRY_AFTER = 'Retry-After';
const INTERNAL_KEY: BuiltinKey = 'INTERNAL_SERVER_ERROR';
/** A SQLSTATE or a class. */
const CODE_KEY_PATTERN = /^(?:[0-9A-Z]{5}|[0-9A-Z]{2})$/u;

type Lookup<TKeys extends string> = Readonly<
  Record<string, PostgresConstraintMapping<TKeys>>
>;

function isIssueMapping(mapping: object): mapping is PostgresIssueMapping {
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

function assertOptions<TKeys extends string>(
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
  const { retryAfter } = options;
  if (
    retryAfter !== undefined &&
    (!Number.isInteger(retryAfter) || retryAfter < 0)
  ) {
    throw new RangeError('retryAfter must be a non-negative integer');
  }
}

/** Own properties only: a constraint named `constructor` must not hit the prototype. */
function lookup<TKeys extends string>(
  table: Lookup<TKeys>,
  name: string | undefined,
): PostgresConstraintMapping<TKeys> | undefined {
  return name !== undefined && Object.hasOwn(table, name)
    ? table[name]
    : undefined;
}

function columnMapping<TKeys extends string>(
  columns: Lookup<TKeys>,
  fields: PostgresErrorFields,
): PostgresConstraintMapping<TKeys> | undefined {
  if (fields.column === undefined) {
    return undefined;
  }
  const qualified =
    fields.table === undefined
      ? undefined
      : lookup(columns, `${fields.table}.${fields.column}`);
  return qualified ?? lookup(columns, fields.column);
}

function toValidation<TErrors extends Catalog>(
  ban: Ban<TErrors>,
  mapping: PostgresIssueMapping,
): BanError {
  const { issue } = mapping;
  const validationIssue: ValidationIssue = {
    path: issue.path,
    message: issue.message,
    code: issue.code,
  };
  return ban.validation([validationIssue], {
    location: issue.location ?? 'body',
  });
}

function build<TKeys extends string, TErrors extends CatalogWith<TKeys>>(
  ban: Ban<TErrors>,
  mappings: ReadonlyArray<PostgresMapping<TKeys>>,
  fallback: SqlstateDefault | undefined,
  retryAfter: number | undefined,
  cause: unknown,
): BanError | undefined {
  if (mappings.length === 0 && fallback === undefined) {
    return undefined;
  }
  const key: BuiltinKey | TKeys =
    mappings.find((mapping) => mapping.key !== undefined)?.key ??
    fallback?.key ??
    INTERNAL_KEY;
  const detail =
    mappings.find((mapping) => mapping.detail !== undefined)?.detail ??
    fallback?.detail ??
    UNEXPECTED_DETAIL;
  const options: BanErrorOptions = {
    detail,
    meta: mappings.find((mapping) => mapping.meta !== undefined)?.meta,
    headers: mappings.find((mapping) => mapping.headers !== undefined)?.headers,
    cause,
  };
  const error = ban.error(key, options);
  if (
    retryAfter !== undefined &&
    error.status === SERVICE_UNAVAILABLE &&
    !error.headers.has(RETRY_AFTER)
  ) {
    error.headers.set(RETRY_AFTER, String(retryAfter));
  }
  return error;
}

/**
 * Builds the mapper. For a recognized Postgres error (`findPostgresError`)
 * the entry, detail, meta, and headers come, member by member, from the
 * first source that sets them: the `constraints` entry for its constraint
 * name, the `columns` entry for its `table.column` or `column`, `codes` for
 * its SQLSTATE, `codes` for its class, then the built-in table
 * (`sqlstate.ts`). A `constraints` or `columns` entry with `issue` returns
 * `ban.validation()` instead. A SQLSTATE with no source at any level maps
 * to `undefined`, as does a value that is not a Postgres error, so the
 * handler's own fallthrough applies. Throws `TypeError` at construction for
 * a `codes` key outside the SQLSTATE grammar, a mapping that is neither a
 * string nor an object, an `issue` without a path array and a message
 * string, or `headers` the `Headers` constructor rejects, and `RangeError`
 * for a negative or fractional `retryAfter`. A `key` the ban's catalog
 * lacks fails at map time with the `RangeError` `ban.error` throws.
 */
export function postgresMapper<TKeys extends string = never>(
  options: PostgresMapOptions<TKeys> = {},
): PostgresMapper<TKeys> {
  assertOptions(options);
  const constraints: Lookup<TKeys> = options.constraints ?? {};
  const columns: Lookup<TKeys> = options.columns ?? {};
  const codes: Readonly<Record<string, PostgresMapping<TKeys>>> =
    options.codes ?? {};
  return <TErrors extends CatalogWith<TKeys>>(
    thrown: unknown,
    ban: Ban<TErrors>,
  ): BanError | undefined => {
    const error = findPostgresError(thrown);
    if (error === undefined) {
      return undefined;
    }
    const fields = readPostgresFields(error);
    const named =
      lookup(constraints, fields.constraint) ?? columnMapping(columns, fields);
    if (typeof named === 'object' && isIssueMapping(named)) {
      return toValidation(ban, named);
    }
    const mappings: Array<PostgresMapping<TKeys>> = [];
    if (typeof named === 'string') {
      mappings.push({ detail: named });
    } else if (named !== undefined) {
      mappings.push(named);
    }
    const byCode = codes[fields.sqlstate];
    if (byCode !== undefined) {
      mappings.push(byCode);
    }
    const byClass = codes[fields.errorClass];
    if (byClass !== undefined) {
      mappings.push(byClass);
    }
    return build(
      ban,
      mappings,
      sqlstateDefault(fields.sqlstate, fields.errorClass),
      options.retryAfter,
      error,
    );
  };
}
