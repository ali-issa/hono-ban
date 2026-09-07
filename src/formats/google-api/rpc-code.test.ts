import { describe, expect, it } from 'vitest';

import { isGoogleRpcCode, resolveRpcCode, rpcCodeFromStatus } from './rpc-code';

describe('rpcCodeFromStatus', () => {
  // @ref https://github.com/googleapis/gax-nodejs/blob/main/gax/src/status.ts
  it.each([
    [400, 'INVALID_ARGUMENT'],
    [401, 'UNAUTHENTICATED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
    [409, 'ABORTED'],
    [416, 'OUT_OF_RANGE'],
    [429, 'RESOURCE_EXHAUSTED'],
    [499, 'CANCELLED'],
    [501, 'UNIMPLEMENTED'],
    [503, 'UNAVAILABLE'],
    [504, 'DEADLINE_EXCEEDED'],
  ])('maps %i to %s from the gax table', (status, code) => {
    expect(rpcCodeFromStatus(status)).toBe(code);
  });

  it('falls back by class: 2xx OK, other 4xx FAILED_PRECONDITION, other 5xx INTERNAL, else UNKNOWN', () => {
    expect(rpcCodeFromStatus(200)).toBe('OK');
    expect(rpcCodeFromStatus(204)).toBe('OK');
    expect(rpcCodeFromStatus(402)).toBe('FAILED_PRECONDITION');
    expect(rpcCodeFromStatus(422)).toBe('FAILED_PRECONDITION');
    expect(rpcCodeFromStatus(500)).toBe('INTERNAL');
    expect(rpcCodeFromStatus(502)).toBe('INTERNAL');
    expect(rpcCodeFromStatus(302)).toBe('UNKNOWN');
    expect(rpcCodeFromStatus(600)).toBe('UNKNOWN');
  });
});

describe('resolveRpcCode', () => {
  it('prefers the explicit option, then a code that names a google.rpc.Code, then the status', () => {
    expect(
      resolveRpcCode('CONFLICT', 409, { CONFLICT: 'ALREADY_EXISTS' }),
    ).toBe('ALREADY_EXISTS');
    expect(resolveRpcCode('NOT_FOUND', 404)).toBe('NOT_FOUND');
    expect(resolveRpcCode('ALREADY_EXISTS', 409)).toBe('ALREADY_EXISTS');
    expect(resolveRpcCode('ORDER_CONFLICT', 409)).toBe('ABORTED');
    expect(resolveRpcCode('ORDER_CONFLICT', 409, { OTHER: 'DATA_LOSS' })).toBe(
      'ABORTED',
    );
  });
});

describe('isGoogleRpcCode', () => {
  it('accepts the seventeen enum names and nothing else', () => {
    expect(isGoogleRpcCode('UNAUTHENTICATED')).toBe(true);
    expect(isGoogleRpcCode('DATA_LOSS')).toBe(true);
    expect(isGoogleRpcCode('not_found')).toBe(false);
    expect(isGoogleRpcCode('VALIDATION_FAILED')).toBe(false);
  });
});
