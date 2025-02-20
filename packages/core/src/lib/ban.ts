/**
 * Core Ban error class implementation for enhanced HTTP error handling in Hono
 * @module hono-ban/ban
 */

import { HTTPException } from "hono/http-exception";
import type {
  ErrorStatusCode,
  BanOptions,
  ErrorFormatter,
  Ban as BanType,
} from "../types";
import { STATUS_CODES } from "./constants";
import { DefaultFormatter } from "./formatter";

/**
 * Custom error class extending Hono's HTTPException with enhanced capabilities
 * @template T Type of additional error data
 */
export class Ban<T = unknown> extends HTTPException implements BanType<T> {
  /** HTTP error status code (4xx or 5xx) */
  public readonly status: ErrorStatusCode;

  /** Additional error context data */
  public readonly data: T | null;

  /** Allowed HTTP methods for 405 errors */
  public readonly allow?: readonly string[];

  /** Indicates if error contains sensitive developer information */
  public isDeveloperError: boolean;

  /** Type guard identifier for Ban errors */
  public readonly isBan: boolean = true;

  /** Response headers to include */
  private readonly headers: Readonly<Record<string, string>>;

  /** Fields to remove from error output */
  private readonly sanitize: ReadonlyArray<string>;

  /** Whether to include stack trace in output */
  private readonly includeStackTrace: boolean;

  /** Error formatter instance */
  private formatter?: ErrorFormatter;

  /** Cached formatted output */
  private formattedOutput: unknown | null = null;

  /** Default formatter for all Ban instances */
  private static defaultFormatter: ErrorFormatter = new DefaultFormatter();

  /**
   * Creates a new Ban error instance
   * @param messageOrError Error message or Error instance to wrap
   * @param options Configuration options for the error
   */
  constructor(messageOrError?: string | Error, options: BanOptions<T> = {}) {
    const resolved = Ban.resolveParameters(messageOrError, options);
    const { statusCode, message, httpOptions } = resolved;

    super(statusCode, { ...httpOptions, message });

    this.status = statusCode;
    this.data = options.data ?? null;
    this.formatter = options.formatter;
    this.headers = Object.freeze({ ...(options.headers ?? {}) });
    this.sanitize = Object.freeze([...(options.sanitize ?? [])]);
    this.includeStackTrace = options.includeStackTrace ?? false;
    this.isDeveloperError = statusCode >= 500;

    if (options.allow) {
      this.allow = Object.freeze(
        Array.isArray(options.allow) ? [...options.allow] : [options.allow]
      );
    }

    Error.captureStackTrace(this, options.ctor ?? Ban);
  }

  /**
   * Gets formatted error output using configured formatter
   */
  public get output(): any {
    if (!this.formattedOutput) {
      const formatter = this.formatter ?? Ban.defaultFormatter;
      const initialPayload = formatter.format(
        this,
        { ...this.headers },
        [...this.sanitize],
        this.includeStackTrace
      );

      // Create sanitized payload by excluding specified fields
      this.formattedOutput = Ban.recursiveSanitize(
        initialPayload,
        this.sanitize
      );
    }
    return this.formattedOutput;
  }

  /**
   * Generates a Response object from the error
   */
  public getResponse(): Response {
    const output = this.output;
    const headers = new Headers({
      "Content-Type": this.contentType,
      ...this.headers,
    });

    if (this.allow?.length) {
      headers.set("Allow", this.allow.join(", "));
    }

    return new Response(JSON.stringify(output), {
      status: this.status,
      headers,
    });
  }

  /**
   * Gets the response content type based on formatter
   */
  public get contentType(): string {
    return this.formatter?.contentType ?? Ban.defaultFormatter.contentType;
  }

  /**
   * Sets a custom formatter for this error instance
   * @param formatter Error formatter to use
   * @returns Instance for chaining
   */
  public setFormatter(formatter: ErrorFormatter): this {
    this.formatter = formatter;
    this.formattedOutput = null; // Reset cached output
    return this;
  }

  /**
   * Static method to set default formatter for all Ban instances
   * @param formatter Error formatter to use as default
   */
  public static setDefaultFormatter(formatter: ErrorFormatter): void {
    Ban.defaultFormatter = formatter;
  }

  /**
   * Static method to get current default formatter
   * @returns Current default error formatter
   */
  public static getDefaultFormatter(): ErrorFormatter {
    return Ban.defaultFormatter;
  }

  /**
   * Type guard to check if an error is a Ban error
   * @param err Error to check
   * @param statusCode Optional status code to match
   * @returns True if error is a Ban instance with matching status
   */
  public static isBan(err: unknown, statusCode?: ErrorStatusCode): boolean {
    return err instanceof Ban && (!statusCode || err.status === statusCode);
  }

