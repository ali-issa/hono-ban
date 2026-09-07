import { TRACEPARENT_LENGTH, TRACEPARENT_PATTERN } from '../internal/constants';

export interface TraceContext {
  readonly traceId: string;
  readonly parentId: string;
  readonly sampled: boolean;
}

const ALL_ZERO = /^0+$/u;
const HEX = 16;
const SAMPLED_FLAG = 0x01;

/**
 * W3C Trace Context `traceparent` parser (SPEC 6.6). Invalid headers are
 * ignored rather than rejected, as the specification requires. Versions other
 * than `00` are accepted when the first 55 characters parse and are followed
 * by `-` or nothing (section 3.2.4, forward compatibility).
 * @ref https://www.w3.org/TR/trace-context/#traceparent-header
 * @ref https://www.w3.org/TR/trace-context/#versioning-of-traceparent
 */
export function parseTraceparent(
  value: string | undefined,
): TraceContext | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = TRACEPARENT_PATTERN.exec(value);
  const version = match?.[1];
  const traceId = match?.[2];
  const parentId = match?.[3];
  const flags = match?.[4];
  if (
    version === undefined ||
    traceId === undefined ||
    parentId === undefined ||
    flags === undefined
  ) {
    return undefined;
  }
  if (version === 'ff') {
    return undefined;
  }
  if (version === '00') {
    if (value.length !== TRACEPARENT_LENGTH) {
      return undefined;
    }
  } else if (
    value.length > TRACEPARENT_LENGTH &&
    value[TRACEPARENT_LENGTH] !== '-'
  ) {
    return undefined;
  }
  if (ALL_ZERO.test(traceId) || ALL_ZERO.test(parentId)) {
    return undefined;
  }
  return {
    traceId,
    parentId,
    sampled: (Number.parseInt(flags, HEX) & SAMPLED_FLAG) === SAMPLED_FLAG,
  };
}
