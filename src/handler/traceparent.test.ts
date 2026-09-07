import { describe, expect, it } from 'vitest';

import { parseTraceparent } from './traceparent';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT = '00f067aa0ba902b7';

describe('parseTraceparent', () => {
  it('parses a valid version 00 header', () => {
    expect(parseTraceparent(`00-${TRACE}-${PARENT}-01`)).toEqual({
      traceId: TRACE,
      parentId: PARENT,
      sampled: true,
    });
    expect(parseTraceparent(`00-${TRACE}-${PARENT}-00`)?.sampled).toBe(false);
  });

  it('ignores absent, malformed, uppercase, or wrong-length values', () => {
    const absent: string | undefined = undefined;
    expect(parseTraceparent(absent)).toBeUndefined();
    expect(parseTraceparent('')).toBeUndefined();
    expect(parseTraceparent('nonsense')).toBeUndefined();
    expect(
      parseTraceparent(`00-${TRACE.toUpperCase()}-${PARENT}-01`),
    ).toBeUndefined();
    expect(parseTraceparent(`00-${TRACE}-${PARENT}-01-extra`)).toBeUndefined();
    expect(parseTraceparent(`00-${TRACE}-${PARENT}-0`)).toBeUndefined();
  });

  it('rejects version ff and all-zero ids', () => {
    expect(parseTraceparent(`ff-${TRACE}-${PARENT}-01`)).toBeUndefined();
    expect(
      parseTraceparent(`00-${'0'.repeat(32)}-${PARENT}-01`),
    ).toBeUndefined();
    expect(
      parseTraceparent(`00-${TRACE}-${'0'.repeat(16)}-01`),
    ).toBeUndefined();
  });

  it('accepts future versions with extra fields separated by a dash', () => {
    expect(parseTraceparent(`01-${TRACE}-${PARENT}-01-future`)?.traceId).toBe(
      TRACE,
    );
    expect(parseTraceparent(`01-${TRACE}-${PARENT}-01`)?.traceId).toBe(TRACE);
    expect(parseTraceparent(`01-${TRACE}-${PARENT}-01x`)).toBeUndefined();
  });
});
