/**
 * RFC 7807 Problem Details hooks for Hono applications.
 *
 * This module provides hooks that integrate RFC 7807 problem details formatting
 * with Hono's validation middleware. The hooks automatically convert validation
 * errors into properly formatted problem details responses, ensuring consistent
 * error handling across the application.
 *
 * @module hono-ban/formatters/rfc7807/hooks
 */

import { ZodError } from "zod";
import { Hook } from "@hono/zod-openapi";
import { Env } from "hono";
import { Ban } from "hono-ban";

import { RFC7807Formatter, RFC7807Options } from "./formatter";

/**
 * Creates a Hono hook that formats validation errors using RFC 7807.
 * This factory function creates a hook that intercepts Zod validation errors
 * and converts them into properly formatted problem details responses.
 *
 * @function createRFC7807Hook
 * @param {RFC7807Options} [options] - Configuration options for the RFC7807 formatter
 * @returns {Hook} A Hono hook function that handles validation errors
 * @example
 * ```typescript
 * import { OpenAPIHono } from '@hono/zod-openapi';
 * import { rfc7807Hook } from 'hono-ban/formatters';
 *
 * // Set as the default validation hook for all routes
 * export const app = new OpenAPIHono({
 *   defaultHook: rfc7807Hook,
 * });
 * ```
 */
export const createRFC7807Hook = (
  options?: RFC7807Options
): Hook<any, Env, any, any> => {
  const formatter = new RFC7807Formatter(options);

  return (result, c) => {
    if (
      !result.success &&
      "error" in result &&
      result.error instanceof ZodError
    ) {
      const ban = Ban.badRequest("Validation Error", {
        data: RFC7807Formatter.createZodValidationError(result.error),
      });
      ban.setFormatter(formatter);
      return ban.getResponse();
    }
  };
};

/**
 * Pre-configured RFC 7807 hook with default options.
 * This is a convenience export that provides a hook instance ready for use
 * with OpenAPIHono's defaultHook option.
 *
 * @constant rfc7807Hook
 * @type {Hook}
 * @example
 * ```typescript
 * import { OpenAPIHono } from '@hono/zod-openapi';
 * import { rfc7807Hook } from 'hono-ban/formatters';
 *
 * export const app = new OpenAPIHono({
 *   defaultHook: rfc7807Hook,
 * });
 * ```
 */
export const rfc7807Hook = createRFC7807Hook();
