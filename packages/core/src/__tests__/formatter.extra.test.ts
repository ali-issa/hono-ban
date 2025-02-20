import { describe, it, expect } from "bun:test";
import { DefaultFormatter } from "../lib/formatter";
import { Ban } from "../lib/ban";

describe("DefaultFormatter extra edge cases", () => {
  // Test that stack trace is omitted when includeStackTrace is false
  it("omits the stack field when includeStackTrace is false", () => {
    const error = new Ban("stack omitted", { statusCode: 500 });
    error.stack = "should not be included";
    const formatter = new DefaultFormatter();
    const output = formatter.format(error, {}, [], false);
    expect(output.payload).not.toHaveProperty("stack");
  });

  // Test that sanitization works even when payload fields are conditionally added
  it("removes fields from payload even if they are conditionally added", () => {
    const error = new Ban("sanitize missing", { statusCode: 400 });
    // Force set a property that would typically not exist
    (error as any).extra = "remove-me";
    const formatter = new DefaultFormatter();
    const output = formatter.format(error, {}, ["extra"]);
    expect((output.payload as any).extra).toBeUndefined();
  });
});
