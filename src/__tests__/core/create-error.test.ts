import { describe, it, expect } from "bun:test";
import { createError } from "../../core/create-error";
import { STATUS_CODES } from "../../constants";

describe("createError", () => {
  it("creates a basic error with default 500 status", () => {
    const error = createError({});
    expect(error.isBan).toBe(true);
    expect(error.status).toBe(500);
    expect(error.message).toBe(STATUS_CODES[500]);
  });

  it("creates an error with a custom message", () => {
    const error = createError({ statusCode: 400, message: "custom message" });
    expect(error.status).toBe(400);
    expect(error.message).toBe("custom message");
  });

  it("normalizes invalid status codes to 500", () => {
    // @ts-expect-error - Testing invalid status code
    const error = createError({ statusCode: 200, message: "message" });
    expect(error.status).toBe(500);
    expect(error.message).toBe("message");
  });

  it("adds optional properties when provided", () => {
    const testData = { field: "email", reason: "invalid format" };
    const testHeaders = { "X-Custom-Header": "test" };
    const testAllow = ["GET", "POST"];

    const error = createError({
      statusCode: 400,
      message: "Bad Request",
      data: testData,
      headers: testHeaders,
      allow: testAllow,
    });

    expect(error.status).toBe(400);
    expect(error.message).toBe("Bad Request");
    expect(error.data).toEqual(testData);
    expect(error.headers).toEqual(testHeaders);
    expect(error.allow).toEqual(testAllow);
  });

  it("handles string allow value by converting to array", () => {
    const error = createError({
      statusCode: 405,
      allow: "GET",
    });

    expect(error.allow).toEqual(["GET"]);
  });

  it("captures cause and causeStack from Error instances", () => {
    const cause = new Error("Original error");
    const error = createError({
      statusCode: 500,
      cause,
    });

    expect(error.cause).toBe(cause);
    expect(typeof error.causeStack).toBe("string");
  });

  it("captures a stack trace", () => {
    const error = createError({});
    expect(error.stack).toBeDefined();
  });

  it("creates an error with a specific status code", () => {
    const error = createError({ statusCode: 404 });
    expect(error.status).toBe(404);
    expect(error.message).toBe(STATUS_CODES[404]);
  });

  it("creates an error with both status code and message", () => {
    const error = createError({ statusCode: 403, message: "Forbidden access" });
    expect(error.status).toBe(403);
    expect(error.message).toBe("Forbidden access");
  });

  it("preserves the original headers object", () => {
    const headers = { "X-Test": "value" };
    const error = createError({ headers });

    // Ensure headers are copied, not referenced
    expect(error.headers).toEqual(headers);
    expect(error.headers).not.toBe(headers);

    // Modify the original headers
    headers["X-Test"] = "modified";

    // Error headers should remain unchanged
    expect(error.headers?.["X-Test"]).toBe("value");
  });

  it("preserves the original allow array", () => {
    const allow = ["GET", "POST"];
    const error = createError({ allow });

    // Ensure allow is copied, not referenced
    expect(error.allow).toEqual(allow);
    expect(error.allow).not.toBe(allow);

    // Modify the original array
    allow.push("PUT");

    // Error allow should remain unchanged
    expect(error.allow?.length).toBe(2);
    expect(error.allow).toEqual(["GET", "POST"]);
  });
});
