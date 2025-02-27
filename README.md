# hono-ban 💥

[![npm version](https://badge.fury.io/js/hono-ban.svg)](https://badge.fury.io/js/hono-ban)
[![Bundle Size](https://img.shields.io/bundlephobia/min/hono-ban)](https://bundlephobia.com/result?p=hono-ban)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/hono-ban)](https://bundlephobia.com/result?p=hono-ban)

HTTP-friendly error objects for [Hono](https://hono.dev), inspired by [Boom](https://github.com/hapijs/boom).

> **Warning**: This package is not production-ready. It is under active development with daily updates and could change significantly.

## Table of Contents

- [Installation](#installation)
- [Overview](#overview)
- [Key Features](#key-features)
- [Usage](#usage)
  - [Basic Usage](#basic-usage)
  - [Error Middleware](#error-middleware)
  - [Custom Error Data](#custom-error-data)
  - [Error Conversion](#error-conversion)
  - [Error Formatting](#error-formatting)
  - [OpenAPI Integration](#openapi-integration)
- [Formatters](#formatters)
  - [Default Formatter](#default-formatter)
  - [RFC7807 (Problem Details) Formatter](#rfc7807-problem-details-formatter)
- [API Reference](#api-reference)
  - [Error Factories](#error-factories)
  - [Core Functions](#core-functions)
  - [Middleware](#middleware)
  - [Types](#types)
- [Best Practices](#best-practices)
- [Contributing](#contributing)
- [License](#license)

## Installation

```bash
npm install hono-ban
```

## Overview

hono-ban provides a comprehensive error handling solution for Hono.js applications. It offers a set of factory functions for creating HTTP-friendly error objects, middleware for handling errors, and utilities for error conversion and formatting.

## Key Features

- **Type-Safe Error Creation**: Factory functions for all standard HTTP error codes (4xx and 5xx)
- **Middleware Integration**: Seamless integration with Hono's middleware system
- **Flexible Error Data**: Support for custom error data and metadata
- **Error Conversion**: Convert any error to a standardized format
- **Customizable Formatting**: Extensible error formatting capabilities
- **Standard Formatters**: Built-in support for common error formats like RFC7807 Problem Details
- **Security Features**: Built-in sanitization to prevent sensitive data leakage
- **Developer-Friendly**: Detailed stack traces in development, sanitized in production

## Usage

### Basic Usage

```typescript
import { Hono } from "hono";
import ban, { notFound, badRequest } from "hono-ban";

// Create a Hono app
const app = new Hono();

// IMPORTANT: Add the ban middleware for error handling to work
app.use(ban());

// Create a 404 Not Found error
const error = notFound("User not found");

// Create a 400 Bad Request error with custom data
const validationError = badRequest("Invalid input", {
  data: {
    invalidFields: ["email", "password"],
  },
});

// Example route that throws an error
app.get("/users/:id", (c) => {
  // The thrown error will be caught and formatted by the ban middleware
  throw notFound(`User with ID ${c.req.param("id")} not found`);
});
```

> **Note**: The ban middleware is required for errors to be automatically caught and formatted. Without it, thrown errors won't be properly handled.

### Error Middleware

The ban middleware is **required** to catch and format errors thrown in your routes. Without this middleware, errors will not be properly handled.

#### Basic Usage

```typescript
import { Hono } from "hono";
import ban from "hono-ban";
import { notFound } from "hono-ban";

const app = new Hono();

// Add the error handling middleware with default options
// This is REQUIRED for error handling to work
app.use(ban());

// Routes can throw errors that will be handled automatically
app.get("/users/:id", (c) => {
  const user = findUser(c.req.param("id"));
  if (!user) {
    throw notFound(`User with ID ${c.req.param("id")} not found`);
  }
  return c.json(user);
});
```

#### Advanced Configuration

```typescript
import { Hono } from "hono";
import ban from "hono-ban";
import { notFound } from "hono-ban";

const app = new Hono();

// Add the error handling middleware with advanced configuration
app.use(
  ban({
    formatter: customFormatter, // Custom error formatter
    sanitize: ["password", "token"], // Fields to remove from error output
    includeStackTrace: process.env.NODE_ENV !== "production", // Only include stack traces in development
    headers: { "X-Powered-By": "hono-ban" }, // Default headers to include in error responses
  })
);

// Routes can throw errors that will be handled automatically
app.get("/users/:id", (c) => {
  const user = findUser(c.req.param("id"));
  if (!user) {
    throw notFound(`User with ID ${c.req.param("id")} not found`);
  }
  return c.json(user);
});
```

### Custom Error Data

```typescript
import { badRequest } from "hono-ban";

// Add custom data to your errors
const error = badRequest("Validation failed", {
  data: {
    field: "email",
    reason: "Invalid format",
    suggestion: "Use a valid email address",
  },
  headers: {
    "X-Error-Code": "VAL_001",
  },
});
```

### Error Conversion

```typescript
import { convertToBanError, isBanError } from "hono-ban";

try {
  // Some operation that might throw
  await someOperation();
} catch (err) {
  // Convert any error to a BanError
  const banError = convertToBanError(err, {
    statusCode: 500,
    message: "An error occurred during processing",
  });

  // Check if an error is a BanError
  if (isBanError(err)) {
    console.log("Status code:", err.status);
  }
}
```

### Error Formatting

```typescript
import { formatError, createErrorResponse, defaultFormatter } from "hono-ban";
import type { ErrorFormatter } from "hono-ban";

// Create a custom formatter
const myFormatter: ErrorFormatter = {
  contentType: "application/json",
  format(error, headers, sanitize, includeStackTrace) {
    return {
      code: error.status,
      message: error.message,
      timestamp: new Date().toISOString(),
      details: error.data,
    };
  },
};

// Format an error using the custom formatter
const formatted = formatError(banError, myFormatter, {
  includeStackTrace: true,
});

// Create a Response from the formatted error
const response = createErrorResponse(banError, formatted);
```

### OpenAPI Integration

hono-ban integrates seamlessly with [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi) to provide standardized error handling for OpenAPI-validated routes.

```typescript
import { OpenAPIHono } from "@hono/zod-openapi";
import { ban, createRFC7807Formatter, rfc7807Hook } from "hono-ban";
import { RFC7807DetailsSchema } from "hono-ban/formatters/rfc7807";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { Env } from "./config/env";

// Create an OpenAPIHono instance with the RFC7807 hook for validation errors
const app = new OpenAPIHono<Env>({ defaultHook: rfc7807Hook });

// IMPORTANT: Add the ban middleware with RFC7807 formatter
app.use(
  ban({
    formatter: createRFC7807Formatter({
      baseUrl: "https://api.example.com/errors",
    }),
  })
);

// Define a schema for your data
const NoteSchema = z.object({
  name: z.string().max(10),
});

// Create an OpenAPI route with error handling
const route = createRoute({
  method: "post",
  path: "/notes",
  request: {
    body: {
      content: {
        "application/json": {
          schema: NoteSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: "Successfully created note",
      content: {
        "application/json": {
          schema: z.object({
            data: z.object({
              id: z.string(),
              type: z.string(),
              attributes: NoteSchema,
            }),
          }),
        },
      },
    },
    400: {
      description: "Validation error",
      content: {
        "application/json": {
          schema: RFC7807DetailsSchema, // Use the RFC7807 schema for errors
        },
      },
    },
  },
});

// Register the route
app.openapi(route, async (c) => {
  // Handle the request
  // Any validation errors will be automatically formatted using RFC7807
  return c.json({
    data: {
      /* response data */
    },
  });
});
```

#### Key Benefits

1. **Automatic Validation Error Handling**: The `rfc7807Hook` automatically converts Zod validation errors to RFC7807 format.
2. **Standardized Error Responses**: All errors follow the RFC7807 specification.
3. **OpenAPI Documentation**: Error schemas are properly documented in your OpenAPI specification.
4. **Type Safety**: Full TypeScript support for request and response validation.

> **Note**: The ban middleware is still required when using OpenAPI integration. The `rfc7807Hook` handles validation errors, but the middleware is needed to catch and format other errors.

## Formatters

hono-ban includes several built-in formatters for common error response formats.

### Default Formatter

The default formatter produces a simple JSON structure with status code, error name, and optional message and data.

```typescript
import { defaultFormatter } from "hono-ban";

// Example output:
// {
//   "statusCode": 400,
//   "payload": {
//     "statusCode": 400,
//     "error": "Bad Request",
//     "message": "Invalid input",
//     "data": { "field": "email" }
//   }
// }
```

### RFC7807 (Problem Details) Formatter

The RFC7807 formatter implements the [RFC 7807: Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc7807) specification.

```typescript
import { createRFC7807Formatter, createValidationError } from "hono-ban";
// or more specifically:
import {
  createRFC7807Formatter,
  createValidationError,
} from "hono-ban/formatters/rfc7807";

// Create the formatter
const formatter = createRFC7807Formatter({
  baseUrl: "https://api.example.com/problems",
});

// Use with middleware
app.use(ban({ formatter }));

// Create validation error data
app.post("/users", (c) => {
  const { email } = await c.req.json();

  if (!isValidEmail(email)) {
    throw badRequest("Invalid input", {
      data: createValidationError([
        { name: "email", reason: "Must be a valid email" },
      ]),
    });
  }

  // Process valid request...
});
```

#### Example RFC7807 Output

```json
{
  "type": "https://api.example.com/problems/400",
  "title": "Bad Request",
  "status": 400,
  "detail": "Invalid input",
  "instance": "urn:uuid:...",
  "timestamp": "2024-02-20T12:00:00.000Z",
  "invalid-params": [
    {
      "name": "email",
      "reason": "Must be a valid email"
    }
  ]
}
```

#### RFC7807 Helper Functions

The RFC7807 formatter provides several helper functions:

- `createValidationError(params)`: Create validation error data
- `createZodValidationError(error)`: Convert Zod validation errors to RFC7807 format
- `createConstraintViolation(name, reason, resource, constraint)`: Create constraint violation data
- `createRFC7807Hook(options)`: Create a Hono hook for Zod OpenAPI validation (see [OpenAPI Integration](#openapi-integration) for usage)

## API Reference

### Error Factories

hono-ban provides factory functions for all standard HTTP error codes:

#### Client Errors (4xx)

- `badRequest(messageOrOptions?, options?)`: 400 Bad Request
- `unauthorized(messageOrOptions?, options?)`: 401 Unauthorized
- `paymentRequired(messageOrOptions?, options?)`: 402 Payment Required
- `forbidden(messageOrOptions?, options?)`: 403 Forbidden
- `notFound(messageOrOptions?, options?)`: 404 Not Found
- `methodNotAllowed(messageOrOptions?, options?)`: 405 Method Not Allowed
- `notAcceptable(messageOrOptions?, options?)`: 406 Not Acceptable
- `proxyAuthRequired(messageOrOptions?, options?)`: 407 Proxy Authentication Required
- `clientTimeout(messageOrOptions?, options?)`: 408 Request Timeout
- `conflict(messageOrOptions?, options?)`: 409 Conflict
- `resourceGone(messageOrOptions?, options?)`: 410 Gone
- `lengthRequired(messageOrOptions?, options?)`: 411 Length Required
- `preconditionFailed(messageOrOptions?, options?)`: 412 Precondition Failed
- `entityTooLarge(messageOrOptions?, options?)`: 413 Payload Too Large
- `uriTooLong(messageOrOptions?, options?)`: 414 URI Too Long
- `unsupportedMediaType(messageOrOptions?, options?)`: 415 Unsupported Media Type
- `rangeNotSatisfiable(messageOrOptions?, options?)`: 416 Range Not Satisfiable
- `expectationFailed(messageOrOptions?, options?)`: 417 Expectation Failed
- `teapot(messageOrOptions?, options?)`: 418 I'm a Teapot
- `misdirectedRequest(messageOrOptions?, options?)`: 421 Misdirected Request
- `badData(messageOrOptions?, options?)`: 422 Unprocessable Entity
- `locked(messageOrOptions?, options?)`: 423 Locked
- `failedDependency(messageOrOptions?, options?)`: 424 Failed Dependency
- `tooEarly(messageOrOptions?, options?)`: 425 Too Early
- `upgradeRequired(messageOrOptions?, options?)`: 426 Upgrade Required
- `preconditionRequired(messageOrOptions?, options?)`: 428 Precondition Required
- `tooManyRequests(messageOrOptions?, options?)`: 429 Too Many Requests
- `headerFieldsTooLarge(messageOrOptions?, options?)`: 431 Request Header Fields Too Large
- `illegal(messageOrOptions?, options?)`: 451 Unavailable For Legal Reasons

#### Server Errors (5xx)

- `internal(messageOrOptions?, options?)`: 500 Internal Server Error
- `notImplemented(messageOrOptions?, options?)`: 501 Not Implemented
- `badGateway(messageOrOptions?, options?)`: 502 Bad Gateway
- `serverUnavailable(messageOrOptions?, options?)`: 503 Service Unavailable
- `gatewayTimeout(messageOrOptions?, options?)`: 504 Gateway Timeout
- `httpVersionNotSupported(messageOrOptions?, options?)`: 505 HTTP Version Not Supported
- `variantAlsoNegotiates(messageOrOptions?, options?)`: 506 Variant Also Negotiates
- `insufficientStorage(messageOrOptions?, options?)`: 507 Insufficient Storage
- `loopDetected(messageOrOptions?, options?)`: 508 Loop Detected
- `notExtended(messageOrOptions?, options?)`: 510 Not Extended
- `networkAuthRequired(messageOrOptions?, options?)`: 511 Network Authentication Required
- `badImplementation(messageOrOptions?, options?)`: 500 Internal Server Error (marked as developer error)

### Core Functions

- `createError(options)`: Create a new error object with the given options
- `convertToBanError(err, options?)`: Convert any error into a BanError
- `isBanError(err, statusCode?)`: Type guard to check if a value is a BanError
- `formatError(error, formatter, options?)`: Format an error using the provided formatter
- `createErrorResponse(error, formatted)`: Create a Response object from a formatted error

### Middleware

- `ban(options?)`: Create error handling middleware with the specified options

### Types

```typescript
interface BanError<T = unknown> {
  status: ErrorStatusCode;
  message: string;
  data?: T;
  headers?: Record<string, string>;
  allow?: readonly string[];
  stack?: string;
  cause?: unknown;
  causeStack?: string;
  readonly isBan: true;
}

interface BanOptions<T = unknown> {
  statusCode?: ErrorStatusCode;
  message?: string;
  data?: T;
  headers?: Record<string, string>;
  allow?: string | string[];
  cause?: Error | unknown;
  formatter?: ErrorFormatter;
  sanitize?: readonly string[];
  includeStackTrace?: boolean;
}

interface BanMiddlewareOptions {
  formatter?: ErrorFormatter;
  sanitize?: readonly string[];
  includeStackTrace?: boolean;
  headers?: Record<string, string>;
}

interface ErrorFormatter<T = unknown> {
  readonly contentType: string;
  format(
    error: BanError,
    headers?: Record<string, string>,
    sanitize?: readonly string[],
    includeStackTrace?: boolean
  ): T;
}
```

## Best Practices

### Error Handling Strategy

1. **Use Specific Error Types**: Use the most specific error factory function that matches your use case.

```typescript
// Good
throw notFound("User not found");

// Less specific
throw createError({ statusCode: 404, message: "User not found" });
```

2. **Include Meaningful Data**: Add context to your errors to help with debugging and user feedback.

```typescript
throw badRequest("Invalid input", {
  data: {
    field: "email",
    reason: "Invalid format",
    expected: "valid@example.com",
  },
});
```

3. **Security Considerations**: Sanitize sensitive data in production environments.

```typescript
app.use(
  ban({
    sanitize: ["password", "token", "secret"],
    includeStackTrace: process.env.NODE_ENV !== "production",
  })
);
```

4. **Developer Errors**: Use `badImplementation` for errors that should never happen in production.

```typescript
if (!database) {
  throw badImplementation("Database connection not initialized");
}
```

### Performance Optimization

1. **Reuse Formatters**: Create formatters once and reuse them rather than creating new ones for each request.

2. **Selective Stack Traces**: Only include stack traces in development to reduce response size in production.

## Contributing

We welcome contributions! Please see the main project's [Contributing Guide](../../CONTRIBUTING.md) for details.

## License

MIT License - see the [LICENSE](LICENSE.md) file for details.
