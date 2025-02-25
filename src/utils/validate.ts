/**
 * Validation utilities
 * @module hono-ban/utils/validate
 */

import type { ErrorStatusCode } from "../types/error";

/**
 * Validate and normalize HTTP error status code
 * @param code - Status code to validate
 */
export function validateStatusCode(code: number): ErrorStatusCode {
  // Handle invalid inputs
  if (typeof code !== "number" || isNaN(code)) {
    return 500;
  }

  // Ensure code is in error range
  if (code < 400 || code >= 600) {
    return 500;
  }

  return code as ErrorStatusCode;
}
