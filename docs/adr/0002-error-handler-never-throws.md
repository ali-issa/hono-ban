# ADR 0002: The error handler never throws and runs once per error

- Status: accepted
- Date: 2026-09-07

## Context

Hono invokes `app.onError` from two places. On the composed middleware path, a throw inside the
handler is caught by `compose` and the handler is invoked again with the new error. On the
single-handler fast path (a route with no middleware) there is no second catch, so a throw rejects
`app.fetch` and the client gets no response. A handler that translates domain errors by throwing
from inside itself works only by accident of the first path, and there it produces two handler
passes, two log lines, and two error-tracker events per error. @ref
https://github.com/honojs/hono/blob/main/src/compose.ts @ref
https://github.com/honojs/hono/blob/main/src/hono-base.ts

## Decision

`ban.onError()` returns a function that always returns a `Response`. Every branch builds a
`BanError` and renders it; no branch throws or calls a throwing factory. The handler's own failures
(a broken custom format, a throwing `onReport` hook) are caught and produce a minimal `500` in the
active format, with the failure attached to the report. The test suite runs the handler against a
single-handler app and a middleware app and asserts one invocation and one report per error.

## Consequences

Factories that throw cannot be reused inside the handler; the handler uses the same `BanError`
constructor path with the `throw` left to callers (ADR 0005). Custom `map` callbacks must return a
`BanError`, not throw one; the handler treats a throw from `map` as a handler failure.
