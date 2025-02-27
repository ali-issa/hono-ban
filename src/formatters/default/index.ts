/**
 * Default error formatter implementation
 * @module hono-ban/formatters/default
 */

import { STATUS_CODES } from "../../constants";
import type { BanError, DefaultErrorOutput, Headers } from "../../types";
import { sanitizeObject } from "../../utils";

/**
 * Default JSON formatter with a clean, flat structure
 */
export const defaultFormatter = {
  contentType: "application/json",

  /**
   * Format an error into a standardized output structure
   * @param error - Error to format
   * @param headers - Headers for HTTP response (not included in response body)
   * @param sanitize - Fields to remove from output
   * @param includeStackTrace - Whether to include stack traces
   */
  format(
    error: BanError,
    headers: Headers = {}, // Headers are used for HTTP headers, not included in response body
    sanitize: readonly string[] = [],
    includeStackTrace = false
  ): DefaultErrorOutput {
    const { status, message, data } = error;

    // Build base output
    const output: DefaultErrorOutput = {
      statusCode: status,
      error: STATUS_CODES[status] || "Unknown Error",
    };

    // Add optional fields
    if (typeof message === "string") {
      output.message = message;
    }

    const isDeveloperError =
      data &&
      typeof data === "object" &&
      "isDeveloperError" in data &&
      data.isDeveloperError === true;

    if (includeStackTrace || isDeveloperError) {
      if (error.stack) {
        output.stack = error.stack;
      }
      if (error.causeStack) {
        output.causeStack = error.causeStack;
      }
    }

    if (data !== undefined) {
      output.data = data;
    }

    // Apply sanitization to the entire output
    return sanitizeObject(output, sanitize) as DefaultErrorOutput;
  },
};
