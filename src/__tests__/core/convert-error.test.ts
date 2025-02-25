import { describe, it, expect } from "bun:test";
import { isBanError, convertToBanError } from "../../core/convert-error";
import { createError } from "../../core/create-error";

describe("isBanError", () => {
  it("returns true for valid BanError objects", () => {
    const error = createError({ statusCode: 404 });
    expect(isBanError(error)).toBe(true);
  });

  it("returns false for regular Error objects", () => {
    const error = new Error("Regular error");
    expect(isBanError(error)).toBe(false);
  });

  it("returns false for null values", () => {
    expect(isBanError(null)).toBe(false);
  });

  it("returns false for undefined values", () => {
    expect(isBanError(undefined)).toBe(false);
  });

  it("returns false for objects without isBan property", () => {
    const obj = { status: 404, message: "Not found" };
    expect(isBanError(obj)).toBe(false);
  });

  it("returns false for objects with incorrect isBan value", () => {
    const obj = { status: 404, message: "Not found", isBan: false };
    expect(isBanError(obj)).toBe(false);
  });

  it("returns true when statusCode matches", () => {
    const error = createError({ statusCode: 404 });
    expect(isBanError(error, 404)).toBe(true);
  });

  it("returns false when statusCode doesn't match", () => {
    const error = createError({ statusCode: 404 });
    expect(isBanError(error, 500)).toBe(false);
  });
});

describe("convertToBanError", () => {
  it("returns the original error if already a BanError", () => {
    const original = createError({ statusCode: 404, message: "Not found" });
    const converted = convertToBanError(original);

    expect(converted.status).toBe(404);
    expect(converted.message).toBe("Not found");
    expect(converted.isBan).toBe(true);
  });

  it("converts a standard Error to BanError", () => {
    const original = new Error("Standard error");
    const converted = convertToBanError(original);

    expect(converted.status).toBe(500);
    expect(converted.message).toBe("Standard error");
    expect(converted.isBan).toBe(true);
    expect(converted.cause).toBe(original);
  });

  it("converts a string to BanError", () => {
    const converted = convertToBanError("String error");

    expect(converted.status).toBe(500);
    expect(converted.message).toBe("String error");
    expect(converted.isBan).toBe(true);
  });

  it("converts unknown values to BanError with default message", () => {
    const converted = convertToBanError(123);

    expect(converted.status).toBe(500);
    expect(converted.message).toBe("Unknown error");
    expect(converted.isBan).toBe(true);
  });

  it("applies custom options when converting", () => {
    const original = new Error("Original error");
    const converted = convertToBanError(original, {
      statusCode: 400,
      message: "Custom message",
      data: { field: "test" },
    });

    expect(converted.status).toBe(400);
    expect(converted.message).toBe("Custom message");
    expect(converted.data).toEqual({ field: "test" });
    expect(converted.cause).toBe(original);
  });

  it("merges options with existing BanError", () => {
    const original = createError({
      statusCode: 404,
      message: "Not found",
      data: { id: "123" },
      headers: { "X-Original": "value" },
    });

    const converted = convertToBanError(original, {
      statusCode: 400,
      message: "Bad request",
      data: { field: "test" },
      headers: { "X-New": "newvalue" },
    });

    expect(converted.status).toBe(400);
    expect(converted.message).toBe("Bad request");
    expect(converted.data).toEqual({ field: "test" });
    expect(converted.headers).toEqual({
      "X-Original": "value",
      "X-New": "newvalue",
    });
  });

  it("preserves the original BanError's allow property if not overridden", () => {
    const original = createError({
      statusCode: 405,
      allow: ["GET", "POST"],
    });

    const converted = convertToBanError(original, {
      statusCode: 400,
    });

    expect(converted.allow).toEqual(["GET", "POST"]);
  });

  it("overrides the original BanError's allow property when specified", () => {
    const original = createError({
      statusCode: 405,
      allow: ["GET", "POST"],
    });

    const converted = convertToBanError(original, {
      allow: "PUT",
    });

    expect(converted.allow).toEqual(["PUT"]);
  });

  it("preserves stack trace from original BanError", () => {
    const original = createError({ statusCode: 500 });
    const converted = convertToBanError(original);

    // Both should have stack traces
    expect(original.stack).toBeDefined();
    expect(converted.stack).toBeDefined();

    // If both stacks exist, they should be the same
    if (original.stack && converted.stack) {
      expect(converted.stack).toBe(original.stack);
    }
  });
});
