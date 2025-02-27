/**
 * Zod schemas for RFC 7807 Problem Details
 * @module hono-ban/formatters/rfc7807/schemas
 */

import { z } from "@hono/zod-openapi";

/**
 * Schema for RFC 7807 validation error parameters
 */
export const RFC7807ValidationParamSchema = z.object({
  name: z.string().openapi({
    example: "username",
    description: "The field name that failed validation",
  }),
  reason: z.string().openapi({
    example: "String must contain at least 3 character(s)",
    description: "The reason for validation failure",
  }),
});

/**
 * Schema for RFC 7807 constraint violations
 */
export const RFC7807ConstraintViolationSchema = z.object({
  name: z.string().openapi({
    example: "email",
    description: "The field name that violated a constraint",
  }),
  reason: z.string().openapi({
    example: "Email already exists",
    description: "The reason for the constraint violation",
  }),
  resource: z.string().openapi({
    example: "user",
    description: "The resource type that contains the constraint",
  }),
  constraint: z.string().openapi({
    example: "unique",
    description: "The type of constraint that was violated",
  }),
});

/**
 * Schema for additional error data in RFC 7807 problem details
 */
export const RFC7807ErrorDataSchema = z.object({
  "invalid-params": z.array(RFC7807ValidationParamSchema).optional(),
  violations: z.array(RFC7807ConstraintViolationSchema).optional(),
});

/**
 * Schema for complete RFC 7807 problem details
 */
export const RFC7807DetailsSchema = z
  .object({
    type: z.string().url().openapi({
      example: "https://api.example.com/problems/validation-error",
      description: "A URI reference that identifies the problem type",
    }),
    title: z.string().openapi({
      example: "Validation Failed",
      description: "A short, human-readable summary of the problem type",
    }),
    status: z.number().int().min(400).max(599).openapi({
      example: 400,
      description: "The HTTP status code",
    }),

    // Optional fields per RFC7807
    detail: z.string().optional().openapi({
      example: "The request contains invalid fields",
      description:
        "A human-readable explanation specific to this occurrence of the problem",
    }),
    instance: z.string().url().optional().openapi({
      example: "urn:uuid:6b56944d-5e89-4b4d-9ca7-c1be3d1f0e3f",
      description:
        "A URI reference that identifies the specific occurrence of the problem",
    }),

    // Extensions for validation errors
    timestamp: z.string().datetime().optional().openapi({
      example: "2025-02-26T12:34:56.789Z",
      description: "When the error occurred",
    }),
  })
  .merge(RFC7807ErrorDataSchema);
