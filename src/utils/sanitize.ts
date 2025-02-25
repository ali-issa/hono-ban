/**
 * Sanitization utilities
 * @module hono-ban/utils/sanitize
 */

/**
 * Recursively sanitize an object by removing specified keys
 * @param obj - Object to sanitize
 * @param keysToRemove - Keys to remove from object
 */
export function sanitizeObject(
  obj: unknown,
  keysToRemove: readonly string[]
): unknown {
  if (!keysToRemove.length) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, keysToRemove));
  }

  if (obj !== null && typeof obj === "object") {
    return Object.entries(obj).reduce((acc, [key, value]) => {
      if (keysToRemove.includes(key)) {
        return acc;
      }
      acc[key] = sanitizeObject(value, keysToRemove);
      return acc;
    }, {} as Record<string, unknown>);
  }

  return obj;
}
