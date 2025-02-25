/**
 * Server error factory functions (5xx)
 * @module hono-ban/factories/server-errors
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
 * Create a 500 Internal Server Error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function internal<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    500 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 501 Not Implemented error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function notImplemented<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    501 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 502 Bad Gateway error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function badGateway<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    502 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 503 Service Unavailable error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function serverUnavailable<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    503 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 504 Gateway Timeout error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function gatewayTimeout<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    504 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 505 HTTP Version Not Supported error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function httpVersionNotSupported<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    505 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 506 Variant Also Negotiates error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function variantAlsoNegotiates<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    506 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 507 Insufficient Storage error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function insufficientStorage<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    507 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 508 Loop Detected error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function loopDetected<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    508 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 510 Not Extended error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function notExtended<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    510 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 511 Network Authentication Required error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function networkAuthRequired<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  return createErrorWithStatus(
    511 as ErrorStatusCode,
    messageOrOptions,
    options
  );
}

/**
 * Create a 500 Internal Server Error marked as a developer error
 * @param messageOrOptions - Error message or options
 * @param options - Additional options
 */
export function badImplementation<T = unknown>(
  messageOrOptions?: string | Partial<BanOptions<T>>,
  options?: Partial<BanOptions<T>>
): BanError<T> {
  const mergedOptions =
    typeof messageOrOptions === "string"
      ? { ...options, message: messageOrOptions }
      : { ...messageOrOptions, ...options };

  const mergedData = {
    isDeveloperError: true,
    ...((mergedOptions.data as Record<string, unknown>) || {}),
  } as unknown as T;

  return createError<T>({
    ...mergedOptions,
    statusCode: 500 as ErrorStatusCode,
    data: mergedData,
  });
}
