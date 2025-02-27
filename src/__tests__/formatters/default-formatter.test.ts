import { describe, it, expect } from "bun:test";
import { defaultFormatter } from "../../formatters/default";
import { createError } from "../../core/create-error";
import { STATUS_CODES } from "../../constants";

describe("defaultFormatter", () => {
  it("has the correct content type", () => {
    expect(defaultFormatter.contentType).toBe("application/json");
  });

  it("formats a basic error", () => {
    const error = createError({ statusCode: 404, message: "Not found" });
    const formatted = defaultFormatter.format(error);

    expect(formatted).toEqual({
      statusCode: 404,
      error: STATUS_CODES[404],
      message: "Not found",
    });
  });

  it("passes custom headers to the formatter but doesn't include them in output", () => {
    const error = createError({ statusCode: 400 });
    const headers = { "X-Custom": "value" };

    const formatted = defaultFormatter.format(error, headers);

    // Headers should not be in the formatted output
    expect((formatted as any).headers).toBeUndefined();
  });

  it("doesn't add the Allow header to the response body", () => {
    const error = createError({
      statusCode: 405,
      allow: ["GET", "POST"],
    });

    const formatted = defaultFormatter.format(error);

    // The formatted output should not have headers
    expect((formatted as any).headers).toBeUndefined();
  });

  it("includes stack trace when includeStackTrace is true", () => {
    const error = createError({ statusCode: 500 });
    const formatted = defaultFormatter.format(error, {}, [], true);

    expect(formatted.stack).toBeDefined();
  });

  it("includes stack trace for developer errors", () => {
    const error = createError({
      statusCode: 500,
      data: { isDeveloperError: true },
    });

    const formatted = defaultFormatter.format(error);

    expect(formatted.stack).toBeDefined();
  });

  it("includes cause stack when available", () => {
    const cause = new Error("Original error");
    const error = createError({
      statusCode: 500,
      cause,
    });

    const formatted = defaultFormatter.format(error, {}, [], true);

    expect(formatted.causeStack).toBeDefined();
  });

  it("includes error data when provided", () => {
    const data = { field: "email", reason: "invalid format" };
    const error = createError({
      statusCode: 400,
      data,
    });

    const formatted = defaultFormatter.format(error);

    expect(formatted.data).toEqual(data);
  });

  it("sanitizes specified fields", () => {
    const data = {
      user: {
        id: 123,
        password: "secret",
        email: "user@example.com",
        profile: {
          token: "abc123",
        },
      },
    };

    const error = createError({
      statusCode: 400,
      data,
    });

    const formatted = defaultFormatter.format(error, {}, ["password", "token"]);

    // Data should be sanitized
    expect(formatted.data).toEqual({
      user: {
        id: 123,
        email: "user@example.com",
        profile: {},
      },
    });
  });
});
