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
import type { Ban, Catalog } from '../core/types';
import type { ValidationIssue } from '../validation/issue';
import type { PostgresErrorFields } from './error';
import type {
  CatalogWith,
  PostgresConstraintMapping,
  PostgresIssueMapping,
  PostgresMapOptions,
  PostgresMapper,
  PostgresMapping,
} from './options';
import type { SqlstateDefault } from './sqlstate';

import { UNEXPECTED_DETAIL } from '../internal/constants';
import { findPostgresError, readPostgresFields } from './error';
import { assertOptions, isIssueMapping } from './options';
import { sqlstateDefault } from './sqlstate';

export type { PostgresErrorFields, PostgresErrorLike } from './error';
export { findPostgresError, readPostgresFields } from './error';
export type {
  CatalogWith,
  PostgresConstraintMapping,
  PostgresIssue,
  PostgresIssueMapping,
  PostgresMapOptions,
  PostgresMapper,
  PostgresMapping,
} from './options';

const SERVICE_UNAVAILABLE = 503;
const RETRY_AFTER = 'Retry-After';
const INTERNAL_KEY: BuiltinKey = 'INTERNAL_SERVER_ERROR';
type Lookup<TKeys extends string> = Readonly<
  Record<string, PostgresConstraintMapping<TKeys>>
>;

/**
 * Own properties only: a constraint named `constructor` must not hit the
 * prototype, and an entry inherited by a `codes` object built on a custom
 * prototype was never validated by `assertOptions`, which reads own
 * properties too.
 */
function lookup<TValue>(
  table: Readonly<Record<string, TValue>>,
  name: string | undefined,
): TValue | undefined {
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

/**
 * The driver error travels as `cause` here as well, so
 * `ErrorReport.error.cause` holds it for every mapping kind (SPEC 6.10).
 */
function toValidation<TErrors extends Catalog>(
  ban: Ban<TErrors>,
  mapping: PostgresIssueMapping,
  cause: unknown,
): BanError {
  const { issue } = mapping;
  const validationIssue: ValidationIssue = {
    path: issue.path,
    message: issue.message,
    code: issue.code,
  };
  return ban.validation([validationIssue], {
    location: issue.location ?? 'body',
    cause,
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
 * for a `retryAfter` that is not a non-negative safe integer. A `key` the
 * ban's catalog lacks fails at map time with the `RangeError` `ban.error`
 * throws.
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
      return toValidation(ban, named, error);
    }
    const mappings: Array<PostgresMapping<TKeys>> = [];
    if (typeof named === 'string') {
      mappings.push({ detail: named });
    } else if (named !== undefined) {
      mappings.push(named);
    }
    const byCode = lookup(codes, fields.sqlstate);
    if (byCode !== undefined) {
      mappings.push(byCode);
    }
    const byClass = lookup(codes, fields.errorClass);
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
