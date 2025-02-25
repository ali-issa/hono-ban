/**
 * Zod schemas for RFC 7807 Problem Details
 * @module hono-ban/formatters/rfc7807/schemas
 */

import { z } from "@hono/zod-openapi";
import type {
  ValidationParam,
  ConstraintViolation,
  ProblemDetails,
  ProblemErrorData,
} from "../../types";

/**
 * Schema for validation error parameters
 */
export const ValidationParamSchema = z
  .object({
    name: z.string(),
    reason: z.string(),
  })
  .openapi("ValidationParam");

/**
 * Schema for constraint violations
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
 * Schema for additional error data in problem details
 */
export const ProblemErrorDataSchema = z.object({
  "invalid-params": z.array(ValidationParamSchema).optional(),
  violations: z.array(ConstraintViolationSchema).optional(),
});

/**
 * Schema for complete RFC 7807 problem details
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
