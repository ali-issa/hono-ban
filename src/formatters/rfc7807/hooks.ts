/**
 * RFC 7807 Problem Details hooks for Hono applications
 * @module hono-ban/formatters/rfc7807/hooks
 */

import { ZodError } from "zod";
import { Hook } from "@hono/zod-openapi";
import { Env } from "hono";
import { badRequest } from "../../factories";
import { formatError, createErrorResponse } from "../../core";
import type { RFC7807FormatterOptions as RFC7807Options } from "../../types";

import { createRFC7807Formatter } from "./formatter";
import { createZodValidationError } from "./formatter";

/**
 * Create a Hono hook that formats validation errors using RFC 7807
 */
export function createRFC7807Hook(
  options?: RFC7807Options
): Hook<any, Env, any, any> {
  const formatter = createRFC7807Formatter(options);

  return (result, c) => {
    if (
      !result.success &&
      "error" in result &&
      result.error instanceof ZodError
    ) {
      // Create the error
      const error = badRequest("Validation Error", {
        data: createZodValidationError(result.error),
      });

      // Format the error using RFC7807
      const formatted = formatError(error, formatter);

      // Create and return the response
      return createErrorResponse(error, formatted);
    }
  };
}

/**
 * Pre-configured RFC 7807 hook with default options
 */
export const rfc7807Hook = createRFC7807Hook();
