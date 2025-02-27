/**
 * Error formatting utilities
 * @module hono-ban/core/format-error
 */

import { STATUS_CODES } from "../constants";
import type { BanError, ErrorFormatter, FormatOptions } from "../types";

/**
 * Format an error using the provided formatter
 * @param error - Error to format
 * @param formatter - Formatter to use
 * @param options - Formatting options
 */
export function formatError(
  error: BanError,
  formatter: ErrorFormatter,
  options: FormatOptions = {}
): unknown {
  // Directly format the error without caching
  return formatter.format(
    error,
    options.headers,
    options.sanitize,
    options.includeStackTrace
  );
}

/**
 * Create a Response object from a formatted error
 * @param error - Error to create response from
 * @param formatted - Formatted error output
 */
export function createErrorResponse(
  error: BanError,
  formatted: unknown
): Response {
  const headers = new Headers({
    "Content-Type": "application/json",
    ...error.headers,
  });

  if (error.allow?.length) {
    headers.set("Allow", error.allow.join(", "));
  }

  // Check if this is a developer error in production
  const isDeveloperError =
    error.data &&
    typeof error.data === "object" &&
    "isDeveloperError" in error.data &&
    error.data.isDeveloperError === true;

  // Sanitize developer errors in production
  if (isDeveloperError && process.env.NODE_ENV === "production") {
    // Create a sanitized version without sensitive data
    const sanitizedFormatted = {
      statusCode: error.status,
      error: STATUS_CODES[error.status],
      message: "An internal server error occurred",
    };

    return new Response(JSON.stringify(sanitizedFormatted), {
      status: error.status,
      headers,
    });
  }

  return new Response(JSON.stringify(formatted), {
    status: error.status,
    headers,
  });
}
