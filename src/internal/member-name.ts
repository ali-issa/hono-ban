/**
 * Construction-time check for options that name a body member or metadata
 * key (`traceIdMember`, `traceIdMetaKey`, `traceIdMetadataKey`). A name the
 * format itself writes would be overwritten or would overwrite a standard
 * member (a `traceIdMember` of `status` replaces the numeric status with the
 * trace id), and a name outside the wire format's grammar yields a body the
 * format's own schema rejects. Failing here keeps the mistake at startup
 * instead of on the first error response.
 * @packageDocumentation
 */
import { PROTO_KEYS } from './constants';

export function assertMemberName(
  option: string,
  name: string,
  reserved: ReadonlySet<string>,
  pattern: RegExp,
): void {
  if (reserved.has(name) || PROTO_KEYS.has(name)) {
    throw new TypeError(`${option} "${name}" is reserved`);
  }
  if (!pattern.test(name)) {
    throw new TypeError(`${option} "${name}" does not match ${pattern.source}`);
  }
}
