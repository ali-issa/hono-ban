import { describe, test, expect, beforeEach } from "bun:test";
import { z } from "@hono/zod-openapi";
import { Ban } from "hono-ban";
import type { ProblemErrorData } from "../lib/rfc7807/schemas";
import {
  RFC7807Formatter,
  ValidationParamSchema,
  ConstraintViolationSchema,
  ProblemDetailsSchema,
  createRFC7807Hook,
} from "../lib/rfc7807";

describe("RFC7807Formatter", () => {
  let formatter: RFC7807Formatter;
  const defaultBaseUrl = "https://api.example.com/problems";
  const customBaseUrl = "https://custom.example.com/errors";

  beforeEach(() => {
    formatter = new RFC7807Formatter();
  });

  describe("constructor", () => {
    test("should initialize with default baseUrl", () => {
      expect(formatter["baseUrl"]).toBe(defaultBaseUrl);
    });

    test("should initialize with custom baseUrl", () => {
      const customFormatter = new RFC7807Formatter({ baseUrl: customBaseUrl });
      expect(customFormatter["baseUrl"]).toBe(customBaseUrl);
    });
  });

  describe("setBaseUrl", () => {
    test("should update baseUrl and return this for chaining", () => {
      const result = formatter.setBaseUrl(customBaseUrl);
      expect(formatter["baseUrl"]).toBe(customBaseUrl);
      expect(result).toBe(formatter);
    });
  });

  describe("format", () => {
    const mockUUID = "123e4567-e89b-12d3-a456-426614174000";
    const mockDate = "2024-02-20T07:32:38.000Z";

    test("should format basic error correctly", () => {
      // Mock crypto.randomUUID and Date
      const originalRandomUUID = crypto.randomUUID;
      const originalToISOString = Date.prototype.toISOString;

      crypto.randomUUID = () => mockUUID;
      Date.prototype.toISOString = () => mockDate;

      // Create a Ban error with empty ProblemErrorData
      const error = new Ban<ProblemErrorData>("Resource not found", {
        statusCode: 404,
        data: {},
      });
      const result = formatter.format(error);

      expect(result).toEqual({
        type: `${defaultBaseUrl}/404`,
        title: "Not Found",
        status: 404,
        detail: "Resource not found",
        instance: `urn:uuid:${mockUUID}`,
        timestamp: mockDate,
      });

      // Restore original functions
      crypto.randomUUID = originalRandomUUID;
      Date.prototype.toISOString = originalToISOString;
    });

    test("should format validation error correctly", () => {
      // Mock crypto.randomUUID and Date
      const originalRandomUUID = crypto.randomUUID;
      const originalToISOString = Date.prototype.toISOString;

      crypto.randomUUID = () => mockUUID;
      Date.prototype.toISOString = () => mockDate;

      const validationData = RFC7807Formatter.createValidationError([
        { name: "email", reason: "Invalid email format" },
      ]);

      const validationError = new Ban<ProblemErrorData>("Validation failed", {
        statusCode: 400,
        data: validationData,
      });

      const result = formatter.format(validationError);

      expect(result).toEqual({
        type: `${defaultBaseUrl}/400`,
        title: "Bad Request",
        status: 400,
        detail: "Validation failed",
        instance: `urn:uuid:${mockUUID}`,
        timestamp: mockDate,
        "invalid-params": [{ name: "email", reason: "Invalid email format" }],
      });

      // Restore original functions
      crypto.randomUUID = originalRandomUUID;
      Date.prototype.toISOString = originalToISOString;
    });

    test("should format constraint violation correctly", () => {
      // Mock crypto.randomUUID and Date
      const originalRandomUUID = crypto.randomUUID;
      const originalToISOString = Date.prototype.toISOString;

      crypto.randomUUID = () => mockUUID;
      Date.prototype.toISOString = () => mockDate;

      const constraintData = RFC7807Formatter.createConstraintViolation(
        "email",
        "Email already exists",
        "users",
        "unique"
      );

      const constraintError = new Ban<ProblemErrorData>(
        "Constraint violation",
        {
          statusCode: 409,
          data: constraintData,
        }
      );

      const result = formatter.format(constraintError);

      expect(result).toEqual({
        type: `${defaultBaseUrl}/409`,
        title: "Conflict",
        status: 409,
        detail: "Constraint violation",
        instance: `urn:uuid:${mockUUID}`,
        timestamp: mockDate,
        violations: [
          {
            name: "email",
            reason: "Email already exists",
            resource: "users",
            constraint: "unique",
          },
        ],
      });

      // Restore original functions
      crypto.randomUUID = originalRandomUUID;
      Date.prototype.toISOString = originalToISOString;
    });
  });

  describe("static methods", () => {
    describe("createValidationError", () => {
      test("should create validation error data", () => {
        const params = [
          { name: "email", reason: "Invalid format" },
          { name: "age", reason: "Must be positive" },
        ];

        const result = RFC7807Formatter.createValidationError(params);

        expect(result).toEqual({
          "invalid-params": params,
        });
      });

      test("should throw on invalid validation params", () => {
        const invalidParams = [{ invalid: "data" }];

        expect(() => {
          RFC7807Formatter.createValidationError(invalidParams as any);
        }).toThrow();
      });
    });

    describe("createZodValidationError", () => {
      test("should convert Zod error to validation error data", () => {
        const schema = z.object({
          email: z.string().email(),
          age: z.number().positive(),
        });

        const result = schema.safeParse({
          email: "invalid",
          age: -1,
        });

        if (!result.success) {
          const validationError = RFC7807Formatter.createZodValidationError(
            result.error
          );

          expect(validationError["invalid-params"]).toHaveLength(2);
          expect(validationError["invalid-params"]).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: expect.any(String),
                reason: expect.any(String),
              }),
            ])
          );
        }
      });
    });

    describe("createConstraintViolation", () => {
      test("should create constraint violation data", () => {
        const result = RFC7807Formatter.createConstraintViolation(
          "email",
          "Email exists",
          "users"
        );

        expect(result).toEqual({
          violations: [
            {
              name: "email",
              reason: "Email exists",
              resource: "users",
              constraint: "unique",
            },
          ],
        });
      });

      test("should accept custom constraint type", () => {
        const result = RFC7807Formatter.createConstraintViolation(
          "balance",
          "Insufficient funds",
          "accounts",
          "minimum"
        );

        expect(result.violations[0].constraint).toBe("minimum");
      });
    });
  });
});

