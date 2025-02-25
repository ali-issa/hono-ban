import { describe, it, expect } from "bun:test";
import { sanitizeObject } from "../../utils/sanitize";

describe("sanitizeObject", () => {
  it("returns the original object if no keys to remove", () => {
    const obj = { a: 1, b: 2, c: 3 };
    expect(sanitizeObject(obj, [])).toBe(obj);
  });

  it("removes specified keys from a simple object", () => {
    const obj = { a: 1, b: 2, c: 3, password: "secret" };
    const result = sanitizeObject(obj, ["password"]) as Record<string, unknown>;

    expect(result).toEqual({ a: 1, b: 2, c: 3 });
    expect("password" in result).toBe(false);
  });

  it("removes multiple specified keys", () => {
    const obj = {
      a: 1,
      password: "secret",
      token: "abc123",
      username: "user",
    };

    const result = sanitizeObject(obj, ["password", "token"]) as Record<
      string,
      unknown
    >;

    expect(result).toEqual({ a: 1, username: "user" });
    expect("password" in result).toBe(false);
    expect("token" in result).toBe(false);
  });

  it("handles nested objects", () => {
    const obj = {
      user: {
        name: "John",
        password: "secret",
        profile: {
          bio: "Developer",
          token: "xyz789",
        },
      },
      settings: {
        theme: "dark",
        token: "abc123",
      },
    };

    const result = sanitizeObject(obj, ["password", "token"]);

    expect(result).toEqual({
      user: {
        name: "John",
        profile: {
          bio: "Developer",
        },
      },
      settings: {
        theme: "dark",
      },
    });
  });

  it("handles arrays", () => {
    const arr = [
      { id: 1, name: "Item 1", token: "abc" },
      { id: 2, name: "Item 2", password: "secret" },
      { id: 3, name: "Item 3" },
    ];

    const result = sanitizeObject(arr, ["token", "password"]);

    expect(result).toEqual([
      { id: 1, name: "Item 1" },
      { id: 2, name: "Item 2" },
      { id: 3, name: "Item 3" },
    ]);
  });

  it("handles arrays within objects", () => {
    const obj = {
      users: [
        { id: 1, name: "User 1", password: "pass1" },
        { id: 2, name: "User 2", password: "pass2" },
      ],
      settings: { token: "abc123" },
    };

    const result = sanitizeObject(obj, ["password", "token"]);

    expect(result).toEqual({
      users: [
        { id: 1, name: "User 1" },
        { id: 2, name: "User 2" },
      ],
      settings: {},
    });
  });

  it("handles primitive values", () => {
    expect(sanitizeObject("string", ["key"])).toBe("string");
    expect(sanitizeObject(123, ["key"])).toBe(123);
    expect(sanitizeObject(true, ["key"])).toBe(true);
    expect(sanitizeObject(null, ["key"])).toBe(null);
    expect(sanitizeObject(undefined, ["key"])).toBe(undefined);
  });

  it("returns empty object when all keys are removed", () => {
    const obj = { password: "secret", token: "abc123" };
    const result = sanitizeObject(obj, ["password", "token"]);

    expect(result).toEqual({});
  });
});
