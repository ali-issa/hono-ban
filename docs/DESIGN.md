# hono-ban 1.0: design

This document describes what hono-ban 1.0 is, the API it exposes, and how it is built.

Architecture decisions referenced as ADR-NNNN live in `docs/adr/`. The normative, field-by-field
specification that implementers work from is `docs/SPEC.md`; this document explains the intent
behind it. When the two disagree, fix one in the same PR.

## 1. Purpose

hono-ban is the error layer for Hono applications. It gives an application:

1. one way to create HTTP errors, with a typed catalog that the application extends;
2. one `onError` handler that turns anything thrown into a well-formed response, safely;
3. one pluggable wire format, so the same application code can emit RFC 9457 Problem Details,
   JSON:API error objects, or a custom shape;
4. validation, OpenAPI, and observability integrations that all derive from the same catalog and
   format, so documentation, responses, and logs cannot disagree.

It is a library for teams who treat their error responses as an API contract.

### Who it is for

- API teams on Hono who want a standard error body without hand-rolling RFC 9457 or JSON:API in
  every project.
- Teams whose clients consume JSON:API and who have had no Hono-native option.
- Teams who need domain errors (`OrderNotFound`, `PlanLimitReached`) translated into HTTP at the
  edge, once, with the same id in the response and in the logs.

### Non-goals

- Replacing your logger or tracer. hono-ban emits one `ErrorReport` per error and stops there.
- Forwarding database or driver text to clients. `hono-ban/postgresql` maps Postgres errors to
  catalog entries with constant messages (ADR-0015); other drivers go through `map` the same way,
  and no driver's `message`, `detail`, or `hint` is ever forwarded (ADR-0007).
- Content negotiation between formats per request. One format per `createBan` instance. If demand
  appears, it is additive.
- Supporting CommonJS-only consumers on Node older than 22.12 (ADR-0006).

## 2. Principles

1. **The handler never throws and runs once per error.** ADR-0002.
2. **Factories return; callers throw.** `throw ban.notFound()` is the idiom. ADR-0005.
3. **One options bag everywhere.** Every factory takes the same `BanErrorOptions`.
4. **A format owns schema and rendering.** ADR-0003. Docs equal wire.
5. **Nothing about the server reaches a client unless a factory put it there.** ADR-0007.
6. **Web standards only. No ambient environment.** ADR-0004.
7. **Typed catalog, no strings at call sites.** Custom errors are keys with inference, not
   `problem({ status, title })` literals repeated across handlers.
8. **One id per error occurrence**, present in the body, the `X-Error-Id` header, and the report.
9. **Small core, optional integrations.** `hono` is the only peer dependency. The Zod, Valibot,
   Standard Schema, OpenAPI, and OpenTelemetry integrations are subpath exports that type the
   third-party objects they receive structurally and never import those packages (ADR-0009).
10. **Every non-obvious decision cites its source** with `@ref` in code and an ADR in docs.

## 3. The API by example

### 3.1 Minimal

```ts
import { Hono } from 'hono';
import { createBan } from 'hono-ban';

const ban = createBan();
const app = new Hono();

app.onError(ban.onError());

app.get('/orders/:id', async (c) => {
  const order = await orders.find(c.req.param('id'));
  if (!order) throw ban.notFound(`Order ${c.req.param('id')} does not exist`);
  return c.json(order);
});
```

Default format is RFC 9457 Problem Details (section 4.4 explains the choice).

### 3.2 Options bag

```ts
throw ban.tooManyRequests({
  detail: 'Rate limit exceeded for this API key',
  headers: { 'Retry-After': '30' },
  meta: { limit: 100, window: '1m' },
  cause: limiterError,
});

throw ban.unauthorized({
  detail: 'Access token expired',
  headers: { 'WWW-Authenticate': 'Bearer realm="api", error="invalid_token"' },
});

// Positional shorthand: detail first, options second.
throw ban.conflict('Email already registered', { meta: { field: 'email' } });
```

