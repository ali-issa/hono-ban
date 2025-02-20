/**
 * Core type definitions for Hono Ban error handling.
 *
 * This module provides comprehensive type definitions for error handling using the Ban pattern
 * in Hono applications. Ban errors are enhanced HTTP errors that encapsulate status codes,
 * error messages, and additional context data. The module includes interfaces for error
 * formatting, configuration options, and a rich set of factory methods for creating
 * standardized HTTP error responses.
 *
 * @module hono-ban/types
 * @see {@link https://github.com/honojs/hono} Hono web framework
 */

import type {
  ClientErrorStatusCode,
  ServerErrorStatusCode,
} from "hono/utils/http-status";

/**
 * Union type of all valid HTTP error status codes (4xx and 5xx).
 * Combines client error codes (400-499) and server error codes (500-599).
 *
 * @typedef {ClientErrorStatusCode | ServerErrorStatusCode} ErrorStatusCode
 */
export type ErrorStatusCode = ClientErrorStatusCode | ServerErrorStatusCode;

/**
 * Configuration options for creating and customizing Ban error instances.
 * These options control the error's behavior, formatting, and output.
 *
 * @template T - Type parameter for additional error context data
 * @interface BanOptions
 * @property {T} [data] - Additional context data associated with the error
 * @property {ErrorStatusCode} [statusCode=500] - HTTP status code for the error response
 * @property {Function} [ctor] - Constructor function for capturing stack traces
 * @property {boolean} [override=true] - Whether to override existing properties when wrapping errors
 * @property {Response} [res] - Original Response object for Hono compatibility
 * @property {unknown} [cause] - The underlying cause of the error
 * @property {string} [message] - Human-readable error message
 * @property {string | readonly string[]} [allow] - Allowed HTTP methods for 405 responses
 * @property {ErrorFormatter} [formatter] - Custom error formatter instance
 * @property {Record<string, string>} [headers] - Custom HTTP headers for the response
 * @property {string[]} [sanitize] - Fields to remove from error output
 * @property {boolean} [includeStackTrace=false] - Whether to include stack traces
 */
export interface BanOptions<T = unknown> {
  data?: T;
  statusCode?: ErrorStatusCode;
  ctor?: Function;
  override?: boolean;
  res?: Response;
  cause?: unknown;
  message?: string;
  allow?: string | readonly string[];
  formatter?: ErrorFormatter;
  headers?: Record<string, string>;
  sanitize?: string[];
  includeStackTrace?: boolean;
}

/**
 * Core interface for Ban error instances.
 * Represents an enhanced HTTP error with additional context and functionality.
 *
 * @template T - Type parameter for additional error context data
 * @interface Ban
 * @property {ErrorStatusCode} status - HTTP status code for the error response
 * @property {T | null} data - Additional context data associated with the error
 * @property {readonly string[]} [allow] - Allowed HTTP methods for 405 responses
 * @property {boolean} isDeveloperError - Whether the error contains sensitive information
 * @property {boolean} isBan - Type guard identifier for Ban errors
 * @property {unknown} output - The formatted error output
 * @property {string} contentType - MIME type of the error response
 */
export interface Ban<T = unknown> {
  readonly status: ErrorStatusCode;
  readonly data: T | null;
  readonly allow?: readonly string[];
  isDeveloperError: boolean;
  readonly isBan: boolean;
  readonly output: unknown;
  readonly contentType: string;

  /**
   * Converts the Ban error into an HTTP Response object.
   * This is the primary method for sending the error to clients.
   *
   * @returns {Response} A properly formatted HTTP error response
   */
  getResponse(): Response;

  /**
   * Assigns a custom formatter for this specific error instance.
   * Allows for per-error customization of the output format.
   *
   * @param {ErrorFormatter} formatter - The formatter to use for this error
   * @returns {this} The Ban instance for method chaining
   */
  setFormatter(formatter: ErrorFormatter): this;
}

