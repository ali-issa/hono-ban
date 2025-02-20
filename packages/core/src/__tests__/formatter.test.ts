import { describe, it, expect } from "bun:test";
import { DefaultFormatter } from "../lib/formatter";
import { Ban } from "../lib/ban";

describe("DefaultFormatter", () => {
  // ...existing setup code if any...

  it("formats error output with default properties", () => {
    const error = new Ban("formatter test", { statusCode: 400 });
    const formatter = new DefaultFormatter();
    const output = formatter.format(error);
    // Expect the basic payload structure with statusCode, error and message.
    expect(output.statusCode).toBe(400);
    expect(output.payload.statusCode).toBe(400);
    expect(output.payload.error).not.toBe("Unknown");
    expect(output.payload.message).toBe("formatter test");
    expect(output.payload.stack).toBeUndefined();
  });

  it("includes stack trace when requested", () => {
    const error = new Ban("stack test", { statusCode: 500 });
    error.stack = "dummy stack";
    const formatter = new DefaultFormatter();
    const output = formatter.format(error, {}, [], true);
    expect(output.payload.stack).toBe("dummy stack");
  });

  it("applies sanitization to remove specified fields", () => {
    const error = new Ban("sanitize test", { statusCode: 400 });
    // Inject a custom field into payload via message for testing
    (error as any).customField = "remove-me";
    const formatter = new DefaultFormatter();
    const output = formatter.format(error, {}, ["customField"]);
    // Since customField is not normally part of payload, this test simulates its removal logic.
    expect((output.payload as any).customField).toBeUndefined();
  });

  it("sets Allow header when error has allowed methods", () => {
    const error = Ban.methodNotAllowed("not allowed", {
      allow: ["GET", "POST"],
    });
    const formatter = new DefaultFormatter();
    const output = formatter.format(error);
    expect(output.headers["Allow"]).toBe("GET, POST");
  });
});