### 3.3 Custom catalog entries

```ts
const ban = createBan({
  docsBaseUrl: 'https://api.example.com/errors',
  errors: {
    ORDER_CONFLICT: { status: 409, title: 'Order Conflict' },
    PLAN_LIMIT_REACHED: {
      status: 402,
      title: 'Plan Limit Reached',
      description: 'The workspace has used its monthly quota.',
    },
  },
});

throw ban.ORDER_CONFLICT({ detail: `Order ${id} was modified concurrently` });
throw ban.error('PLAN_LIMIT_REACHED'); // generic form, key is typed
```

Keys are `SCREAMING_SNAKE_CASE` by convention and become both the factory name and the default
`code`. Built-in factories are camelCase (`ban.notFound`), so the two namespaces cannot collide; the
type of `errors` rejects keys that shadow an instance member.

### 3.4 Guarding with narrowing

```ts
import { assert } from 'hono-ban';

const user = await users.find(id);
assert(user, () => ban.notFound(`User ${id} does not exist`));
user.email; // narrowed: User
```

`assert` is a standalone export rather than `ban.assert()`: TypeScript only honors assertion
signatures when every name in the call target has an explicit type annotation (TS2775), which
`const ban = createBan()` does not.

### 3.5 Domain errors from lower layers

```ts
class OrderNotFound extends Error {}
class InsufficientStock extends Error {
  constructor(public readonly sku: string) {
    super(`Out of stock: ${sku}`);
  }
}

const ban = createBan({
  map: (error, ban) => {
    if (error instanceof OrderNotFound) return ban.notFound(error.message, { cause: error });
    if (error instanceof InsufficientStock) {
      return ban.conflict({ detail: error.message, meta: { sku: error.sku }, cause: error });
    }
    return undefined; // fall through to the default handling
  },
});
```

`map` is a single ordered function, not a class registry, so `instanceof` chains, discriminant
checks, and third-party error shapes all work the same way, and subclasses match their parent.
Postgres errors have a ready-made one: `postgresMapper()` from `hono-ban/postgresql` is such a
`map`, keyed on SQLSTATE, with constant client text and per-constraint overrides (section 4.5,
ADR-0015).

### 3.6 Formats

```ts
import { googleApi } from 'hono-ban/formats/google-api';
import { jsonApi } from 'hono-ban/formats/json-api';
import { problemDetails } from 'hono-ban/formats/problem-details';
import { plain } from 'hono-ban/formats/plain';
import { stripe } from 'hono-ban/formats/stripe';

createBan({ format: jsonApi() });
createBan({ format: problemDetails({ typeBaseUrl: 'https://api.example.com/problems' }) });
createBan({ format: googleApi({ domain: 'orders.example.com' }) }); // AIP-193 { error: { code, message, status, details } }
createBan({ format: stripe() }); // { error: { code, doc_url, message, type } }
createBan({ format: plain() }); // { status, code, title, detail, id, meta }
```

A custom format with a schema:

```ts
import { defineFormat } from 'hono-ban';
import { z } from 'zod';

const legacy = defineFormat({
  name: 'legacy-envelope',
  contentType: 'application/json',
  schema: z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }),
  }),
  // render must return the schema's output type; a mismatch is a compile error.
  render: (error, ctx) => ({
    ok: false,
    error: { code: error.code, message: error.detail ?? error.title, requestId: ctx.requestId },
  }),
});

const ban = createBan({ format: legacy });
```

### 3.7 Validation

```ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { defaultHook } from 'hono-ban/zod';

const app = new OpenAPIHono({ defaultHook: defaultHook(ban) });
```

```ts
import { zValidator } from '@hono/zod-validator';
import { hook } from 'hono-ban/zod';

app.post('/users', zValidator('json', UserSchema, hook(ban)), handler);
```

