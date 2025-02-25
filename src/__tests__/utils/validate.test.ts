import { describe, it, expect } from "bun:test";
import { validateStatusCode } from "../../utils/validate";

describe("validateStatusCode", () => {
  it("returns the same code for valid error status codes", () => {
    expect(validateStatusCode(400)).toBe(400);
    expect(validateStatusCode(404)).toBe(404);
    expect(validateStatusCode(500)).toBe(500);
    expect(validateStatusCode(503)).toBe(503);
  });

  it("returns 500 for status codes below 400", () => {
    expect(validateStatusCode(100)).toBe(500);
    expect(validateStatusCode(200)).toBe(500);
    expect(validateStatusCode(300)).toBe(500);
    expect(validateStatusCode(399)).toBe(500);
  });

  it("returns 500 for status codes at or above 600", () => {
    expect(validateStatusCode(600)).toBe(500);
    expect(validateStatusCode(700)).toBe(500);
    expect(validateStatusCode(999)).toBe(500);
  });

  it("handles edge cases", () => {
    // @ts-expect-error - Testing with invalid input
    expect(validateStatusCode(null)).toBe(500);
    // @ts-expect-error - Testing with invalid input
    expect(validateStatusCode(undefined)).toBe(500);
    // @ts-expect-error - Testing with invalid input
    expect(validateStatusCode("400")).toBe(500);

    expect(validateStatusCode(NaN)).toBe(500);
  });
});
