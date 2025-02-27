/**
 * RFC 7807 Problem Details formatter implementation
 * @module hono-ban/formatters/rfc7807/formatter
 */

import { z } from "@hono/zod-openapi";
import { STATUS_CODES } from "../../constants";
import type { BanError, ErrorFormatter } from "../../types";
import type {
  RFC7807Details,
  RFC7807ErrorData,
  RFC7807ValidationParam,
  RFC7807FormatterOptions as RFC7807Options,
} from "../../types";
import {
  RFC7807ConstraintViolationSchema,
  RFC7807DetailsSchema,
  RFC7807ValidationParamSchema,
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

    format<T extends RFC7807ErrorData>(error: BanError<T>): RFC7807Details {
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
        return RFC7807DetailsSchema.parse({
          ...base,
          "invalid-params": error.data["invalid-params"],
        });
      }

      // Handle constraint violations
      if (error.data?.violations) {
        return RFC7807DetailsSchema.parse({
          ...base,
          violations: error.data.violations,
        });
      }

      return RFC7807DetailsSchema.parse(base);
    },
  };
}

/**
 * Create validation error data in RFC 7807 format
 */
export function createRFC7807ValidationError(params: RFC7807ValidationParam[]) {
  return {
    "invalid-params": RFC7807ValidationParamSchema.array().parse(params),
  };
}

/**
 * Convert Zod validation errors to RFC 7807 format
 */
export function createRFC7807ZodValidationError(error: z.ZodError) {
  return {
    "invalid-params": RFC7807ValidationParamSchema.array().parse(
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
export function createRFC7807ConstraintViolation(
  name: string,
  reason: string,
  resource: string,
  constraint: string = "unique"
) {
  return {
    violations: RFC7807ConstraintViolationSchema.array().parse([
      {
        name,
        reason,
        resource,
        constraint,
      },
    ]),
  };
}