```ts
import { sValidator } from '@hono/standard-validator';
import { hook } from 'hono-ban/standard-schema';

app.post('/users', sValidator('json', UserSchema, hook(ban)), handler);
```

All three normalize issues into `ValidationIssue[]` and **throw**
`ban.validation(issues, { location })`. Throwing rather than returning a `Response` from the hook
sends validation errors through the same `onError` pipeline as everything else, so they get the
error id, the `X-Error-Id` header, the report, and the trace id like any other error (section 4.7).

### 3.8 OpenAPI

```ts
import { createRoute } from '@hono/zod-openapi';
import { errorResponse, errorResponses } from 'hono-ban/openapi';

createRoute({
  method: 'post',
  path: '/orders',
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: OrderSchema } } },
    ...errorResponses(ban, [401, 403, 'ORDER_CONFLICT', 422]),
    429: errorResponse(ban, 429, { description: 'Per-key rate limit' }),
  },
});
```

The schemas come from `ban.format.schema(definition)`; the content type comes from
`ban.format.contentType`. Change the format and the document changes with it.

### 3.9 Observability

```ts
app.onError(
  ban.onError({
    requestId: (c) => c.get('requestId'),
    onReport: async (report, c) => {
      const level = report.status >= 500 ? 'error' : 'warn';
      log[level]({ err: report.cause ?? report.error, ...report.context }, report.error.title);
      if (report.status >= 500)
        Sentry.captureException(report.cause ?? report.error, {
          tags: { errorId: report.id },
        });
    },
  }),
);
```

`report.id` equals the `id` in the response body and the `X-Error-Id` header. A user quoting the id
from an error page finds the log line and the Sentry event.

### 3.10 Environment-dependent behavior

```ts
import { env } from 'hono/adapter';

app.onError((err, c) => ban.onError({ includeStack: env(c).NODE_ENV !== 'production' })(err, c));
```

Or resolve once at startup on platforms with static config. The library never reads the environment
itself (ADR-0004).

### 3.11 Header obligations

HTTP makes the application responsible for a few headers on error responses (SPEC 3.1): a 401 MUST
carry `WWW-Authenticate`, a 405 `Allow`, a 407 `Proxy-Authenticate`. They travel through `headers`;
the one with a grammar worth enforcing has a builder (ADR-0013).

```ts
import { bearerChallenge } from 'hono-ban';

throw ban.unauthorized({
  headers: {
    'WWW-Authenticate': bearerChallenge({
      realm: 'api',
      error: 'invalid_token',
      errorDescription: 'The access token expired',
      resourceMetadata: 'https://api.example.com/.well-known/oauth-protected-resource',
    }),
  },
});
throw ban.methodNotAllowed({ headers: { Allow: 'GET, HEAD' } });
```

@ref https://www.rfc-editor.org/rfc/rfc9110#section-15.5.2 @ref
https://www.rfc-editor.org/rfc/rfc6750#section-3 @ref
https://www.rfc-editor.org/rfc/rfc9728#section-5.1

## 4. Concepts and architecture

### 4.1 Error definitions and the catalog

```ts
interface ErrorDefinition {
  readonly status: ContentfulStatusCode;
  /** Defaults to the RFC 9110 reason phrase for `status`. */
  readonly title?: string;
  /** Machine-readable code. Defaults to the catalog key. */
  readonly code?: string;
  /** URI reference identifying the error type (RFC 9457 section 3.1.1). When omitted, the format derives `${typeBaseUrl ?? docsBaseUrl}/${code}` at render time (ADR-0010). */
  readonly type?: string;
  /** OpenAPI response description. */
  readonly description?: string;
}
```

