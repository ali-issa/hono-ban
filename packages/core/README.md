# @hono-ban/core 💥

Core package for hono-ban, providing the fundamental error handling functionality for Hono.js applications.

[![npm version](https://badge.fury.io/js/hono-ban.svg)](https://badge.fury.io/js/hono-ban)
[![Bundle Size](https://img.shields.io/bundlephobia/min/hono-ban)](https://bundlephobia.com/result?p=hono-ban)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/hono-ban)](https://bundlephobia.com/result?p=hono-ban)
[![codecov](https://codecov.io/github/ali-issa/hono-ban/graph/badge.svg)](https://codecov.io/github/ali-issa/hono-ban)

## Requirements

- [Hono.js](https://hono.dev) ^4.7.0
- TypeScript ^5.7.3
- [@hono/zod-openapi](https://github.com/honojs/middleware/tree/main/packages/zod-openapi) ^0.9.6 (optional)

## Installation

```bash
npm install @hono-ban/core
```

## Features

- **Type-Safe Error Creation**: Factory methods for all standard HTTP error codes
- **Error Classification**: Built-in methods to identify and handle different types of errors
- **Flexible Error Data**: Support for custom error data and metadata
- **Formatter System**: Extensible error formatting capabilities
- **Error Sanitization**: Built-in security measures for error handling

## Usage

### Basic Error Creation

```typescript
import { Ban } from "@hono-ban/core";

// Create a 404 Not Found error
const error = Ban.notFound("User not found");

// Create a 400 Bad Request error with custom data
const validationError = Ban.badRequest("Invalid input", {
  data: {
    invalidFields: ["email", "password"],
  },
});
```

### Error Handling Middleware

```typescript
import { Hono } from "hono";
import { Ban } from "@hono-ban/core";

const app = new Hono();

app.onError((err, c) => {
  if (Ban.isBan(err)) {
    return err.getResponse();
  }
  const ban = Ban.banify(err, { statusCode: 500 });
  return ban.getResponse();
});
```

### Custom Error Formatting

```typescript
import { Ban, ErrorFormatter } from "@hono-ban/core";

class CustomFormatter implements ErrorFormatter {
  readonly contentType = "application/json";

  format(error: Ban) {
    return {
      code: error.statusCode,
      message: error.message,
      timestamp: new Date().toISOString(),
    };
  }
}

Ban.setDefaultFormatter(new CustomFormatter());
```

## API Reference

### Factory Methods

- `Ban.badRequest(message?: string, options?: BanOptions)`: Creates a 400 Bad Request error
- `Ban.unauthorized(message?: string, options?: BanOptions)`: Creates a 401 Unauthorized error
- `Ban.forbidden(message?: string, options?: BanOptions)`: Creates a 403 Forbidden error
- `Ban.notFound(message?: string, options?: BanOptions)`: Creates a 404 Not Found error
- And more for all standard HTTP error codes

### Utility Methods

- `Ban.isBan(error: unknown): boolean`: Type guard to check if an error is a Ban instance
- `Ban.banify(error: unknown, options?: BanOptions)`: Converts any error to a Ban error
- `Ban.setDefaultFormatter(formatter: ErrorFormatter)`: Sets the default error formatter
- `Ban.getResponse()`: Gets the formatted error response

### Types

```typescript
interface BanOptions {
  statusCode?: number;
  data?: unknown;
  headers?: Record<string, string>;
  formatter?: ErrorFormatter;
}

interface ErrorFormatter {
  readonly contentType: string;
  format(error: Ban, headers?: Record<string, string>): unknown;
}
```

## Contributing

We welcome contributions! Please see the main project's [Contributing Guide](../../CONTRIBUTING.md) for details.

## License

MIT License - see the [LICENSE](LICENSE.md) file for details.
