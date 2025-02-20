# @hono-ban/formatters 💥

Official formatters package for hono-ban, providing implementations of common error specification formats.

[![npm version](https://badge.fury.io/js/@hono-ban/formatters.svg)](https://badge.fury.io/js/@hono-ban/formatters)
[![Bundle Size](https://img.shields.io/bundlephobia/min/@hono-ban/formatters)](https://bundlephobia.com/result?p=@hono-ban/formatters)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@hono-ban/formatters)](https://bundlephobia.com/result?p=@hono-ban/formatters)

## Installation

```bash
npm install @hono-ban/formatters
```

## Available Formatters

### RFC 7807 (Problem Details)

Implementation of [RFC 7807: Problem Details for HTTP APIs](https://datatracker.ietf.org/doc/html/rfc7807).

```typescript
import { Ban } from "hono-ban";
import { RFC7807Formatter } from "@hono-ban/formatters";

// Configure the formatter
const formatter = new RFC7807Formatter({
  baseUrl: "https://api.example.com/problems",
});

// Set as default formatter
Ban.setDefaultFormatter(formatter);

// Create an error with RFC 7807 data
const error = Ban.badRequest("Invalid input", {
  data: RFC7807Formatter.createValidationError([
    { name: "email", reason: "Must be a valid email" },
  ]),
});

// Response will be formatted according to RFC 7807
const response = error.getResponse();
```

#### Output Format

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

### Helper Methods

The RFC7807Formatter provides helper methods for creating standardized error data:

```typescript
// Create validation error data
const data = RFC7807Formatter.createValidationError([
  { name: "email", reason: "Invalid format" },
]);

// Create problem details with custom fields
const data = RFC7807Formatter.createProblemDetails({
  type: "https://example.com/errors/insufficient-funds",
  title: "Insufficient Funds",
  status: 400,
  detail: "Your account balance is too low",
  balance: 30.0,
  required: 100.0,
});
```

## Best Practices

1. **Use Type-Safe Helper Methods**: Prefer using the provided helper methods over creating raw data objects to ensure type safety and proper formatting.

2. **Consistent Base URLs**: When using RFC 7807, maintain consistent base URLs across your API for problem types.

3. **Meaningful Error Types**: Choose descriptive and specific error types that clearly indicate the nature of the problem.

4. **Include Relevant Details**: Add contextual information that helps clients understand and resolve the error.

5. **Security Considerations**: Be cautious about including sensitive information in error responses.

## Creating Custom Formatters

To create a custom formatter, implement the `ErrorFormatter` interface from `hono-ban`:

```typescript
import { Ban, ErrorFormatter } from "hono-ban";

class CustomFormatter implements ErrorFormatter {
  readonly contentType = "application/vnd.error+json";

  format(error: Ban, headers: Record<string, string>) {
    return {
      code: error.statusCode,
      message: error.message,
      details: error.data,
      timestamp: new Date().toISOString(),
    };
  }
}
```

## Contributing

We welcome contributions! Please see the main project's [Contributing Guide](../../CONTRIBUTING.md) for details.

## License

MIT License - see the [LICENSE](LICENSE.md) file for details.
