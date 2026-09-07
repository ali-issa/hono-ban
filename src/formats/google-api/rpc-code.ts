/**
 * `google.rpc.Code` names and the HTTP status each one is derived from
 * (SPEC 7.6.1). The forward mapping (code to HTTP status) is the "HTTP
 * Mapping" line on every enum value in `code.proto`; it is many-to-one, so the
 * reverse table below is the one Google's own client library uses when it
 * turns an HTTP error into a status code.
 * @ref https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto
 * @ref https://github.com/googleapis/gax-nodejs/blob/main/gax/src/status.ts
 * @packageDocumentation
 */

/** Every value of the `google.rpc.Code` enum, by name. */
export type GoogleRpcCode =
  | 'OK'
  | 'CANCELLED'
  | 'UNKNOWN'
  | 'INVALID_ARGUMENT'
  | 'DEADLINE_EXCEEDED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'PERMISSION_DENIED'
  | 'RESOURCE_EXHAUSTED'
  | 'FAILED_PRECONDITION'
  | 'ABORTED'
  | 'OUT_OF_RANGE'
  | 'UNIMPLEMENTED'
  | 'INTERNAL'
  | 'UNAVAILABLE'
  | 'DATA_LOSS'
  | 'UNAUTHENTICATED';

const RPC_CODES: ReadonlySet<string> = new Set<GoogleRpcCode>([
  'OK',
  'CANCELLED',
  'UNKNOWN',
  'INVALID_ARGUMENT',
  'DEADLINE_EXCEEDED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'PERMISSION_DENIED',
  'RESOURCE_EXHAUSTED',
  'FAILED_PRECONDITION',
  'ABORTED',
  'OUT_OF_RANGE',
  'UNIMPLEMENTED',
  'INTERNAL',
  'UNAVAILABLE',
  'DATA_LOSS',
  'UNAUTHENTICATED',
]);

/**
 * `HttpCodeToRpcCodeMap` from gax-nodejs, verbatim. Where several codes share
 * an HTTP status the table keeps the one gax picked: `INVALID_ARGUMENT` for
 * 400 (not `FAILED_PRECONDITION` or `OUT_OF_RANGE`), `ABORTED` for 409 (not
 * `ALREADY_EXISTS`), `INTERNAL` for 500 (not `UNKNOWN` or `DATA_LOSS`).
 * @ref https://github.com/googleapis/gax-nodejs/blob/main/gax/src/status.ts
 */
const BY_HTTP_STATUS: ReadonlyMap<number, GoogleRpcCode> = new Map<
  number,
  GoogleRpcCode
>([
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
]);

const SUCCESS = 200;
const REDIRECT = 300;
const CLIENT_ERROR = 400;
const SERVER_ERROR = 500;
const END = 600;

export function isGoogleRpcCode(value: string): value is GoogleRpcCode {
  return RPC_CODES.has(value);
}

/**
 * The `google.rpc.Code` name for an HTTP status, following
 * `rpcCodeFromHttpStatusCode` in gax-nodejs: the table first, then `OK` for
 * any 2xx, `FAILED_PRECONDITION` for any other 4xx, `INTERNAL` for any other
 * 5xx, and `UNKNOWN` for everything else.
 * @ref https://github.com/googleapis/gax-nodejs/blob/main/gax/src/status.ts
 */
export function rpcCodeFromStatus(status: number): GoogleRpcCode {
  const mapped = BY_HTTP_STATUS.get(status);
  if (mapped !== undefined) {
    return mapped;
  }
  if (status >= SUCCESS && status < REDIRECT) {
    return 'OK';
  }
  if (status >= CLIENT_ERROR && status < SERVER_ERROR) {
    return 'FAILED_PRECONDITION';
  }
  if (status >= SERVER_ERROR && status < END) {
    return 'INTERNAL';
  }
  return 'UNKNOWN';
}

/**
 * The `status` member for an entry (SPEC 7.6.1): an explicit per-code option,
 * else the catalog code itself when it already names a `google.rpc.Code`
 * (`NOT_FOUND`, `ALREADY_EXISTS`), else the HTTP-derived default.
 */
export function resolveRpcCode(
  code: string,
  status: number,
  overrides?: Readonly<Record<string, GoogleRpcCode>>,
): GoogleRpcCode {
  const explicit = overrides?.[code];
  if (explicit !== undefined) {
    return explicit;
  }
  if (isGoogleRpcCode(code)) {
    return code;
  }
  return rpcCodeFromStatus(status);
}
