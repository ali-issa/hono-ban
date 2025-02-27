/**
 * Error handling middleware
 * @module hono-ban/middleware/ban-middleware
 */

import type { MiddlewareHandler } from "hono";
import { convertToBanError, formatError, createErrorResponse } from "../core";
import { defaultFormatter } from "../formatters";
import type { BanMiddlewareOptions } from "../types";

/**
 * Default middleware options
 */
const DEFAULT_OPTIONS: Required<BanMiddlewareOptions> = {
  formatter: defaultFormatter,
  sanitize: [],
  includeStackTrace: false,
  headers: {},
};

/**
 * Create error handling middleware
 * @param options - Middleware configuration options
 *
 * @example
 * // Simple usage
 * app.use(ban());
 *
 * @example
 * // Advanced usage
 * app.use(ban({
 *   formatter: customFormatter,
 *   sanitize: ['password', 'token'],
 *   includeStackTrace: process.env.NODE_ENV !== 'production'
 * }));
 */
export function ban(options: BanMiddlewareOptions = {}): MiddlewareHandler {
  const resolvedOptions: Required<BanMiddlewareOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
    formatter: options.formatter
      ? options.formatter
      : DEFAULT_OPTIONS.formatter,
    headers: {
      ...DEFAULT_OPTIONS.headers,
      ...options.headers,
    },
    sanitize: [...DEFAULT_OPTIONS.sanitize, ...(options.sanitize || [])],
  };

  // Return the middleware function that uses the pre-merged options
  return async (_, next) => {
    try {
      await next();
    } catch (err) {
      // Convert to BanError with middleware options as fallback
      const error = convertToBanError(err, {
        formatter: resolvedOptions.formatter,
        headers: resolvedOptions.headers,
        sanitize: resolvedOptions.sanitize,
        includeStackTrace: resolvedOptions.includeStackTrace,
      });

      // Use error's formatter if available, otherwise use middleware formatter
      const formatter = error.formatter || resolvedOptions.formatter;

      // Merge sanitize arrays, prioritizing error's sanitize fields
      const sanitize = [
        ...(resolvedOptions.sanitize || []),
        ...(error.sanitize || []),
      ];

      // Use error's includeStackTrace if defined, otherwise use middleware's
      const includeStackTrace =
        error.includeStackTrace !== undefined
          ? error.includeStackTrace
          : resolvedOptions.includeStackTrace;

      // Format the error using the determined options
      const formatted = formatError(error, formatter, {
        headers: error.headers || resolvedOptions.headers,
        sanitize,
        includeStackTrace,
      });

      // Create and return response
      return createErrorResponse(error, formatted);
    }
  };
}
