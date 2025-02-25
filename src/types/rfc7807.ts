/**
 * Type definitions for RFC 7807 Problem Details format.
 *
 * This module provides type definitions for the RFC 7807 Problem Details format,
 * including interfaces and types for validation parameters, constraint violations,
 * and the complete problem details structure.
 *
 * @module hono-ban/types/rfc7807
 * @see {@link https://datatracker.ietf.org/doc/html/rfc7807} RFC 7807 Problem Details
 */

/**
 * Represents a validation error parameter in an RFC 7807 problem details object.
 * Used to indicate specific validation failures in request parameters.
 *
 * @interface ValidationParam
 * @property {string} name - The name of the parameter that failed validation
 * @property {string} reason - The reason why the parameter failed validation
 */
export interface ValidationParam {
  name: string;
  reason: string;
}

/**
 * Represents a constraint violation in an RFC 7807 problem details object.
 * Used to indicate violations of business rules or data constraints.
 *
 * @interface ConstraintViolation
 * @property {string} name - The name of the violated constraint
 * @property {string} reason - The reason why the constraint was violated
 * @property {string} resource - The resource or entity where the violation occurred
 * @property {string} constraint - The specific constraint that was violated
 */
export interface ConstraintViolation {
  name: string;
  reason: string;
  resource: string;
  constraint: string;
}

/**
 * Additional error data that can be included in an RFC 7807 problem details object.
 * This interface extends the standard problem details with validation and constraint information.
 *
 * @interface ProblemErrorData
 * @property {ValidationParam[]} [invalid-params] - Array of validation errors
 * @property {ConstraintViolation[]} [violations] - Array of constraint violations
 */
export interface ProblemErrorData {
  "invalid-params"?: ValidationParam[];
  violations?: ConstraintViolation[];
}

/**
 * Complete RFC 7807 problem details object structure.
 * This interface represents the full problem details format as defined in RFC 7807,
 * with additional properties for validation and constraint violation data.
 *
 * @interface ProblemDetails
 * @extends ProblemErrorData
 * @property {string} type - URI reference that identifies the problem type
 * @property {string} title - Short, human-readable summary of the problem
 * @property {number} status - HTTP status code (400-599)
 * @property {string} detail - Human-readable explanation specific to this occurrence
 * @property {string} instance - URI reference that identifies the specific occurrence
 * @property {string} timestamp - ISO 8601 datetime when the error occurred
 */
export interface ProblemDetails extends ProblemErrorData {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  timestamp: string;
}

/**
 * Hook function for customizing RFC 7807 problem details before formatting.
 * This type represents a function that can modify the problem details object
 * before it is serialized into the final response.
 *
 * @callback ProblemDetailsHook
 * @param {ProblemDetails} details - The problem details object to modify
 * @returns {ProblemDetails} The modified problem details object
 */
export type ProblemDetailsHook = (details: ProblemDetails) => ProblemDetails;

/**
 * Configuration options for the RFC 7807 formatter.
 * These options control how problem details are generated and formatted.
 *
 * @interface RFC7807FormatterOptions
 * @property {string} [baseUrl="https://api.example.com/problems"] - Base URL for problem type URIs
 * @property {ProblemDetailsHook[]} [hooks=[]] - Array of hooks for customizing problem details
 */
export interface RFC7807FormatterOptions {
  baseUrl?: string;
  hooks?: ProblemDetailsHook[];
}
