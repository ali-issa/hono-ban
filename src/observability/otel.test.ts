import { trace } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';

import { traceIdFromOtel } from './otel';

const VALID = '4bf92f3577b34da6a3ce929d0e0e4736';

function fakeTrace(traceId: string | undefined) {
  return {
    getActiveSpan: () =>
      traceId === undefined
        ? undefined
        : { spanContext: () => ({ traceId, spanId: 'x' }) },
  };
}

describe('traceIdFromOtel', () => {
  it('returns the active span trace id when valid', () => {
    expect(traceIdFromOtel(fakeTrace(VALID))()).toBe(VALID);
    expect(traceIdFromOtel({ trace: fakeTrace(VALID) })()).toBe(VALID);
  });

  it('returns undefined without a span or with an invalid id', () => {
    const noSpan: string | undefined = undefined;
    expect(traceIdFromOtel(fakeTrace(noSpan))()).toBeUndefined();
    expect(traceIdFromOtel(fakeTrace('0'.repeat(32)))()).toBeUndefined();
    expect(traceIdFromOtel(fakeTrace('ABC'))()).toBeUndefined();
  });

  it('accepts the real @opentelemetry/api trace object', () => {
    expect(traceIdFromOtel(trace)()).toBeUndefined();
  });
});
