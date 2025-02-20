import { describe, it, expect } from "bun:test";
import { Ban } from "../lib/ban";

// A simple custom formatter for testing setFormatter and sanitization.
class CustomFormatter {
  contentType = "application/custom-json";
  format(
    error: any,
    headers: Record<string, string>,
    sanitize: string[],
    includeStackTrace: boolean
  ) {
    // Return an object with a payload that includes a secret field (to test sanitization)
    return {
      payload: {
        message: error.message,
        custom: true,
        secret: "should be removed",
      },
      headers,
      stack: includeStackTrace ? error.stack : undefined,
    };
  }
}

describe("Ban", () => {
  describe("constructor", () => {
    it("creates a basic error with default 500 status", () => {
      const error = new Ban();
      expect(error.isBan).toBe(true);
      expect(error.output.statusCode).toBe(500);
      // Assumes that the default formatter returns a payload.error
      expect(error.output.payload.error).toBe("Internal Server Error");
    });

    it("creates an error with a custom message", () => {
      const error = new Ban("custom message", { statusCode: 400 });
      expect(error.output.statusCode).toBe(400);
      expect(error.output.payload.message).toBe("custom message");
    });

    it("handles Error instances", () => {
      const originalError = new Error("test error");
      const error = new Ban(originalError, { statusCode: 400 });
      expect(error.output.statusCode).toBe(400);
      expect(error.output.payload.message).toBe("test error");
    });

    it("normalizes invalid status codes to 500", () => {
      // If provided a status code outside the error range, it should default to 500.
      // @ts-expect-error
      const error = new Ban("message", { statusCode: 200 });
      expect(error.output.statusCode).toBe(500);
      // When message is provided it remains unchanged
      expect(error.output.payload.message).toBe("message");
    });
  });

  describe("static methods", () => {
    it("creates a 404 error using notFound", () => {
      const error = Ban.notFound("resource not found");
      expect(error.output.statusCode).toBe(404);
      expect(error.output.payload.message).toBe("resource not found");
    });

    it("creates a 400 error using badRequest", () => {
      const error = Ban.badRequest("invalid input");
      expect(error.output.statusCode).toBe(400);
      expect(error.output.payload.message).toBe("invalid input");
    });

    it("creates a 405 error with allowed methods", () => {
      const error = Ban.methodNotAllowed("method not allowed", {
        allow: ["GET", "POST"],
      });
      expect(error.output.statusCode).toBe(405);
      expect(error.output.headers.Allow).toBe("GET, POST");
    });
  });

  describe("banify", () => {
    it("converts a regular Error to a Ban error", () => {
      const error = new Error("test error");
      const banError = Ban.banify(error, { statusCode: 400 });
      expect(banError.isBan).toBe(true);
      expect(banError.output.statusCode).toBe(400);
      expect(banError.output.payload.message).toBe("test error");
    });

    it("preserves an existing Ban error when override is false and no new properties are provided", () => {
      const original = Ban.notFound("not found");
      const result = Ban.banify(original, { override: false });
      expect(result).toBe(original);
      expect(result.output.statusCode).toBe(404);
    });

    it("allows updating specific properties even when override is false", () => {
      const original = Ban.notFound("not found");
      const result = Ban.banify(original, {
        statusCode: 400,
        override: false,
      });
      expect(result).not.toBe(original);
      expect(result.output.statusCode).toBe(400);
      expect(result.output.payload.message).toBe("not found");
    });

    it("overrides an existing Ban error when specified", () => {
      const original = Ban.notFound("not found");
      const result = Ban.banify(original, {
        statusCode: 400,
        message: "bad request",
      });
      expect(result.output.statusCode).toBe(400);
      expect(result.output.payload.message).toBe("bad request");
    });
  });

  describe("isBan", () => {
    it("identifies Ban errors", () => {
      const error = Ban.badRequest();
      expect(Ban.isBan(error)).toBe(true);
    });

    it("identifies Ban errors with a specific status", () => {
      const error = Ban.notFound();
      expect(Ban.isBan(error, 404)).toBe(true);
      expect(Ban.isBan(error, 400)).toBe(false);
    });

    it("returns false for non-Ban errors", () => {
      const error = new Error();
      expect(Ban.isBan(error)).toBe(false);
    });
  });

  describe("error data", () => {
    it("includes additional error data", () => {
      const error = Ban.badRequest("invalid input", {
        data: { field: "email", reason: "invalid format" },
      });
      expect(error.data).toEqual({
        field: "email",
        reason: "invalid format",
      });
    });

    it("preserves data when banifying", () => {
      const original = Ban.badRequest("invalid", { data: { field: "email" } });
      const result = Ban.banify(original, {
        statusCode: 422,
        data: { validation: "failed" },
      });
      expect(result.data).toEqual({ validation: "failed" });
    });
  });

  describe("developer errors", () => {
    it("marks internal errors as developer errors", () => {
      const error = Ban.badImplementation("database error");
      expect(error.isDeveloperError).toBe(true);
      expect(error.output.statusCode).toBe(500);
    });
  });

  describe("custom formatter and output behavior", () => {
    it("uses a custom formatter when set", () => {
      const error = Ban.badRequest("custom formatter test");
      error.setFormatter(new CustomFormatter());
      const output = error.output;
      // Check that the custom formatter output is used
      expect(output.payload.custom).toBe(true);
      // The custom formatter returns a secret field that should be removed if sanitized
      // By default, no sanitize keys were provided so secret remains.
      expect(output.payload.secret).toBe("should be removed");
    });

    it("removes fields specified in the sanitize array", () => {
      const error = Ban.badRequest("sanitize test", { sanitize: ["secret"] });
      error.setFormatter(new CustomFormatter());
      const output = error.output;
      // The custom formatter returns a secret field; it should be removed
      expect(output.payload.secret).toBeUndefined();
    });

    it("caches the formatted output", () => {
      const error = Ban.badRequest("cache test");
      const output1 = error.output;
      const output2 = error.output;
      expect(output1).toBe(output2);
    });

    it("resets cached output when a new formatter is set", () => {
      const error = Ban.badRequest("reset cache test");
      const initialOutput = error.output;
      error.setFormatter(new CustomFormatter());
      // After setting a new formatter, the output should be recalculated (and not equal by reference)
      expect(error.output).not.toBe(initialOutput);
    });

    it("passes includeStackTrace flag to the formatter", () => {
      const error = Ban.internal("stack trace test", {
        includeStackTrace: true,
      });
      // Use a custom formatter that includes the stack property when includeStackTrace is true.
      error.setFormatter(new CustomFormatter());
      const output = error.output;
      expect(output.stack).toBeDefined();
    });

    it("returns the correct content type from the getter", () => {
      const error = Ban.badRequest("content type test");
      // Default formatter content type should be returned if no custom formatter is set.
      const defaultContentType = error.contentType;
      expect(defaultContentType).toBeDefined();
      // Now, set a custom formatter and ensure contentType is updated.
      error.setFormatter(new CustomFormatter());
      expect(error.contentType).toBe("application/custom-json");
    });
  });

  describe("getResponse method", () => {
    it("returns a Response with proper headers and status", () => {
      const error = Ban.methodNotAllowed("method not allowed", {
        allow: ["PUT", "DELETE"],
        headers: { "X-Custom-Header": "custom" },
      });
      const response = error.getResponse();
      expect(response.status).toBe(error.status);
      const contentType = response.headers.get("Content-Type");
      expect(contentType).toBe(error.contentType);
      // Check that Allow header is correctly set
      expect(response.headers.get("Allow")).toBe("PUT, DELETE");
      // Check that custom header is included
      expect(response.headers.get("X-Custom-Header")).toBe("custom");
    });

    it("serializes the output to JSON", async () => {
      const error = Ban.badRequest("JSON serialization test");
      const response = error.getResponse();
      const text = await response.text();
      expect(() => JSON.parse(text)).not.toThrow();
      const parsed = JSON.parse(text);
      expect(parsed.payload.message).toBe("JSON serialization test");
    });
  });
});
