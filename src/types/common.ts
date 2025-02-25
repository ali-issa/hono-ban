/**
 * Common shared types
 * @module hono-ban/types/common
 */

/**
 * Type for HTTP headers
 */
export type Headers = Record<string, string>;

/**
 * Type for allowed HTTP methods
 */
export type AllowedMethods = string | string[];
