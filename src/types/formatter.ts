/**
 * Formatter type definitions
 * @module hono-ban/types/formatter
 */

import type { BanError } from "./error";
import type { Headers } from "./common";

/**
 * Default error output structure
 */
export interface DefaultErrorOutput {
  /** HTTP status code */
  statusCode: number;

  /** Formatted error payload */
  payload: {
    /** HTTP status code */
    statusCode: number;

    /** Error name from status code */
    error: string;

    /** Error message if provided */
    message?: string;

    /** Stack trace if enabled */
    stack?: string;

    /** Cause stack trace if available */
    causeStack?: string;

    /** Additional error data */
    data?: unknown;

    /** Any other properties */
    [key: string]: unknown;
  };
}

/**
 * Error formatter interface
 */
export interface ErrorFormatter<T = unknown> {
  /** Response content type */
  readonly contentType: string;

  /**
   * Format an error into the desired structure
   * @param error - Error to format
   * @param headers - Additional headers (used for HTTP headers, not included in response body)
   * @param sanitize - Fields to remove
   * @param includeStackTrace - Include stack trace
   */
  format(
    error: BanError,
    headers?: Headers,
    sanitize?: readonly string[],
    includeStackTrace?: boolean
  ): T;
}