The built-in catalog covers every registered 4xx and 5xx status except 418 with RFC 9110 names
(`CONTENT_TOO_LARGE` for 413, `UNPROCESSABLE_CONTENT` for 422) and the names they replaced as
factory aliases: `payloadTooLarge` (RFC 7231) and `unprocessableEntity` (RFC 4918, the WebDAV
specification that defined 422 before RFC 9110 adopted it). Titles are the IANA reason phrases. The
catalog is an `as const` object; there are no enums (ADR-0006). @ref
https://www.rfc-editor.org/rfc/rfc9110#name-status-codes @ref
https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml

`createBan({ errors })` merges custom definitions over the built-ins with full type inference. A
custom key that equals a built-in key overrides its definition (for example to change the title of
`NOT_FOUND`).

### 4.2 BanError

`BanError extends HTTPException` (implemented in `src/core/ban-error.ts`). Extending Hono's own
exception means every piece of Hono middleware that already special-cases `HTTPException` keeps
working, and `err.getResponse()` renders in the configured format because the error carries a
reference to its `Ban` instance. @ref https://hono.dev/docs/api/exception

Fields: `status`, `code`, `title`, `detail`, `meta`, `headers`, `id`, `cause`, `definition`,
`instance` (request path when rendered). `message` is `detail ?? title` so ordinary logging of the
error reads well.

### 4.3 Factories

Every catalog entry produces a factory with two call forms:

```ts
type Factory = {
  (detail?: string, options?: BanErrorOptions): BanError;
  (options: BanErrorOptions): BanError;
};
```

Factories are pure: they allocate a `BanError` and return it. No I/O, no side effects, no throw.
`ban.error(key, options)` is the generic form for dynamic keys.
`ban.custom({ status, title, code?, ...options })` builds a one-off error that is not in the
catalog, for prototypes and for statuses an application uses exactly once; it is excluded from
`errorResponses()` because it has no definition to document. `ban.from(unknown)` converts any thrown
value: `BanError` passes through, `HTTPException` maps by status with headers preserved, anything
else becomes the `INTERNAL_SERVER_ERROR` entry with the value as `cause`.

### 4.4 Formats

```ts
interface ErrorFormat<TBody = unknown> {
  readonly name: string;
  readonly contentType: string;
  render(error: BanError, ctx: RenderContext): TBody;
  renderValidation(
    error: BanError,
    issues: ReadonlyArray<ValidationIssue>,
    ctx: RenderContext,
  ): TBody;
  schema(definition: ResolvedDefinition, ctx: SchemaContext): JsonSchema;
  validationSchema(definition: ResolvedDefinition, ctx: SchemaContext): JsonSchema;
}

interface RenderContext {
  readonly requestId: string | undefined;
  readonly traceId: string | undefined;
  readonly instance: string | undefined; // the error's, else the request path
  readonly method: string | undefined;
  readonly includeStack: boolean;
  readonly docsBaseUrl: string | undefined;
  readonly meta: Readonly<Record<string, unknown>>; // already sanitized (ADR-0007)
  readonly stack: string | undefined; // only when includeStack and status >= 500
  readonly truncated: boolean; // second render after the body cap
}
```

All four methods are required on `ErrorFormat`; `defineFormat` (SPEC 7.5) fills in
`renderValidation` and `validationSchema` from `render` and `schema` when a hand-written format
omits them. A format sees only what the context carries: it cannot set response headers, which stay
with the error (`BanError.headers`) and the handler (`HandlerOptions.headers`).

Built-in formats:

