# hono-ban 💥

"バン" (ban) refers to a sudden loud sound, akin to a gunshot or a sharp noise in Japanese.

A robust, type-safe HTTP error handling solution for [Hono.js](https://hono.dev) that makes it easy to implement any error specification through its flexible formatter system.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/ali-issa/hono-ban/blob/main/LICENSE)

## Features

- **Specification Agnostic**: Implement any error specification through the formatter system
- **Growing Schema Library**: Community-driven collection of error specifications
- **Type-Safe**: Full TypeScript support with comprehensive type definitions
- **RFC 7807 Compliant**: Built-in support for [Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc7807)
- **Customizable**: Extensible error formatting with custom formatters
- **Performant**: Zero dependencies (except Hono)
- **Secure**: Built-in error sanitization
- **Comprehensive**: Support for all standard HTTP error codes
- **Well-Tested**: Extensive test coverage

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Error Specifications](#error-specifications)
- [Error Formatting](#error-formatting)
- [Real-World Examples](#real-world-examples)
- [Custom Formatters](#custom-formatters)
- [Best Practices](#best-practices)
- [API Reference](#api-reference)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

## Installation

```bash
# npm
npm install hono-ban

# yarn
yarn add hono-ban

# pnpm
pnpm add hono-ban

# bun
bun add hono-ban
```

## Quick Start

```typescript
import { Hono } from "hono";
import { Ban } from "hono-ban";

const app = new Hono();

app.get("/users/:id", async (c) => {
  const user = await db.users.findById(c.req.param("id"));

  if (!user) {
    // Create a 404 error with custom message
    throw Ban.notFound("User not found");
  }

  return c.json(user);
});

// Error handling middleware
app.onError((err, c) => {
  if (Ban.isBan(err)) {
    // Ban errors are automatically formatted
    return err.getResponse();
  }
  // Convert other errors to Ban errors
  const ban = Ban.banify(err, { statusCode: 500 });
  return ban.getResponse();
});
```

## Error Specifications

hono-ban is designed to be specification-agnostic, allowing you to implement any error specification your API needs. The library separates error data from error presentation through its formatter system:

- **Error Data**: The actual error information you want to convey (status, message, validation details, etc.)
- **Error Formatting**: How that data is presented in the response (RFC 7807, JSON:API, etc.)

### How Formatters Work

When you set a default formatter, it determines how ALL error responses are formatted without needing to specify the formatter for each error:

```typescript
// Set RFC 7807 as the default format for all errors
Ban.setDefaultFormatter(
  new RFC7807Formatter({
    baseUrl: "https://api.example.com/problems",
  })
);

// These errors will automatically use RFC 7807 format
const error1 = Ban.notFound("User not found");
const error2 = Ban.badRequest("Invalid input");
```

The error data itself is provided separately from the formatting:

```typescript
// The data structure represents the error information
const validationError = Ban.badRequest("Invalid input", {
  data: {
    invalidParams: [
      { field: "email", reason: "Must be a valid email" },
      { field: "age", reason: "Must be at least 18" },
    ],
  },
});

// The formatter (RFC 7807 in this case) will automatically format this data
// into the proper RFC 7807 structure in the response
```

Many specifications provide helper methods to create standardized data structures:

```typescript
// Helper to create RFC 7807 validation error data
const error = Ban.badRequest("Invalid input", {
  data: RFC7807Formatter.createValidationError([
    { name: "email", reason: "Must be a valid email" },
  ]),
});

// Helper to create JSON:API error data
const error = Ban.notFound("Resource not found", {
  data: JsonApiFormatter.createError({
    id: "123",
    code: "RESOURCE_NOT_FOUND",
  }),
});
```

### Available Specifications

The community is building a growing library of error specifications. Current implementations include:

1. **RFC 7807 (Problem Details)** - Built-in

```typescript
import { RFC7807Formatter } from "hono-ban";

// Set as default formatter - affects all errors
Ban.setDefaultFormatter(
  new RFC7807Formatter({
    baseUrl: "https://api.example.com/problems",
  })
);

// Create errors with specification-specific data
const error = Ban.badRequest("Invalid input", {
  data: RFC7807Formatter.createValidationError([
    { name: "email", reason: "Must be a valid email" },
  ]),
});
```

2. **JSON:API** - Community implementation

```typescript
import { JsonApiFormatter } from "@hono-ban/jsonapi";

// Set as default formatter
Ban.setDefaultFormatter(new JsonApiFormatter());

// Create errors with JSON:API data structure
const error = Ban.notFound("Resource not found", {
  data: {
    id: "123",
    code: "RESOURCE_NOT_FOUND",
    meta: { timestamp: new Date() },
  },
});
```

3. **OpenAPI** - Community implementation

```typescript
import { OpenAPIFormatter } from "@hono-ban/openapi";

// Set as default formatter
Ban.setDefaultFormatter(new OpenAPIFormatter());

// Create errors with OpenAPI data structure
const error = Ban.badRequest("Validation failed", {
  data: {
    schema: { type: "object" },
    errors: [{ path: "/email", message: "Invalid format" }],
  },
});
```

### Implementing Your Own Specification

The formatter system makes it easy to implement any error specification:

```typescript
class CustomSpecFormatter implements ErrorFormatter {
  readonly contentType = "application/vnd.error+json";

  format(error: Ban, headers: Record<string, string>) {
    // Implement your specification's error format
    return {
      // Your custom error structure
    };
  }
}
```

### Contributing Specifications

We encourage the community to contribute new specification implementations. To add a new specification:

1. Create a new package named `@hono-ban/<spec-name>`
2. Implement the `ErrorFormatter` interface
3. Add comprehensive tests and documentation
4. Submit a PR to the [specifications repository](https://github.com/ali-issa/hono-ban-specs)

## Error Formatting

### Default Format

```typescript
const error = Ban.badRequest('Invalid email format')

// Output:
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Invalid email format"
}
```

### RFC 7807 Format

```typescript
import { RFC7807Formatter } from 'hono-ban'

// Set as default formatter
Ban.setDefaultFormatter(new RFC7807Formatter({
  baseUrl: 'https://api.example.com/problems'
}))

const error = Ban.badRequest('Invalid email format', {
  data: RFC7807Formatter.createValidationError([{
    name: 'email',
    reason: 'Must be a valid email address'
  }])
})

// Output:
{
  "type": "https://api.example.com/problems/400",
  "title": "Bad Request",
  "status": 400,
  "detail": "Invalid email format",
  "instance": "urn:uuid:...",
  "timestamp": "2024-02-19T20:37:23.000Z",
  "invalid-params": [{
    "name": "email",
    "reason": "Must be a valid email address"
  }]
}
```

## Contributing

We welcome contributions, especially:

1. New error specification implementations
2. Improvements to existing specifications
3. Documentation and examples
4. Bug fixes and feature enhancements

Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Inspired by [Boom](https://github.com/hapijs/boom)
- Built for [Hono.js](https://hono.dev)
