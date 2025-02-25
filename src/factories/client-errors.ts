/**
 * Client error factory functions (4xx)
 * @module hono-ban/factories/client-errors
 */

import type { BanError, BanOptions, ErrorStatusCode } from "../types";
import { createError } from "../core";

/**
 * Helper function to reduce duplication
 * @param statusCode - HTTP status code
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
function createErrorWithStatus<T>(
  statusCode: ErrorStatusCode,
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  if (typeof messageOrOptions === "string") {
    return createError<T>({
      ...options,
      statusCode,
      message: messageOrOptions,
    });
  }
  return createError<T>({ ...messageOrOptions, ...options, statusCode });
}

/**
 * Create a 400 Bad Request error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function badRequest<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    400 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 401 Unauthorized error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function unauthorized<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    401 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 402 Payment Required error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function paymentRequired<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    402 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 403 Forbidden error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function forbidden<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    403 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 404 Not Found error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function notFound<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    404 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 405 Method Not Allowed error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function methodNotAllowed<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    405 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 406 Not Acceptable error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function notAcceptable<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    406 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 407 Proxy Authentication Required error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function proxyAuthRequired<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    407 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 408 Request Timeout error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function clientTimeout<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    408 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 409 Conflict error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function conflict<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    409 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 410 Gone error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function resourceGone<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    410 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 411 Length Required error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function lengthRequired<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    411 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 412 Precondition Failed error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function preconditionFailed<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    412 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 413 Payload Too Large error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function entityTooLarge<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    413 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 414 URI Too Long error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function uriTooLong<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    414 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 415 Unsupported Media Type error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function unsupportedMediaType<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    415 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 416 Range Not Satisfiable error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function rangeNotSatisfiable<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    416 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 417 Expectation Failed error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function expectationFailed<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    417 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 418 I'm a Teapot error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function teapot<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    418 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 421 Misdirected Request error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function misdirectedRequest<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    421 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 422 Unprocessable Entity error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function badData<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    422 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 423 Locked error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function locked<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    423 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 424 Failed Dependency error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function failedDependency<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    424 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 425 Too Early error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function tooEarly<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    425 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 426 Upgrade Required error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function upgradeRequired<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    426 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 428 Precondition Required error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function preconditionRequired<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    428 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 429 Too Many Requests error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function tooManyRequests<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    429 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 431 Request Header Fields Too Large error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function headerFieldsTooLarge<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    431 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 451 Unavailable For Legal Reasons error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function illegal<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    451 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}
