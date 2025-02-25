/**
 * Default error formatter implementation
 * @module hono-ban/formatters/default
 */

import { STATUS_CODES } from "../../constants";
import type { BanError, DefaultErrorOutput, Headers } from "../../types";
import { sanitizeObject } from "../../utils";

/**
 * Default JSON formatter maintaining backward compatibility
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

    // Build base payload
    const payload: DefaultErrorOutput["payload"] = {
      statusCode: status,
      error: STATUS_CODES[status] || "Unknown Error",
    };

    // Add optional fields
    if (typeof message === "string") {
      payload.message = message;
    }

    const isDeveloperError =
      data &&
      typeof data === "object" &&
      "isDeveloperError" in data &&
      data.isDeveloperError === true;

    if (includeStackTrace || isDeveloperError) {
      if (error.stack) {
        payload.stack = error.stack;
      }
      if (error.causeStack) {
        payload.causeStack = error.causeStack;
      }
    }

    if (data !== undefined) {
      payload.data = data;
    }

    // Create output structure
    const output: DefaultErrorOutput = {
      statusCode: status,
      payload: sanitizeObject(
        payload,
        sanitize
      ) as DefaultErrorOutput["payload"],
    };

    return output;
  },
};
