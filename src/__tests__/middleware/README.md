# Middleware Tests

## Ban Middleware Tests

The tests for the `ban-middleware.ts` file are currently disabled (renamed to `ban-middleware.test.ts.disabled`) due to a known issue with Bun's testing framework. There's a bug related to mocking in Bun that causes errors when testing middleware.

### Error Details

When running the middleware tests, the following error occurs:

```
# Unhandled error between tests
-------------------------------
1 | (function (entry fetcher)
              ^
SyntaxError: export 'ErrorFormatter' not found in '../types'
-------------------------------
```

### Possible Workarounds

For future implementation, consider these workarounds:

- Using [bun-bagel](https://github.com/DRFR0ST/bun-bagel)
- Using [bun-mock-fetch](https://github.com/aryzing/bun-mock-fetch)
- Using `spyOn` for global.fetch:

```typescript
const mockFetch = spyOn(globalThis, "fetch");

beforeEach(() => {
  mockFetch.mockReset();
});

afterAll(() => {
  mockFetch.mockRestore();
});

test("fetches example.com", () => {
  mockFetch.mockImplementation(async (url, opts) => {
    // Test implementation
    return new Response('{"success":true}');
  });

  // Test code
});
```

These tests should be re-enabled when the Bun testing framework is more stable.
