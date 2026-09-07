# ADR 0005: Factories return errors; callers throw

- Status: accepted (amended 2026-09-07: `assert` is a standalone export, not `ban.assert`)
- Date: 2026-09-07

## Context

Helpers typed `never` that throw internally invite `if (!user) { ban.notFound() }` without `throw`.
TypeScript does not narrow control flow across a call to a mapped-type member that returns `never`,
so `user` stays possibly undefined and real code needs `throw` anyway. Throwing factories also
cannot be used to build an error without raising it (inside the handler, in tests, when attaching it
as a cause).

## Decision

Every factory returns a `BanError`. The documented idiom is `throw ban.notFound(...)`. An `assert`
helper covers the guard case with narrowing: `assert(user, () => ban.notFound())` has an
`asserts value` signature.

Amendment: `assert` was first specified as `ban.assert()`. TypeScript applies assertion signatures
only when every name in the call target has an explicit type annotation (TS2775), and
`const ban = createBan()` has none, so the method form never narrowed. `assert` is a standalone
export from `hono-ban` instead (SPEC 5.4).

## Consequences

Call sites are one keyword longer and read as ordinary JavaScript. The handler, the tests, and
`ban.from()` can construct errors without try/catch. Forgetting `throw` is caught by the
`typescript/no-unused-expressions` lint rule in consumer projects that enable it, and by the
`@typescript-eslint` equivalent; we call this out in the README.
