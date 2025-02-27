/**
 * RFC 7807 Problem Details hooks for Hono applications
 * @module hono-ban/formatters/rfc7807/hooks
 */

import { ZodError } from "zod";
import { Hook } from "@hono/zod-openapi";
import { Env } from "hono";
import { badRequest } from "../../factories";
import type {
  RFC7807FormatterOptions as RFC7807Options,
  BanOptions,
} from "../../types";
import { createRFC7807ZodValidationError } from "./formatter";

/**
 * Create a Hono hook that formats validation errors using RFC 7807
 *
 * This hook throws a badRequest error that will be caught and processed by the ban middleware.
 * You can provide options to override the default behavior of the middleware.
 *
 * @example
 * // Basic usage - inherits all settings from middleware
 * app.openapi(route, handler, { onError: createRFC7807Hook() });
 *
 * @example
 * // With custom message
 * app.openapi(route, handler, {
 *   onError: createRFC7807Hook({ message: "Custom validation error" })
 * });
 *
 * @example
 * // With custom formatter and sanitization
 * app.openapi(route, handler, {
 *   onError: createRFC7807Hook({
 *     formatter: customFormatter,
 *     sanitize: ['password', 'token']
 *   })
 * });
 */
export function createRFC7807Hook<E extends Env = Env>(
  options?: RFC7807Options & Partial<BanOptions>
): Hook<any, E, any, any> {
  return (result, c) => {
    if (
      !result.success &&
      "error" in result &&
      result.error instanceof ZodError
    ) {
      // Create the validation error data
      const validationData = createRFC7807ZodValidationError(result.error);

      // Throw badRequest with both the validation data and any override options
      throw badRequest({
        message: options?.message || "Validation Error",
        data: validationData,
        // Pass through any override options
        formatter: options?.formatter,
        headers: options?.headers,
        sanitize: options?.sanitize,
        includeStackTrace: options?.includeStackTrace,
      });
    }
  };
}

/**
 * Pre-configured RFC 7807 hook with default options
 *
 * This is a convenience export that uses the default options.
 * It will throw a badRequest error that will be caught and processed by the ban middleware.
 */
export const rfc7807Hook = createRFC7807Hook<Env>();
