/**
 * Error formatters for Hono Ban.
 *
 * This package provides a collection of error formatters that implement various
 * standard error response formats. Each formatter ensures consistent error handling
 * while maintaining type safety and following web standards.
 *
 * @module hono-ban/formatters
 * @see {@link https://github.com/honojs/hono} Hono web framework
 */

// Re-export implementations
export * from "./lib/rfc7807";

// Re-export shared types
export type { RFC7807FormatterOptions, ProblemDetailsHook } from "./types";