| Format             | Content type               | Notes                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `problemDetails()` | `application/problem+json` | RFC 9457 members plus `id`, `code`, and `meta` flattened as extension members; standard members win on collision. See ADR-0008 and SPEC 7.1. `type` is `about:blank` unless a type URI is derived. Validation issues render as an `errors` array of `{ pointer \| parameter \| header, detail, code }`.                                                                               |
| `jsonApi()`        | `application/vnd.api+json` | `{ errors: [ErrorObject] }` with `id`, `status` (string), `code`, `title`, `detail`, `links.type`, `links.about`, `source`, `meta`. Validation issues become one error object each with `source.pointer` (RFC 6901 escaped) or `source.parameter` or `source.header`.                                                                                                                 |
| `googleApi()`      | `application/json`         | AIP-193: `{ error: { code, message, status, details } }` with `code` the HTTP status, `status` the `google.rpc.Code` name (from the catalog code, the `rpcCodes` option, or the HTTP status through the gax table), and `details` holding `ErrorInfo` (always), `BadRequest` (validation), `RetryInfo`, `RequestInfo` (the error id), `DebugInfo`, `Help`. See ADR-0014 and SPEC 7.6. |
| `stripe()`         | `application/json`         | Stripe's `api_errors` shape: `{ error: { code, doc_url, message, param, request_log_url, type } }` in alphabetical order, `type` classified by status like Stripe's SDKs or per code. No member for `meta`, the trace id, or the id. See ADR-0014 and SPEC 7.7.                                                                                                                       |
| `plain()`          | `application/json`         | `{ status, code, title, detail, id, meta, errors? }`. For teams migrating from ad hoc bodies.                                                                                                                                                                                                                                                                                         |

@ref https://www.rfc-editor.org/rfc/rfc9457 @ref https://jsonapi.org/format/#error-objects @ref
https://jsonapi.org/format/#content-negotiation-servers @ref
https://www.rfc-editor.org/rfc/rfc6901#section-3

**Default format.** RFC 9457 is the default because it is the IETF standard, needs no configuration
(`about:blank` is a valid `type`), and is what Hono users ask for in upstream threads. JSON:API is
one import away and is a first-class citizen, not an adapter.

**Schema-driven custom formats.** `defineFormat` accepts either the interface above or a Standard
Schema object with JSON Schema support as `schema`, in which case `render` is typed as returning
`StandardSchemaV1.InferOutput<S>` and the OpenAPI helpers call the schema's JSON Schema projection.
Built-in formats do not depend on any schema library and express their schemas as JSON Schema
literals with a conformance test (ADR-0003). @ref https://standardschema.dev

### 4.5 Handler

`ban.onError(options)` returns a Hono `ErrorHandler`. The pipeline for a thrown value `err`:

1. `BanError` → use as is.
2. `HTTPException` → `ban.from(err)`: catalog entry by status, `detail = err.message`, headers from
   `err.res` preserved. Hono's own validator throws
   `HTTPException(400, 'Malformed JSON in request body')`; it is matched by status and exact
   message, never by substring.
3. `options.map ?? createBan({ map })` → if it returns a `BanError`, use it.
4. Anything else → `INTERNAL_SERVER_ERROR` with the constant detail and `cause = err`.

Then, exactly once: strip dangerous keys from `meta`, add `Cache-Control: no-store` unless a header
was supplied, apply `options.headers` and the error's headers, set `X-Error-Id`, render through the
format, cap the body size, build the report, call `onReport` inside a try/catch, and return the
`Response`. A failure in the format or in `map` is itself caught and rendered as a minimal 500 with
the failure attached to the report as `handlerFailure`.

```ts
interface HandlerOptions {
  includeStack?: boolean; // default false
  requestIdHeader?: string | false; // default 'X-Request-Id'; validated, never fabricated
  requestId?: (c: Context) => string | undefined; // overrides the header lookup
  traceId?: (c: Context) => string | undefined; // default: W3C traceparent
  onReport?: (report: ErrorReport, c: Context) => void | Promise<void>;
  headers?: HeadersInit; // added to every error response
  errorIdHeader?: string | false; // default 'X-Error-Id'
  maxBodyBytes?: number; // default 65536
  transform?: (body: unknown, error: BanError, c: Context) => unknown; // localization etc.
  map?: BanOptions['map']; // overrides the instance-level map
}
```

@ref https://www.w3.org/TR/trace-context/#traceparent-header

The step-by-step algorithm, the fallback path, header merge order, and every edge case are in SPEC
section 6.

