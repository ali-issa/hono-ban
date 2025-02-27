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

import { z } from "@hono/zod-openapi";
import {
  RFC7807ValidationParamSchema,
  RFC7807ConstraintViolationSchema,
  RFC7807ErrorDataSchema,
  RFC7807DetailsSchema,
} from "../formatters/rfc7807/schemas";

/**
 * Represents a validation error parameter in an RFC 7807 problem details object.
 * Used to indicate specific validation failures in request parameters.
 *
 * @type RFC7807ValidationParam
 * @property {string} name - The name of the parameter that failed validation
 * @property {string} reason - The reason why the parameter failed validation
 */
export type RFC7807ValidationParam = z.infer<
  typeof RFC7807ValidationParamSchema
>;

/**
 * Represents a constraint violation in an RFC 7807 problem details object.
 * Used to indicate violations of business rules or data constraints.
 *
 * @type RFC7807ConstraintViolation
 * @property {string} name - The name of the violated constraint
 * @property {string} reason - The reason why the constraint was violated
 * @property {string} resource - The resource or entity where the violation occurred
 * @property {string} constraint - The specific constraint that was violated
 */
export type RFC7807ConstraintViolation = z.infer<
  typeof RFC7807ConstraintViolationSchema
>;

/**
 * Additional error data that can be included in an RFC 7807 problem details object.
 * This interface extends the standard problem details with validation and constraint information.
 *
 * @type RFC7807ErrorData
 * @property {RFC7807ValidationParam[]} [invalid-params] - Array of validation errors
 * @property {RFC7807ConstraintViolation[]} [violations] - Array of constraint violations
 */
export type RFC7807ErrorData = z.infer<typeof RFC7807ErrorDataSchema>;

/**
 * Complete RFC 7807 problem details object structure.
 * This interface represents the full problem details format as defined in RFC 7807,
 * with additional properties for validation and constraint violation data.
 *
 * @type RFC7807Details
 * @property {string} type - URI reference that identifies the problem type
 * @property {string} title - Short, human-readable summary of the problem
 * @property {number} status - HTTP status code (400-599)
 * @property {string} [detail] - Human-readable explanation specific to this occurrence
 * @property {string} [instance] - URI reference that identifies the specific occurrence
 * @property {string} [timestamp] - ISO 8601 datetime when the error occurred
 */
export type RFC7807Details = z.infer<typeof RFC7807DetailsSchema>;

/**
 * Hook function for customizing RFC 7807 problem details before formatting.
 * This type represents a function that can modify the problem details object
 * before it is serialized into the final response.
 *
 * @callback RFC7807DetailsHook
 * @param {RFC7807Details} details - The problem details object to modify
 * @returns {RFC7807Details} The modified problem details object
 */
export type RFC7807DetailsHook = (details: RFC7807Details) => RFC7807Details;

/**
 * Configuration options for the RFC 7807 formatter.
 * These options control how problem details are generated and formatted.
 *
 * @interface RFC7807FormatterOptions
 * @property {string} [baseUrl="https://api.example.com/problems"] - Base URL for problem type URIs
 * @property {RFC7807DetailsHook[]} [hooks=[]] - Array of hooks for customizing problem details
 */
export interface RFC7807FormatterOptions {
  baseUrl?: string;
  hooks?: RFC7807DetailsHook[];
}