/**
 * Interface for error formatters that control how errors are serialized.
 * Formatters convert Ban errors into specific output formats (e.g., JSON, XML).
 *
 * @template T - The output type of the formatter, must be a record type
 * @interface ErrorFormatter
 * @property {string} contentType - MIME type for the formatted error output
 */
export interface ErrorFormatter<
  T extends Record<string, unknown> = Record<string, unknown>
> {
  readonly contentType: string;

  /**
   * Formats a Ban error into the target representation.
   * This method handles the actual conversion of the error into its output format.
   *
   * @param {Ban} error - The Ban error to format
   * @param {Record<string, string>} [headers] - Additional response headers
   * @param {string[]} [sanitize] - Fields to remove from the output
   * @param {boolean} [includeStackTrace] - Whether to include stack traces
   * @returns {T} The formatted error output
   */
  format(
    error: Ban,
    headers?: Record<string, string>,
    sanitize?: string[],
    includeStackTrace?: boolean
  ): T;
}

/**
 * Constructor interface for creating and managing Ban errors.
 * Provides factory methods for all standard HTTP error types.
 *
 * @interface BanConstructor
 */
export interface BanConstructor {
  /**
   * Creates a new Ban error instance.
   *
   * @template T - Type parameter for additional error context data
   * @param {string | Error} [messageOrError] - Error message or existing Error to wrap
   * @param {BanOptions<T>} [options] - Configuration options
   * @returns {Ban<T>} A new Ban error instance
   */
  new <T = unknown>(
    messageOrError?: string | Error,
    options?: BanOptions<T>
  ): Ban<T>;

  /**
   * Configures the default formatter for all Ban instances.
   * This formatter will be used unless overridden at the instance level.
   *
   * @param {ErrorFormatter} formatter - The formatter to use as default
   * @returns {void}
   */
  setDefaultFormatter(formatter: ErrorFormatter): void;

  /**
   * Retrieves the current default error formatter.
   *
   * @returns {ErrorFormatter} The current default formatter
   */
  getDefaultFormatter(): ErrorFormatter;

  /**
   * Type guard function to identify Ban errors.
   * Can optionally verify the error has a specific status code.
   *
   * @param {unknown} err - The value to check
   * @param {ErrorStatusCode} [statusCode] - Optional status code to match
   * @returns {boolean} True if the value is a Ban error
   */
  isBan(err: unknown, statusCode?: ErrorStatusCode): boolean;

  /**
   * Converts any error into a Ban error instance.
   * Useful for standardizing error handling across an application.
   *
   * @param {unknown} err - The error to convert
   * @param {BanOptions} [options] - Configuration options
   * @returns {Ban} A new Ban error instance
   */
  banify(err: unknown, options?: BanOptions): Ban;

  /**
   * Creates a Bad Request (400) error.
   * Used when the client sends an invalid request.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 400 Bad Request error
   */
  badRequest(message?: string, options?: BanOptions): Ban;

