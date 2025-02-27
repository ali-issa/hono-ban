/**
 * Error type definitions
 * @module hono-ban/types/error
 */

import type {
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from "hono/utils/http-status";
import type { ErrorFormatter } from "./formatter";

/**
 * Valid HTTP error status codes (4xx and 5xx)
 */
export type ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;

/**
 * Core error object interface
 */
export interface BanError<T = unknown> {
  /** HTTP error status code */
  status: ErrorStatusCode;

  /** Error message */
  message: string;

  /** Additional error context data */
  data?: T;

  /** Response headers */
  headers?: Record<string, string>;

  /** Allowed HTTP methods for 405 errors */
  allow?: readonly string[];

  /** Stack trace if available */
  stack?: string;

  /** Original error if this wraps another error */
  cause?: unknown;

  /** Stack trace of the cause error */
  causeStack?: string;

  /** Type guard identifier */
  readonly isBan: true;

  /** Custom error formatter */
  formatter?: ErrorFormatter;

  /** Fields to remove from output */
  sanitize?: readonly string[];

  /** Whether to include stack trace */
  includeStackTrace?: boolean;
}
