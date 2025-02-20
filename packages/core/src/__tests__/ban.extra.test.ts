import { describe, it, expect } from "bun:test";
import { Ban } from "../lib/ban";

describe("Ban extra edge cases", () => {
  // Test for missing message and ensuring payload does not include an undefined message key
  it("should include the default message key when no message is provided", () => {
    const error = new Ban(undefined, { statusCode: 401 });
    console.log(error.output.payload);
    expect(error.output.payload).toHaveProperty("message");
  });

  // Test banify override behavior for unchanged overrides
  it("should create a new error when override is false and properties differ", () => {
    const original = Ban.notFound("not found");
    const updated = Ban.banify(original, { statusCode: 400, override: false });
    // Even if override is false, new properties should be applied resulting in a new Ban instance
    expect(updated).not.toBe(original);
    expect(updated.output.statusCode).toBe(400);
    expect(updated.output.payload.message).toBe("not found");
  });

  // Test handling when additional data is merged correctly
  it("merges additional data correctly", () => {
    const error = new Ban("data test", {
      statusCode: 422,
      data: { key: "initial" },
    });
    const updated = Ban.banify(error, {
      data: { key: "updated", extra: true },
    });
    expect(updated.data).toEqual({ key: "updated", extra: true });
  });
});
