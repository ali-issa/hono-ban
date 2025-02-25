/**
 * Options type definitions
 * @module hono-ban/types/options
 */

import type { ErrorStatusCode } from "./error";
import type { Headers, AllowedMethods } from "./common";
import type { ErrorFormatter } from "./formatter";

/**
 * Options for creating errors
 */
export interface BanOptions<T = unknown> {
  /** HTTP status code */
  statusCode?: ErrorStatusCode;

  /** Error message */
  message?: string;

  /** Additional error data */
  data?: T;

  /** HTTP response headers (not included in response body) */
  headers?: Headers;

  /** Allowed HTTP methods */
  allow?: AllowedMethods;

  /** Original error cause */
  cause?: Error | unknown;

  /** Custom error formatter */
  formatter?: ErrorFormatter;

  /** Fields to remove from output */
  sanitize?: readonly string[];

  /** Whether to include stack trace */
  includeStackTrace?: boolean;
}

/**
 * Options for formatting errors
 */
export interface FormatOptions {
  /** Additional headers for HTTP response (not included in response body) */
  headers?: Headers;

  /** Fields to remove from output */
  sanitize?: readonly string[];

  /** Whether to include stack trace */
  includeStackTrace?: boolean;
}

/**
 * Middleware configuration options
 */
export interface BanMiddlewareOptions {
  /** Custom error formatter or formatter name */
  formatter?: ErrorFormatter;

  /** Fields to remove from output */
  sanitize?: readonly string[];

  /** Whether to include stack trace */
  includeStackTrace?: boolean;

  /** Default headers for HTTP response (not included in response body) */
  headers?: Headers;
}
