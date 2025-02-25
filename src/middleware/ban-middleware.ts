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
      // Get the pre-resolved formatter instance
      const formatter = resolvedOptions.formatter;

      const error = convertToBanError(err, {
        formatter,
        headers: resolvedOptions.headers,
        sanitize: resolvedOptions.sanitize,
        includeStackTrace: resolvedOptions.includeStackTrace,
      });

      // Format the error using pre-resolved options
      const formatted = formatError(error, formatter, {
        headers: resolvedOptions.headers,
        sanitize: resolvedOptions.sanitize,
        includeStackTrace: resolvedOptions.includeStackTrace,
      });

      // Create and return response
      return createErrorResponse(error, formatted);
    }
  };
}
