/**
 * Default error formatter for backward compatibility
 * @module hono-ban/formatters/default
 */

import type { ErrorFormatter, ErrorStatusCode } from "../types";
import { STATUS_CODES } from "./constants";
import type { Ban } from "./ban";

/**
 * Default error payload structure
 */
export interface DefaultErrorPayload {
  statusCode: ErrorStatusCode;
  error: string;
  message?: string;
  stack?: string;
  [key: string]: unknown;
}

/**
 * Default error output format
 */
export interface DefaultErrorOutput extends Record<string, unknown> {
  statusCode: ErrorStatusCode;
  payload: DefaultErrorPayload;
  headers: Record<string, string>;
}

/**
 * Default JSON formatter maintaining backward compatibility
 */
export class DefaultFormatter implements ErrorFormatter<DefaultErrorOutput> {
  readonly contentType = "application/json";

  format(
    error: Ban,
    headers: Record<string, string> = {},
    sanitize: string[] = [],
    includeStackTrace: boolean = false
  ): DefaultErrorOutput {
    const { status, message, allow } = error;
    const output: DefaultErrorOutput = {
      statusCode: status,
      payload: {
        statusCode: status,
        error: STATUS_CODES[status] || "Unknown",
        ...(typeof message !== "undefined" ? { message } : {}), // updated to omit undefined
        ...(includeStackTrace && { stack: error.stack }),
      },
      headers,
    };

    sanitize.forEach((field) => delete output.payload[field]);

    if (allow) {
      output.headers["Allow"] = allow.join(", ");
    }

    return output;
  }
}
