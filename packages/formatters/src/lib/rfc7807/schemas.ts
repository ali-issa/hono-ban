/**
 * Zod schemas for RFC 7807 Problem Details.
 *
 * This module defines the Zod schemas used to validate and serialize RFC 7807
 * problem details objects. These schemas ensure that all error responses conform
 * to the RFC 7807 specification while providing OpenAPI documentation through
 * the @hono/zod-openapi integration.
 *
 * @module hono-ban/formatters/rfc7807/schemas
 * @see {@link https://datatracker.ietf.org/doc/html/rfc7807} RFC 7807 Specification
 */

import { z } from "@hono/zod-openapi";

/**
 * Schema for validation error parameters.
 * Defines the structure for individual validation failures in a request.
 *
 * @constant ValidationParamSchema
 */
export const ValidationParamSchema = z
  .object({
    name: z.string(),
    reason: z.string(),
  })
  .openapi("ValidationParam");

/**
 * Schema for constraint violations.
 * Defines the structure for business rule or data constraint violations.
 *
 * @constant ConstraintViolationSchema
 */
export const ConstraintViolationSchema = z
  .object({
    name: z.string(),
    reason: z.string(),
    resource: z.string(),
    constraint: z.string(),
  })
  .openapi("ConstraintViolation");

/**
 * Schema for additional error data in problem details.
 * Extends the base problem details with validation and constraint information.
 *
 * @constant ProblemErrorDataSchema
 */
export const ProblemErrorDataSchema = z.object({
  "invalid-params": z.array(ValidationParamSchema).optional(),
  violations: z.array(ConstraintViolationSchema).optional(),
});

/**
 * Schema for complete RFC 7807 problem details.
 * Implements the full problem details structure as defined in RFC 7807,
 * including additional error data extensions.
 *
 * @constant ProblemDetailsSchema
 */
export const ProblemDetailsSchema = z
  .object({
    type: z.string().url(),
    title: z.string(),
    status: z.number().int().min(400).max(599),
    detail: z.string(),
    instance: z.string(),
    timestamp: z.string().datetime(),
  })
  .merge(ProblemErrorDataSchema)
  .openapi("ProblemDetails");

/**
 * Type for validation error parameters.
 * @typedef {z.infer<typeof ValidationParamSchema>} ValidationParam
 */
export type ValidationParam = z.infer<typeof ValidationParamSchema>;

/**
 * Type for constraint violations.
 * @typedef {z.infer<typeof ConstraintViolationSchema>} ConstraintViolation
 */
export type ConstraintViolation = z.infer<typeof ConstraintViolationSchema>;

/**
 * Type for complete problem details objects.
 * @typedef {z.infer<typeof ProblemDetailsSchema>} ProblemDetails
 */
export type ProblemDetails = z.infer<typeof ProblemDetailsSchema>;

/**
 * Type for additional error data in problem details.
 * @typedef {z.infer<typeof ProblemErrorDataSchema>} ProblemErrorData
 */
export type ProblemErrorData = z.infer<typeof ProblemErrorDataSchema>;