  /**
   * Creates an Unauthorized (401) error.
   * Used when authentication is required but not provided or invalid.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 401 Unauthorized error
   */
  unauthorized(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Payment Required (402) error.
   * Used when payment is required to access a resource.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 402 Payment Required error
   */
  paymentRequired(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Forbidden (403) error.
   * Used when the server refuses to authorize the request.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 403 Forbidden error
   */
  forbidden(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Not Found (404) error.
   * Used when the requested resource doesn't exist.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 404 Not Found error
   */
  notFound(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Method Not Allowed (405) error.
   * Used when the HTTP method is not supported for the requested resource.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 405 Method Not Allowed error
   */
  methodNotAllowed(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Not Acceptable (406) error.
   * Used when the server cannot produce a response matching the client's accepted types.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 406 Not Acceptable error
   */
  notAcceptable(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Proxy Authentication Required (407) error.
   * Used when proxy authentication is needed.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 407 Proxy Authentication Required error
   */
  proxyAuthRequired(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Request Timeout (408) error.
   * Used when the client didn't send a request within the server's timeout period.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 408 Request Timeout error
   */
  clientTimeout(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Conflict (409) error.
   * Used when the request conflicts with the current state of the server.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 409 Conflict error
   */
  conflict(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Gone (410) error.
   * Used when the requested resource is no longer available.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 410 Gone error
   */
  resourceGone(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Length Required (411) error.
   * Used when the server requires a Content-Length header.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 411 Length Required error
   */
  lengthRequired(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Precondition Failed (412) error.
   * Used when conditional request preconditions are not met.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 412 Precondition Failed error
   */
  preconditionFailed(message?: string, options?: BanOptions): Ban;

  /**
   * Creates an Entity Too Large (413) error.
   * Used when the request payload exceeds server limits.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 413 Entity Too Large error
   */
  entityTooLarge(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a URI Too Long (414) error.
   * Used when the request URI is longer than the server can process.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 414 URI Too Long error
   */
  uriTooLong(message?: string, options?: BanOptions): Ban;

  /**
   * Creates an Unsupported Media Type (415) error.
   * Used when the request payload format is not supported.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 415 Unsupported Media Type error
   */
  unsupportedMediaType(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Range Not Satisfiable (416) error.
   * Used when the requested range cannot be fulfilled.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 416 Range Not Satisfiable error
   */
  rangeNotSatisfiable(message?: string, options?: BanOptions): Ban;

  /**
   * Creates an Expectation Failed (417) error.
   * Used when the server cannot meet the Expect header requirements.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 417 Expectation Failed error
   */
  expectationFailed(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Teapot (418) error.
   * An IETF April Fools' joke that became a standard.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 418 I'm a Teapot error
   */
  teapot(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Bad Data (422) error.
   * Used when the request syntax is valid but the content is semantically incorrect.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 422 Unprocessable Entity error
   */
  badData(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Locked (423) error.
   * Used when the requested resource is locked.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 423 Locked error
   */
  locked(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Failed Dependency (424) error.
   * Used when the request failed due to a previous request's failure.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 424 Failed Dependency error
   */
  failedDependency(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Too Early (425) error.
   * Used to prevent replay attacks in certain security contexts.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 425 Too Early error
   */
  tooEarly(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Precondition Required (428) error.
   * Used when the server requires conditional requests.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 428 Precondition Required error
   */
  preconditionRequired(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Too Many Requests (429) error.
   * Used for rate limiting when clients exceed allowed request rates.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 429 Too Many Requests error
   */
  tooManyRequests(message?: string, options?: BanOptions): Ban;

  /**
   * Creates an Illegal (451) error.
   * Used when content is unavailable for legal reasons.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 451 Unavailable For Legal Reasons error
   */
  illegal(message?: string, options?: BanOptions): Ban;

  /**
   * Creates an Internal Server Error (500) error.
   * Used for unexpected server-side errors.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 500 Internal Server Error
   */
  internal(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Not Implemented (501) error.
   * Used when the server doesn't support the requested functionality.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 501 Not Implemented error
   */
  notImplemented(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Bad Gateway (502) error.
   * Used when an upstream server sends an invalid response.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 502 Bad Gateway error
   */
  badGateway(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Service Unavailable (503) error.
   * Used when the server is temporarily unavailable.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 503 Service Unavailable error
   */
  serverUnavailable(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Gateway Timeout (504) error.
   * Used when an upstream server times out.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 504 Gateway Timeout error
   */
  gatewayTimeout(message?: string, options?: BanOptions): Ban;

  /**
   * Creates a Bad Implementation (500) error.
   * Used for errors caused by incorrect implementation details.
   *
   * @param {string} [message] - Custom error message
   * @param {BanOptions} [options] - Additional options
   * @returns {Ban} A 500 Internal Server Error specifically for implementation issues
   */
  badImplementation(message?: string, options?: BanOptions): Ban;
}

/**
 * Export the Ban constructor type.
 * This allows for proper type-checking when using the Ban error factory.
 */
export declare const Ban: BanConstructor;