  /**
   * Wraps any error into a Ban error instance
   * @param err Error to wrap
   * @param options Ban configuration options
   * @returns Ban error instance
   */
  public static banify(err: unknown, options: BanOptions = {}): Ban {
    if (err instanceof Ban) {
      if (
        options.override === false &&
        !options.statusCode &&
        !options.message
      ) {
        return err;
      }

      return new Ban(options.message ?? err.message, {
        statusCode: options.statusCode ?? err.status,
        data: options.data ?? err.data,
        res: options.res ?? err.res,
        cause: options.cause ?? err.cause,
        formatter: options.formatter ?? err.formatter,
        headers: options.headers ?? { ...err.headers },
        sanitize: options.sanitize ?? [...err.sanitize],
        includeStackTrace: options.includeStackTrace ?? err.includeStackTrace,
        allow: options.allow ?? (err.allow ? [...err.allow] : undefined),
        ctor: Ban.banify,
      });
    }

    const statusCode = options.statusCode ?? 500;
    const message =
      options.message || (err instanceof Error ? err.message : "Unknown error");

    return new Ban(message, {
      ...options,
      statusCode,
      cause: err,
      ctor: Ban.banify,
    });
  }

  /**
   * Recursively removes keys from an object that match any in the keysToRemove array.
   * @param obj The object to sanitize.
   * @param keysToRemove Array of keys to remove.
   * @returns A new object with the specified keys removed.
   */
  private static recursiveSanitize(
    obj: any,
    keysToRemove: ReadonlyArray<string>
  ): any {
    if (Array.isArray(obj)) {
      return obj.map((item) => Ban.recursiveSanitize(item, keysToRemove));
    } else if (obj !== null && typeof obj === "object") {
      return Object.entries(obj).reduce((acc, [key, value]) => {
        if (keysToRemove.includes(key)) {
          return acc; // Omit the key
        }
        acc[key] = Ban.recursiveSanitize(value, keysToRemove);
        return acc;
      }, {} as Record<string, unknown>);
    }
    return obj;
  }

  private static resolveParameters(
    messageOrError: string | Error | undefined,
    options: BanOptions
  ): {
    statusCode: ErrorStatusCode;
    message: string;
    httpOptions: { res?: Response; cause?: unknown };
  } {
    const httpOptions = { res: options.res, cause: options.cause };
    let message: string;
    let statusCode = options.statusCode ?? 500;

    if (messageOrError instanceof Error) {
      const err = messageOrError;
      message = options.message ?? err.message;
      statusCode = err instanceof Ban ? err.status : statusCode;
    } else {
      message = messageOrError ?? options.message ?? STATUS_CODES[statusCode];
    }

    // Validate status code is error range
    if (statusCode < 400 || statusCode >= 600) {
      statusCode = 500;
      message = message || "Unknown Server Error";
    }

    return { statusCode, message, httpOptions };
  }

  // Static factory methods for common HTTP errors
  static badRequest = createStatusMethod(400);
  static unauthorized = createStatusMethod(401);
  static paymentRequired = createStatusMethod(402);
  static forbidden = createStatusMethod(403);
  static notFound = createStatusMethod(404);
  static methodNotAllowed = createStatusMethod(405);
  static notAcceptable = createStatusMethod(406);
  static proxyAuthRequired = createStatusMethod(407);
  static clientTimeout = createStatusMethod(408);
  static conflict = createStatusMethod(409);
  static resourceGone = createStatusMethod(410);
  static lengthRequired = createStatusMethod(411);
  static preconditionFailed = createStatusMethod(412);
  static entityTooLarge = createStatusMethod(413);
  static uriTooLong = createStatusMethod(414);
  static unsupportedMediaType = createStatusMethod(415);
  static rangeNotSatisfiable = createStatusMethod(416);
  static expectationFailed = createStatusMethod(417);
  static teapot = createStatusMethod(418);
  static badData = createStatusMethod(422);
  static locked = createStatusMethod(423);
  static failedDependency = createStatusMethod(424);
  static tooEarly = createStatusMethod(425);
  static preconditionRequired = createStatusMethod(428);
  static tooManyRequests = createStatusMethod(429);
  static illegal = createStatusMethod(451);
  static internal = createStatusMethod(500);
  static notImplemented = createStatusMethod(501);
  static badGateway = createStatusMethod(502);
  static serverUnavailable = createStatusMethod(503);
  static gatewayTimeout = createStatusMethod(504);
  static badImplementation = createStatusMethod(500);
}

/**
 * Helper function to create static factory methods for specific status codes
 * @private
 */
function createStatusMethod(statusCode: ErrorStatusCode) {
  return function statusMethod(
    message?: string,
    options: BanOptions = {}
  ): Ban {
    return new Ban(message || STATUS_CODES[statusCode], {
      ...options,
      statusCode,
      ctor: statusMethod,
    });
  };
}
