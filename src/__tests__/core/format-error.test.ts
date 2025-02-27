import { describe, it, expect, mock } from "bun:test";
import { formatError, createErrorResponse } from "../../core/format-error";
import { createError } from "../../core/create-error";
import type { BanError, ErrorFormatter } from "../../types";

describe("formatError", () => {
  it("calls the formatter with the error", () => {
    const error = createError({ statusCode: 404, message: "Not found" });

    const mockFormatter: ErrorFormatter = {
      contentType: "application/json",
      format: mock((err) => ({ formatted: true, status: err.status })),
    };

    const result = formatError(error, mockFormatter);

    expect(mockFormatter.format).toHaveBeenCalledWith(
      error,
      undefined,
      undefined,
      undefined
    );
    expect(result).toEqual({ formatted: true, status: 404 });
  });

  it("passes options to the formatter", () => {
    const error = createError({ statusCode: 500 });
    const headers = { "X-Test": "value" };
    const sanitize = ["password", "token"];

    const mockFormatter: ErrorFormatter = {
      contentType: "application/json",
      format: mock(() => ({ formatted: true })),
    };

    formatError(error, mockFormatter, {
      headers,
      sanitize,
      includeStackTrace: true,
    });

    expect(mockFormatter.format).toHaveBeenCalledWith(
      error,
      headers,
      sanitize,
      true
    );
  });
});

describe("createErrorResponse", () => {
  it("creates a Response with the formatted error", () => {
    const error = createError({ statusCode: 400, message: "Bad request" });
    const formatted = { statusCode: 400, message: "Bad request" };

    const response = createErrorResponse(error, formatted);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("includes custom headers from the error", () => {
    const error = createError({
      statusCode: 400,
      headers: { "X-Custom": "value" },
    });

    const response = createErrorResponse(error, {});

    expect(response.headers.get("X-Custom")).toBe("value");
  });

  it("adds Allow header for errors with allow property", () => {
    const error = createError({
      statusCode: 405,
      allow: ["GET", "POST"],
    });

    const response = createErrorResponse(error, {});

    expect(response.headers.get("Allow")).toBe("GET, POST");
  });

  it("sanitizes developer errors in production", async () => {
    // Mock process.env.NODE_ENV
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      const error = createError({
        statusCode: 500,
        message: "Internal server error with sensitive details",
        data: { isDeveloperError: true, sensitiveInfo: "secret" },
      });

      const formatted = {
        statusCode: 500,
        message: "Original error message",
        data: { sensitiveInfo: "secret" },
      };

      const response = createErrorResponse(error, formatted);

      // Get the response body as text
      const responseText = await response.text();
      const body = JSON.parse(responseText) as {
        statusCode: number;
        error: string;
        message: string;
        data?: unknown;
      };

      // Should use sanitized message
      expect(body.message).toBe("An internal server error occurred");
      // Should not include sensitive data
      expect(body.data).toBeUndefined();
    } finally {
      // Restore original NODE_ENV
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("preserves the original formatted error in non-production", async () => {
    // Mock process.env.NODE_ENV
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    try {
      const error = createError({
        statusCode: 500,
        message: "Detailed error",
        data: { isDeveloperError: true, details: "stack trace" },
      });

      const formatted = {
        statusCode: 500,
        message: "Detailed error",
        data: { details: "stack trace" },
      };

      const response = createErrorResponse(error, formatted);

      // Get the response body as text
      const responseText = await response.text();
      const responseJson = JSON.parse(responseText);

      // The response body should match the original formatted error
      expect(responseJson).toEqual(formatted);
    } finally {
      // Restore original NODE_ENV
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
