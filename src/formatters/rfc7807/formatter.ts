/**
 * RFC 7807 Problem Details formatter implementation
 * @module hono-ban/formatters/rfc7807/formatter
 */

import { z } from "@hono/zod-openapi";
import { STATUS_CODES } from "../../constants";
import type { BanError, ErrorFormatter } from "../../types";
import type {
  ProblemDetails,
  ProblemErrorData,
  ValidationParam,
  RFC7807FormatterOptions as RFC7807Options,
} from "../../types";
import {
  ConstraintViolationSchema,
  ProblemDetailsSchema,
  ValidationParamSchema,
} from "./schemas";

/**
 * Create an RFC 7807 Problem Details formatter
 */
export function createRFC7807Formatter(
  options: RFC7807Options = {}
): ErrorFormatter {
  const baseUrl = options.baseUrl || "https://api.example.com/problems";

  return {
    contentType: "application/problem+json",

    format<T extends ProblemErrorData>(error: BanError<T>): ProblemDetails {
      const base = {
        type: `${baseUrl}/${error.status}`,
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
    },
  };
}

/**
 * Create validation error data in RFC 7807 format
 */
export function createValidationError(params: ValidationParam[]) {
  return {
    "invalid-params": ValidationParamSchema.array().parse(params),
  };
}

/**
 * Convert Zod validation errors to RFC 7807 format
 */
export function createZodValidationError(error: z.ZodError) {
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
 * Create constraint violation data in RFC 7807 format
 */
export function createConstraintViolation(
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