`hono-ban/postgresql` supplies a `map` for Postgres driver errors. `postgresMapper(options)`
recognizes the error by its SQLSTATE and severity, directly or through an ORM wrapper's `cause`, and
returns a catalog entry with constant text (409 for conflicts, 422 for rejected values, 503 for
transient conditions) or `undefined` for codes it has no row for, so those stay unhandled 500s.
`constraints`, `columns`, and `codes` refine the entry and wording, or turn a violation into a
validation error with one issue. SPEC section 6.10 has the table and the precedence; ADR-0015 the
reasoning.

### 4.6 Error report

```ts
interface ErrorReport {
  readonly id: string;
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly error: BanError; // what was rendered
  readonly cause: unknown; // what was thrown, when different
  readonly handled: boolean; // false when it fell through to the generic 500
  readonly handlerFailure: unknown; // set only on the fallback path
  readonly context: {
    readonly requestId: string | undefined;
    readonly traceId: string | undefined;
    readonly spanId: string | undefined;
    readonly method: string;
    readonly path: string;
  };
}
```

There is no logger abstraction and no adapter zoo. `onReport` receives everything a logger, tracer,
or error tracker needs, including the raw `Error` instance, so pino's `err` serializer and Sentry's
`captureException` work natively.

### 4.7 Validation

```ts
interface ValidationIssue {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
  readonly code?: string;
  readonly expected?: string;
  readonly received?: string;
}

type IssueLocation = 'body' | 'form' | 'query' | 'param' | 'header' | 'cookie';
```

`ban.validation(issues, { location })` creates a `BanError` for the `VALIDATION_FAILED` entry (422;
`createBan({ validationKey })` selects another entry) with issues attached; the format renders them.
Hooks throw this error so it reaches `onError` and gets an id, header, report, and trace id. The
location is always stated by the caller (the validator hook knows which target it validated), never
inferred from key names. JSON pointers escape `~` and `/` per RFC 6901; symbol path segments are
stringified.

Subpath exports:

- `hono-ban/zod`: `defaultHook(ban)` for `OpenAPIHono`, `hook(ban)` for `zValidator`, and
  `fromZodError(ban, error, location)`. Zod 3.25+ and 4.
- `hono-ban/valibot`: `hook(ban)` for `@hono/valibot-validator` and
  `fromValibotIssues(ban, issues, location)`, keeping Valibot's `type`, `expected`, and `received`
  on each issue.
- `hono-ban/standard-schema`: `hook(ban)` for `@hono/standard-validator` and
  `fromIssues(ban, issues, location)`. Covers ArkType, Effect Schema, and any other Standard Schema
  library through one interface (path and message only, which is all the spec carries). @ref
  https://standardschema.dev

### 4.8 OpenAPI

`hono-ban/openapi` exports `errorResponse(ban, statusOrKey, opts?)`, `errorResponses(ban, list)`,
`errorSchema(ban, statusOrKey)`, `validationResponse(ban)`, and `validationSchema(ban)`. Schemas are
JSON Schema 2020-12 objects, which OpenAPI 3.1 accepts directly; pass `{ dialect: 'openapi-3.0' }`
to get `enum` instead of `const` for 3.0 documents. `@hono/zod-openapi` accepts raw schema objects
in `responses[*].content[*].schema`, so the helpers drop into `createRoute()` without any Zod
wrapping (verified by a generated-document test). @ref
https://spec.openapis.org/oas/v3.1.0#schema-object @ref
https://github.com/asteasolutions/zod-to-openapi/blob/master/src/openapi-registry.ts

A conformance test in the repository renders every catalog entry in every built-in format and
validates the body against `format.schema(entry)`.
`assertFormatConformance(format, catalog, { compile })` is exported from `hono-ban/testing` for
custom formats; `compile` turns a JSON Schema into a validator so the package does not depend on Ajv
(ADR-0009).

