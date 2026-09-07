/**
 * Default SQLSTATE mapping (SPEC 6.10, ADR 0015). A code is looked up
 * first, then its two-character class; a code or class with no row maps to
 * nothing, so the handler's own fallthrough applies (a constant 500 with
 * `handled: false`). Every detail here is a constant: nothing from the
 * server's `message`, `detail`, or `hint` is ever forwarded (ADR 0007).
 *
 * The rules behind the rows:
 * - 409 for a change that conflicts with the current state (a duplicate, a
 *   missing or still-referenced row); 422 for a value the server understood
 *   but cannot accept (missing, out of range, failing a check).
 * - 503 only where the same request is expected to succeed after a delay:
 *   serialization failures and deadlocks (Postgres documents retrying the
 *   transaction as the remedy), a lock a `NOWAIT` could not take, a
 *   read-only replica during failover, and the connection, resource, and
 *   operator classes. `Retry-After` is attached only to these.
 * - Excluded from their class default (`UNMAPPED`): the two codes meaning
 *   the commit outcome is unknown (a retry could apply a write twice),
 *   `temp_file_limit` (per query, fails again), `query_canceled` (a
 *   statement timeout, an operator cancel, or the client's own abort; the
 *   SQLSTATE cannot tell overload from a query that is always too slow), and
 *   the class 22 codes raised by the application's own SQL rather than by a
 *   client value (sequence exhaustion, `COPY` input, arithmetic).
 * @ref https://www.postgresql.org/docs/current/errcodes-appendix.html
 * @ref https://www.postgresql.org/docs/current/transaction-iso.html
 * @ref https://www.postgresql.org/docs/current/runtime-config-client.html
 * @ref https://www.rfc-editor.org/rfc/rfc9110#section-9.2.2
 * @ref https://www.rfc-editor.org/rfc/rfc9110#section-15.5.10
 * @ref https://www.rfc-editor.org/rfc/rfc9110#section-15.5.21
 * @ref https://www.rfc-editor.org/rfc/rfc9110#section-15.6.4
 * @ref https://docs.postgrest.org/en/stable/references/errors.html
 * @ref https://github.com/pgbouncer/pgbouncer/blob/master/src/proto.c
 * @packageDocumentation
 */
import type { BuiltinKey } from '../core/catalog';

export interface SqlstateDefault {
  readonly key: BuiltinKey;
  readonly detail: string;
}

const UNAVAILABLE_DETAIL = 'Temporarily unavailable, try again later';
const CONSTRAINT_DETAIL = 'A value violates a constraint';

const CONFLICT_DUPLICATE: SqlstateDefault = {
  key: 'CONFLICT',
  detail: 'A record with the same value already exists',
};
const CONFLICT_OVERLAP: SqlstateDefault = {
  key: 'CONFLICT',
  detail: 'A record overlaps an existing one',
};
const CONFLICT_REFERENCE: SqlstateDefault = {
  key: 'CONFLICT',
  detail: 'A referenced record does not exist or is still in use',
};
const CONFLICT_IN_USE: SqlstateDefault = {
  key: 'CONFLICT',
  detail: 'A record is still in use',
};
const CONFLICT_CHANGE: SqlstateDefault = {
  key: 'CONFLICT',
  detail: 'The change conflicts with existing records',
};
const MISSING_VALUE: SqlstateDefault = {
  key: 'UNPROCESSABLE_CONTENT',
  detail: 'A required value is missing',
};
const INVALID_VALUE: SqlstateDefault = {
  key: 'UNPROCESSABLE_CONTENT',
  detail: 'A value is invalid or out of range',
};
const UNPROCESSABLE_CONSTRAINT: SqlstateDefault = {
  key: 'UNPROCESSABLE_CONTENT',
  detail: CONSTRAINT_DETAIL,
};
const UNAVAILABLE: SqlstateDefault = {
  key: 'SERVICE_UNAVAILABLE',
  detail: UNAVAILABLE_DETAIL,
};

/**
 * Per-code rows. Class 23 splits by condition. 23001 (`restrict_violation`)
 * is raised from PostgreSQL 18 for `ON DELETE RESTRICT`; earlier versions
 * raise 23503 for the same action. 40002 is defined by the standard but not
 * raised by PostgreSQL, which reports deferred constraint failures at commit
 * under their class 23 codes; the row serves wire-compatible servers.
 */
const BY_CODE: Readonly<Record<string, SqlstateDefault>> = {
  // unique_violation
  '23505': CONFLICT_DUPLICATE,
  // exclusion_violation
  '23P01': CONFLICT_OVERLAP,
  // foreign_key_violation, in both directions
  '23503': CONFLICT_REFERENCE,
  // restrict_violation
  '23001': CONFLICT_IN_USE,
  // not_null_violation
  '23502': MISSING_VALUE,
  // check_violation
  '23514': UNPROCESSABLE_CONSTRAINT,
  // transaction_integrity_constraint_violation
  '40002': CONFLICT_CHANGE,
  // serialization_failure
  '40001': UNAVAILABLE,
  // deadlock_detected
  '40P01': UNAVAILABLE,
  // lock_not_available
  '55P03': UNAVAILABLE,
  // read_only_sql_transaction
  '25006': UNAVAILABLE,
};

/** Codes excluded from their class row; see the module comment. */
const UNMAPPED: ReadonlySet<string> = new Set([
  // transaction_resolution_unknown
  '08007',
  // statement_completion_unknown
  '40003',
  // configuration_limit_exceeded
  '53400',
  // query_canceled
  '57014',
  // sequence_generator_limit_exceeded
  '2200H',
  // bad_copy_file_format
  '22P04',
  // division_by_zero
  '22012',
]);

/**
 * Per-class rows. Class 08 includes 08P01 (`protocol_violation`), which
 * PostgreSQL raises for a client protocol mistake but which PgBouncer sends
 * as the default SQLSTATE of every pooler error (queue and login timeouts,
 * connection limits, shutdown); the transient reading wins by default and
 * `codes: { '08P01': ... }` selects the other.
 */
const BY_CLASS: Readonly<Record<string, SqlstateDefault>> = {
  // data_exception
  '22': INVALID_VALUE,
  // integrity_constraint_violation
  '23': UNPROCESSABLE_CONSTRAINT,
  // connection_exception
  '08': UNAVAILABLE,
  // transaction_rollback
  '40': UNAVAILABLE,
  // insufficient_resources
  '53': UNAVAILABLE,
  // operator_intervention
  '57': UNAVAILABLE,
};

export function sqlstateDefault(
  sqlstate: string,
  errorClass: string,
): SqlstateDefault | undefined {
  if (UNMAPPED.has(sqlstate)) {
    return undefined;
  }
  return BY_CODE[sqlstate] ?? BY_CLASS[errorClass];
}
