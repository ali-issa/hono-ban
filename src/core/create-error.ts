/**
 * Error creation utilities
 * @module hono-ban/core/create-error
 */

import { STATUS_CODES } from "../constants/status-codes";
import type { BanError, BanOptions } from "../types";
import { validateStatusCode } from "../utils/validate";

/**
 * Create a new error object with the given options
 * @param options - Error creation options
 * @returns A BanError object
 *
 * @example
 * // Basic usage
 * const error = createError({ statusCode: 404, message: "User not found" });
 *
 * @example
 * // With custom data
 * const error = createError({
 *   statusCode: 400,
 *   message: "Validation failed",
 *   data: { field: "email", issue: "invalid format" }
 * });
 */
export function createError<T = unknown>(options: BanOptions<T>): BanError<T> {
  // Validate and normalize status code
  const status = validateStatusCode(options.statusCode ?? 500);

  // Create the error object
  const error: BanError<T> = {
    status,
    message: options.message ?? STATUS_CODES[status],
    isBan: true,
  };

  // Add optional properties
  if (options.data !== undefined) {
    error.data = options.data;
  }

  if (options.headers) {
    error.headers = { ...options.headers };
  }

  if (options.allow) {
    error.allow = Array.isArray(options.allow)
      ? [...options.allow]
      : [options.allow];
  }

  if (options.cause) {
    error.cause = options.cause;
    // Keep cause stack separately rather than overwriting the main stack
    if (options.cause instanceof Error) {
      error.causeStack = options.cause.stack;
    }
  }

  // Add formatter options
  if (options.formatter) {
    error.formatter = options.formatter;
  }

  if (options.sanitize) {
    error.sanitize = [...options.sanitize];
  }

  if (options.includeStackTrace !== undefined) {
    error.includeStackTrace = options.includeStackTrace;
  }

  // Always capture a fresh stack trace for the BanError itself
  Error.captureStackTrace(error, createError);

  return error;
}
