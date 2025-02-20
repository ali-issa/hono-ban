import { z } from "@hono/zod-openapi";
import type { ErrorFormatter } from "hono-ban";
import { Ban, STATUS_CODES } from "hono-ban";
import {
  ConstraintViolationSchema,
  ProblemDetails,
  ProblemDetailsSchema,
  ProblemErrorData,
  ValidationParam,
  ValidationParamSchema,
} from "./schemas";

/**
 * Configuration options for the RFC7807 formatter.
 * Controls how problem details are generated and formatted.
 *
 * @interface RFC7807Options
 * @property {string} [baseUrl] - Base URL for problem type URIs
 */
export interface RFC7807Options {
  baseUrl?: string;
}

/**
 * RFC 7807 Problem Details formatter implementation.
 * This class implements the Problem Details for HTTP APIs specification (RFC 7807),
 * providing a standardized format for HTTP API error responses. It converts Ban errors
 * into properly structured problem details objects with support for validation errors
 * and constraint violations.
 *
 * @class RFC7807Formatter
 * @implements {ErrorFormatter}
 * @see {@link https://datatracker.ietf.org/doc/html/rfc7807} RFC 7807 Specification
 */
export class RFC7807Formatter implements ErrorFormatter {
  /**
   * MIME type for RFC 7807 problem details.
   * As specified in RFC 7807, this content type indicates that the response
   * contains a problem details object.
   */
  readonly contentType = "application/problem+json";

  /**
   * Base URL for problem type URIs.
   * Used to generate unique identifiers for different types of problems.
   */
  private baseUrl: string;

  /**
   * Creates a new RFC7807Formatter instance.
   *
   * @param {RFC7807Options} [options={}] - Configuration options
   */
  constructor(options: RFC7807Options = {}) {
    this.baseUrl = options.baseUrl || "https://api.example.com/problems";
  }

  /**
   * Formats a Ban error into an RFC 7807 problem details object.
   * This method handles the conversion of Ban errors into standardized problem details,
   * including support for validation errors and constraint violations.
   *
   * @template T - Type extending ProblemErrorData for additional error context
   * @param {Ban<T>} error - The Ban error to format
   * @returns {ProblemDetails} A properly formatted problem details object
   */
  format<T extends ProblemErrorData>(error: Ban<T>): ProblemDetails {
    const base = {
      type: `${this.baseUrl}/${error.status}`,
      title: STATUS_CODES[error.status] || "Unknown Error",
      status: error.status,
      detail: error.message,
      instance: `urn:uuid:${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
    };

    // Handle validation errors
    if (error.data?.["invalid-params"]) {
      return ProblemDetailsSchema.parse({
        ...base,
        "invalid-params": error.data["invalid-params"],
      });
    }

    // Handle constraint violations
    if (error.data?.violations) {
      return ProblemDetailsSchema.parse({
        ...base,
        violations: error.data.violations,
      });
    }

    return ProblemDetailsSchema.parse(base);
  }

  /**
   * Sets a new base URL for problem type URIs.
   * This method allows customizing the base URL after formatter creation.
   *
   * @param {string} url - The new base URL to use
   * @returns {this} The formatter instance for method chaining
   */
  setBaseUrl(url: string): this {
    this.baseUrl = url;
    return this;
  }

  /**
   * Creates validation error data in RFC 7807 format.
   * This helper method validates and formats an array of validation errors.
   *
   * @static
   * @param {ValidationParam[]} params - Array of validation error parameters
   * @returns {Object} Formatted validation error data
   */
  static createValidationError(params: ValidationParam[]) {
    return {
      "invalid-params": ValidationParamSchema.array().parse(params),
    };
  }

  /**
   * Converts Zod validation errors to RFC 7807 format.
   * This helper method transforms Zod error objects into the standardized
   * problem details format for validation errors.
   *
   * @static
   * @param {z.ZodError} error - The Zod validation error to convert
   * @returns {Object} Formatted validation error data
   */
  static createZodValidationError(error: z.ZodError) {
    return {
      "invalid-params": ValidationParamSchema.array().parse(
        error.errors.map((e) => ({
          name: e.path.join("."),
          reason: e.message,
        }))
      ),
    };
  }

  /**
   * Creates constraint violation data in RFC 7807 format.
   * This helper method validates and formats constraint violation information.
   *
   * @static
   * @param {string} name - Name of the violated constraint
   * @param {string} reason - Reason for the violation
   * @param {string} resource - Resource where the violation occurred
   * @param {string} [constraint="unique"] - Type of constraint that was violated
   * @returns {Object} Formatted constraint violation data
   */
  static createConstraintViolation(
    name: string,
    reason: string,
    resource: string,
    constraint: string = "unique"
  ) {
    return {
      violations: ConstraintViolationSchema.array().parse([
        {
          name,
          reason,
          resource,
          constraint,
        },
      ]),
    };
  }
}