describe("Schemas", () => {
  describe("ValidationParamSchema", () => {
    test("should validate correct data", () => {
      const data = {
        name: "email",
        reason: "Invalid format",
      };

      expect(() => ValidationParamSchema.parse(data)).not.toThrow();
    });

    test("should reject invalid data", () => {
      const data = {
        name: 123,
        reason: true,
      };

      expect(() => ValidationParamSchema.parse(data)).toThrow();
    });
  });

  describe("ConstraintViolationSchema", () => {
    test("should validate correct data", () => {
      const data = {
        name: "email",
        reason: "Already exists",
        resource: "users",
        constraint: "unique",
      };

      expect(() => ConstraintViolationSchema.parse(data)).not.toThrow();
    });

    test("should reject invalid data", () => {
      const data = {
        name: 123,
        reason: true,
        resource: null,
        constraint: {},
      };

      expect(() => ConstraintViolationSchema.parse(data)).toThrow();
    });
  });

  describe("ProblemDetailsSchema", () => {
    test("should validate correct data", () => {
      const data = {
        type: "https://example.com/problems/not-found",
        title: "Not Found",
        status: 404,
        detail: "Resource not found",
        instance: "urn:uuid:123",
        timestamp: new Date().toISOString(),
      };

      expect(() => ProblemDetailsSchema.parse(data)).not.toThrow();
    });

    test("should validate with validation params", () => {
      const data = {
        type: "https://example.com/problems/bad-request",
        title: "Bad Request",
        status: 400,
        detail: "Validation failed",
        instance: "urn:uuid:123",
        timestamp: new Date().toISOString(),
        "invalid-params": [{ name: "email", reason: "Invalid format" }],
      };

      expect(() => ProblemDetailsSchema.parse(data)).not.toThrow();
    });

    test("should validate with constraint violations", () => {
      const data = {
        type: "https://example.com/problems/conflict",
        title: "Conflict",
        status: 409,
        detail: "Constraint violation",
        instance: "urn:uuid:123",
        timestamp: new Date().toISOString(),
        violations: [
          {
            name: "email",
            reason: "Already exists",
            resource: "users",
            constraint: "unique",
          },
        ],
      };

      expect(() => ProblemDetailsSchema.parse(data)).not.toThrow();
    });

    test("should reject invalid data", () => {
      const data = {
        type: "not-a-url",
        title: 123,
        status: "400",
        detail: null,
        instance: {},
        timestamp: "invalid-date",
      };

      expect(() => ProblemDetailsSchema.parse(data)).toThrow();
    });
  });
});

describe("RFC7807 Hook", () => {
  const mockContext = {} as any;

  describe("createRFC7807Hook", () => {
    test("should handle Zod validation errors", async () => {
      const hook = createRFC7807Hook();
      const schema = z.object({
        email: z.string().email(),
      });

      const result = schema.safeParse({ email: "invalid" });

      if (!result.success) {
        const response = await hook(
          { success: false, error: result.error },
          mockContext
        );
        expect(response).toBeDefined();

        if (response instanceof Response) {
          expect(response.status).toBe(400);
          expect(response.headers.get("Content-Type")).toBe(
            "application/problem+json"
          );
          const responseData = (await response.json()) as { type: string };
          expect(responseData.type).toContain("/400");
        }
      }
    });

    test("should pass through on success", () => {
      const hook = createRFC7807Hook();
      const result = hook({ success: true, data: {} }, mockContext);

      expect(result).toBeUndefined();
    });

    test("should pass through on non-Zod errors", () => {
      const hook = createRFC7807Hook();
      const result = hook(
        { success: false, error: new Error("Other error") as any },
        mockContext
      );

      expect(result).toBeUndefined();
    });

    test("should use custom baseUrl when provided", async () => {
      const customBaseUrl = "https://custom.example.com/errors";
      const hook = createRFC7807Hook({ baseUrl: customBaseUrl });
      const schema = z.object({
        email: z.string().email(),
      });

      const result = schema.safeParse({ email: "invalid" });

      if (!result.success) {
        const response = await hook(
          { success: false, error: result.error },
          mockContext
        );
        expect(response).toBeDefined();

        if (response instanceof Response) {
          const responseData = (await response.json()) as { type: string };
          expect(responseData.type).toStartWith(customBaseUrl);
        }
      }
    });
  });
});