### 4.9 Security defaults

See ADR-0007. In short: constant 500 detail, opt-in stack under a dedicated member, prototype
pollution keys stripped from `meta`, request id validated, body size capped, headers only from
`BanError.headers` and `HandlerOptions.headers`. Error responses are `Cache-Control: no-store`
unless the application says otherwise (ADR-0012), because their bodies carry per-occurrence ids and
several error statuses are heuristically cacheable.

### 4.10 Runtime and packaging

- ESM only, `platform: 'neutral'`, `engines.node >= 22.12`, `sideEffects: false` (ADR-0006).
- One peer: `hono >= 4.12.34` (upstream security floor). No optional peers: the integrations are
  typed structurally, so `zod`, `valibot`, `@hono/*` validators, `@standard-schema/spec`, and
  `@opentelemetry/api`, and the Postgres drivers are devDependencies of this repository only
  (ADR-0009).
- No runtime dependencies. Ids come from `crypto.randomUUID()`.
- Subpath exports: `.`, `./formats/json-api`, `./formats/problem-details`, `./formats/plain`,
  `./formats/google-api`, `./formats/stripe`, `./zod`, `./valibot`, `./standard-schema`,
  `./openapi`, `./otel`, `./postgresql`, `./testing`.

## 5. Package layout

The authoritative file map, with the SPEC section each file implements, is SPEC section 1. In
outline:

- `src/core/` `BanError`, catalog data, definitions, factories, `createBan`, `assert`, `from`
- `src/formats/` `ErrorFormat` types, `defineFormat`, extension-member flattening, the five built-in
  formats
- `src/headers/` the `WWW-Authenticate` Bearer challenge builder
- `src/handler/` the `onError` pipeline, request id and traceparent parsing, body cap, report
- `src/validation/` `ValidationIssue`, pointer helpers, the Zod, Valibot, and Standard Schema hooks
- `src/openapi/` response schema helpers
- `src/observability/` the OpenTelemetry trace id adapter
- `src/postgresql/` the Postgres SQLSTATE mapper
- `src/testing/` consumer-facing test helpers and format conformance
- `src/internal/` helpers that are never exported

Every module with behavior has `*.test.ts` beside it; types that are part of the contract have
`*.test-d.ts`. The per-module test list is SPEC section 14.

## 6. Comparison

| Capability           | hono-ban 1.0                                                                   | hono-problem-details                                              | @hapi/boom         |
| -------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------ |
| Formats              | RFC 9457, JSON:API, Google API (AIP-193), Stripe, plain, custom (schema-typed) | RFC 9457                                                          | flat               |
| Catalog              | built-in plus typed custom keys as factories                                   | user registry, `create(key)`                                      | built-in factories |
| Options per error    | detail, code, title, meta, headers, cause, id                                  | detail, instance, type, extensions                                | data, headers      |
| Domain error mapping | `map(error, ban)`                                                              | `mapError`                                                        | `boomify`          |
| Validation           | Zod, Valibot, Standard Schema; format renders; flows through `onError`         | Zod, Valibot, Standard Schema; hook returns the response directly | none               |
| OpenAPI              | derived from format schema; zod-openapi and JSON Schema                        | zod-openapi and JSON Schema                                       | none               |
| Observability        | `ErrorReport` with shared id, request id, trace id                             | `traceId` extension via OTel                                      | none               |
| Handler safety       | never throws, once per error, constant 500 detail                              | never throws, constant 500 detail                                 | n/a                |
| Runtime              | web standards only                                                             | web standards only                                                | Node               |

hono-ban 1.0 does not depend on or wrap hono-problem-details.

## 7. Roadmap

Everything described in this document has shipped and is covered by the unit, end-to-end, and
runtime smoke suites (SPEC section 14). Nothing is scheduled; additive proposals start as a
discussion (`CONTRIBUTING.md`).
