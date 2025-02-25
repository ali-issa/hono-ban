/**
 * Error conversion utilities
 * @module hono-ban/core/convert-error
 */

import type { BanError, BanOptions } from "../types";
import { createError } from "./create-error";

/**
 * Type guard to check if a value is a BanError
 * @param err - Value to check
 * @param statusCode - Optional status code to match
 */
export function isBanError(err: unknown, statusCode?: number): err is BanError {
  return (
    typeof err === "object" &&
    err !== null &&
    "isBan" in err &&
    err.isBan === true &&
    (!statusCode || (err as BanError).status === statusCode)
  );
}

/**
 * Convert any error into a BanError
 * @param err - Error to convert
 * @param options - Additional options
 */
export function convertToBanError<T = unknown>(
  err: unknown,
  options: BanOptions<T> = {}
): BanError<T> {
  // If already a BanError, merge options
  if (isBanError(err)) {
    const merged: BanError<T> = {
      status: options.statusCode ?? err.status,
      message: options.message ?? err.message,
      isBan: true,
      data: (options.data !== undefined ? options.data : err.data) as
        | T
        | undefined,
      headers: {
        ...err.headers,
        ...options.headers,
      },
      allow: options.allow
        ? Array.isArray(options.allow)
          ? [...options.allow]
          : [options.allow]
        : err.allow,
      cause: options.cause ?? err.cause,
      stack: err.stack,
    };

    return merged;
  }

  // Convert Error instance
  if (err instanceof Error) {
    return createError<T>({
      ...options,
      message: options.message ?? err.message,
      cause: err,
    });
  }

  // Handle unknown error types
  return createError<T>({
    ...options,
    message:
      options.message ?? (typeof err === "string" ? err : "Unknown error"),
    cause: err,
  });
}
