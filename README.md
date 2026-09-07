# hono-ban

Structured, extensible HTTP errors for [Hono](https://hono.dev). One API for creating errors, one
`onError` handler, and pluggable wire formats: RFC 9457 Problem Details, JSON:API, Google's AIP-193,
and Stripe's error object are built in, and your own shape is a `defineFormat` call away.

## Install

```bash
pnpm add hono-ban hono
```

Node 22.12+, Bun, Deno, and Cloudflare Workers are supported. CI runs the unit and end-to-end suites
on Node 22 and 24 and a smoke test of every subpath on Bun, Deno, and workerd.

## Quick start

```ts
import { Hono } from 'hono';
import { createBan } from 'hono-ban';

const ban = createBan();

const app = new Hono();
app.onError(ban.onError());

app.get('/orders/:id', async (c) => {
  const order = await orders.find(c.req.param('id'));
  if (!order) {
    throw ban.notFound(`Order ${c.req.param('id')} does not exist`);
  }
  return c.json(order);
});
```

```http
HTTP/1.1 404 Not Found
Content-Type: application/problem+json
X-Error-Id: 6f1c2f0e-...

{
  "type": "about:blank",
  "status": 404,
  "title": "Not Found",
  "detail": "Order 42 does not exist",
  "instance": "/orders/42",
  "id": "6f1c2f0e-..."
}
```

### Guard and narrow

```ts
import { assert } from 'hono-ban';

const order = await orders.find(id);
assert(order, () => ban.notFound(`Order ${id} does not exist`));
order.total; // narrowed: Order
```

Factories return errors and never throw them, so a bare `ban.notFound()` statement is a no-op. The
`no-unused-expressions` rule (ESLint core, typescript-eslint, oxlint) flags the missing `throw`.

### Unmatched routes

Hono answers a request no route matches from its own `notFound` handler with a plain-text 404, not
through `onError`. Throwing from `app.notFound` routes it through the handler, so unmatched routes
carry the same body, `X-Error-Id`, and report as every other error:

```ts
app.notFound(() => {
  throw ban.notFound();
});
```

### Your own errors

```ts
const ban = createBan({
  docsBaseUrl: 'https://api.example.com/errors',
  errors: {
    ORDER_CONFLICT: { status: 409, title: 'Order Conflict' },
    PLAN_LIMIT_REACHED: { status: 402, title: 'Plan Limit Reached' },
  },
});

throw ban.ORDER_CONFLICT({
  detail: `Order ${id} was modified by another request`,
  meta: { orderId: id },
});
```

### Database errors

`hono-ban/postgresql` maps a Postgres driver error to a catalog entry by SQLSTATE with constant
client-facing text. It recognizes the errors of node-postgres, postgres.js, PGlite, Neon, and Bun,
thrown directly or wrapped by Drizzle, Kysely, TypeORM, MikroORM, Slonik, or Sequelize:

```ts
import { postgresMapper } from 'hono-ban/postgresql';

const ban = createBan({
  map: postgresMapper({
    constraints: {
      users_email_key: { issue: { path: ['email'], message: 'That email is already registered' } },
      orders_customer_id_fkey: 'The customer does not exist',
    },
    columns: { 'users.email': { issue: { path: ['email'], message: 'Email is required' } } },
    codes: { '42501': { key: 'FORBIDDEN' } },
    retryAfter: 1,
  }),
});
```

A unique violation is a 409, a not-null or check violation a 422, a serialization failure or a
deadlock a 503 with `Retry-After`. `constraints` and `columns` refine the wording per constraint
name or `table.column`, or turn the violation into a validation error with one issue at a path, the
shape a form already handles; `codes` overrides the entry per SQLSTATE or class. Nothing from the
driver's message, detail, or hint reaches a body: the driver error stays on the report as
`report.error.cause`, and `findPostgresError(report.cause)` reads it out of any wrapper. Codes with
no row, such as a syntax error, a missing table, or a `RAISE EXCEPTION`, fall through to the
constant 500 with `handled: false`. The full table and the precedence rules are in SPEC section
6.10.

To put an application-authored `RAISE` message on the wire, compose your own `map`:

```ts
import { findPostgresError, postgresMapper } from 'hono-ban/postgresql';

const postgres = postgresMapper();
const ban = createBan({
  map: (thrown, ban) => {
    const error = findPostgresError(thrown);
    if (error?.code === 'P0001' && error instanceof Error) {
      return ban.badRequest(error.message, { cause: thrown });
    }
    return postgres(thrown, ban);
  },
});
```

### Headers some statuses require

HTTP makes the application, not the library, responsible for a few headers: a 401 MUST carry
`WWW-Authenticate`, a 405 MUST carry `Allow`, a 407 MUST carry `Proxy-Authenticate`, and a 429 or
503 may suggest `Retry-After`. Pass them through `headers`; `ban.from()` keeps them when a
middleware such as `hono/bearer-auth` already set them. `bearerChallenge()` builds the RFC 6750
value, validates every attribute against its grammar, and knows RFC 9728 `resource_metadata` for
OAuth-protected resources.

```ts
import { bearerChallenge } from 'hono-ban';

throw ban.methodNotAllowed({ headers: { Allow: 'GET, HEAD' } });
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
throw ban.tooManyRequests({ headers: { 'Retry-After': '30' } });
```

The full table with RFC references is in `docs/SPEC.md` section 3.1.

### Pick a format

```ts
import { jsonApi } from 'hono-ban/formats/json-api';

const ban = createBan({ format: jsonApi() });
```

```http
HTTP/1.1 409 Conflict
Content-Type: application/vnd.api+json

{
  "errors": [
    {
      "id": "6f1c2f0e-...",
      "status": "409",
      "code": "ORDER_CONFLICT",
      "title": "Order Conflict",
      "detail": "Order 42 was modified by another request",
      "links": { "type": "https://api.example.com/errors/ORDER_CONFLICT" },
      "meta": { "orderId": "42" }
    }
  ]
}
```

`googleApi()` renders the AIP-193 shape Google's APIs use. It needs the `ErrorInfo.domain` AIP-193
requires; `status` comes from the catalog code when it names a `google.rpc.Code`, else from the HTTP
status, and `rpcCodes` overrides it per code. `meta` becomes `ErrorInfo.metadata`, whose keys must
match `[a-z][a-zA-Z0-9-_]+` and stay under 64 characters (`error_details.proto`); a key outside that
grammar (`order.id`, `UserId`) is dropped rather than sent.

```ts
import { googleApi } from 'hono-ban/formats/google-api';

const ban = createBan({
  format: googleApi({ domain: 'orders.example.com' }),
  docsBaseUrl: 'https://api.example.com/errors',
});
```

```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "error": {
    "code": 404,
    "message": "Order 42 does not exist",
    "status": "NOT_FOUND",
    "details": [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        "reason": "NOT_FOUND",
        "domain": "orders.example.com"
      },
      { "@type": "type.googleapis.com/google.rpc.RequestInfo", "requestId": "6f1c2f0e-..." },
      {
        "@type": "type.googleapis.com/google.rpc.Help",
        "links": [
          {
            "description": "Documentation for NOT_FOUND errors",
            "url": "https://api.example.com/errors/NOT_FOUND"
          }
        ]
      }
    ]
  }
}
```

`stripe()` renders Stripe's error object, the most copied envelope in commercial APIs. The shape has
no member for `meta`, the trace id, or the error id, which stays in the `X-Error-Id` header; a
validation error carries its first issue as `param`.

```ts
import { stripe } from 'hono-ban/formats/stripe';

const ban = createBan({ format: stripe(), docsBaseUrl: 'https://api.example.com/errors' });
```

```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "error": {
    "code": "not_found",
    "doc_url": "https://api.example.com/errors/NOT_FOUND",
    "message": "Order 42 does not exist",
    "type": "invalid_request_error"
  }
}
```

### Define your own format

`defineFormat` takes a renderer and the JSON Schema that describes it. This one answers OAuth 2.0
token endpoint errors (RFC 6749 section 5.2): the catalog `code` is the OAuth error code, `detail`
becomes `error_description`, and `type` becomes `error_uri`. The end-to-end suite serves this exact
definition and checks it against its own schema.

```ts
import { createBan, defineFormat } from 'hono-ban';

const oauth = defineFormat({
  name: 'oauth',
  contentType: 'application/json',
  render: (error) => ({
    error: error.code,
    ...(error.detail === undefined ? {} : { error_description: error.detail }),
    ...(error.type === undefined ? {} : { error_uri: error.type }),
  }),
  schema: (definition, ctx) => ({
    type: 'object',
    required: ['error'],
    properties: {
      error:
        ctx.dialect === 'openapi-3.0' ? { enum: [definition.code] } : { const: definition.code },
      error_description: { type: 'string' },
      error_uri: { type: 'string', format: 'uri-reference' },
    },
    additionalProperties: false,
  }),
});

const token = createBan({
  format: oauth,
  validationKey: 'INVALID_REQUEST',
  errors: {
    INVALID_REQUEST: { status: 400, code: 'invalid_request', title: 'Invalid Request' },
    INVALID_CLIENT: { status: 401, code: 'invalid_client', title: 'Invalid Client' },
    INVALID_GRANT: { status: 400, code: 'invalid_grant', title: 'Invalid Grant' },
  },
});

throw token.INVALID_GRANT('The refresh token has expired');
// 400 {"error":"invalid_grant","error_description":"The refresh token has expired"}
```

### Validation and OpenAPI

```ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { errorResponses, validationResponse } from 'hono-ban/openapi';
import { defaultHook } from 'hono-ban/zod';

const app = new OpenAPIHono({ defaultHook: defaultHook(ban) });

const route = createRoute({
  method: 'get',
  path: '/orders/{id}',
  responses: {
    200: { description: 'Order', content: { 'application/json': { schema: OrderSchema } } },
    ...errorResponses(ban, [401, 404]),
    // The hook throws ban.validation(), which is VALIDATION_FAILED with an
    // `errors` array; a bare 422 would document UNPROCESSABLE_CONTENT instead.
    422: validationResponse(ban),
  },
});
```

Hooks for `@hono/zod-validator` (`hook` from `hono-ban/zod`), `@hono/valibot-validator`
(`hono-ban/valibot`), and `@hono/standard-validator` (`hono-ban/standard-schema`) work the same way:
they throw into `onError`, so validation failures get the same id, header, and report as every other
error, rendered by the active format.

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "about:blank",
  "status": 422,
  "title": "Validation Failed",
  "detail": "Request validation failed",
  "instance": "/orders",
  "code": "VALIDATION_FAILED",
  "id": "6f1c2f0e-...",
  "location": "body",
  "errors": [{ "location": "body", "pointer": "/email", "detail": "Invalid email address", "code": "invalid_format" }]
}
```

### Observe

```ts
import { trace } from '@opentelemetry/api';
import { traceIdFromOtel } from 'hono-ban/otel';

app.onError(
  ban.onError({
    traceId: traceIdFromOtel(trace), // default: W3C traceparent header
    onReport: (report) => {
      logger.error({ err: report.cause, ...report.context }, report.error.title);
    },
  }),
);
```

Every response carries `X-Error-Id`; the same id is in the report and, for every built-in format
except Stripe (whose shape has no member for it), in the body.

### Localize or redact

`transform` post-processes the rendered body. RFC 9457 lets `title` vary between occurrences only
for localization, and the catalog fixes it otherwise, so this is where a translation happens; set
`Content-Language` yourself through `headers`.

```ts
app.onError(
  ban.onError({
    transform: (body, error, c) =>
      typeof body === 'object' && body !== null
        ? { ...body, title: t(c.req.header('accept-language'), error.code) }
        : body,
  }),
);
```

## Modules

| Import                                                                                                                                              | What it gives you                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `hono-ban`                                                                                                                                          | `createBan`, `assert`, `defineFormat`, `bearerChallenge`, `BanError`, `isBanError`, `problemDetails` |
| `hono-ban/formats/problem-details`, `hono-ban/formats/json-api`, `hono-ban/formats/plain`, `hono-ban/formats/google-api`, `hono-ban/formats/stripe` | the built-in wire formats                                                                            |
| `hono-ban/zod`, `hono-ban/valibot`, `hono-ban/standard-schema`                                                                                      | validator hooks and issue converters                                                                 |
| `hono-ban/openapi`                                                                                                                                  | `errorResponses`, `errorResponse`, `errorSchema`, `validationResponse`, `validationSchema`           |
| `hono-ban/otel`                                                                                                                                     | `traceIdFromOtel`                                                                                    |
| `hono-ban/postgresql`                                                                                                                               | `postgresMapper`, `findPostgresError`, `readPostgresFields`                                          |
| `hono-ban/testing`                                                                                                                                  | `expectBanError`, `renderError`, `assertFormatConformance`                                           |

Other databases go through `createBan({ map })` the same way `hono-ban/postgresql` does: catalog
entries with constant client-facing messages, never the driver's own text (a driver's detail line
can contain the failing row).

## Documentation

- [`docs/DESIGN.md`](./docs/DESIGN.md): goals, the full API, architecture, security defaults, and
  roadmap
- [`docs/SPEC.md`](./docs/SPEC.md): the normative implementation specification (exact types,
  catalog, rendering rules, handler algorithm, validator mappings, packaging, test plan)
- [`docs/adr/`](./docs/adr/): architecture decision records
- [`CONTRIBUTING.md`](./CONTRIBUTING.md): setup, quality gates, release process

## Why

Without a contract, error bodies drift: `{ message }` here, `{ error }` there, a Zod issue array
somewhere else, and an OpenAPI document that describes none of them. hono-ban gives every error in a
Hono app one shape, one id, and one place to observe it, while letting you choose which standard
that shape follows.

- **Typed catalog.** Every standard 4xx and 5xx status has a factory (`ban.notFound()`), and your
  own domain errors join the catalog with full inference (`ban.ORDER_CONFLICT()`).
- **Formats are pluggable.** `problemDetails()` (RFC 9457), `jsonApi()`, `googleApi()` (AIP-193),
  `stripe()`, `plain()`, or `defineFormat()` with a schema and a renderer. The schema drives
  OpenAPI; the renderer drives the wire. They cannot disagree.
- **A handler that cannot misbehave.** `ban.onError()` never throws, runs once per error, preserves
  headers from Hono's `HTTPException`, marks error responses `Cache-Control: no-store` unless you
  set one, and never puts server internals in a response.
- **Validation done once.** Hooks for `@hono/zod-openapi`, `@hono/zod-validator`, and any Standard
  Schema validator normalize issues, then the active format renders them (JSON:API `source.pointer`,
  Problem Details `errors`).
- **Observability built in.** One `ErrorReport` per error with the same id the client received, the
  request id, and the trace id. Plug in pino, Sentry, or OpenTelemetry in a few lines.
- **Runs everywhere Hono runs.** Web standards only; no `process.env`, no Node-only APIs. ESM, and
  `hono` is the only peer dependency: the Zod, Valibot, Standard Schema, and OpenTelemetry modules
  are typed structurally and never import those packages.

## Comparison

|                                         | hono-ban 1.0                                                    | hono-problem-details          | @hapi/boom |
| --------------------------------------- | --------------------------------------------------------------- | ----------------------------- | ---------- |
| Wire formats                            | RFC 9457, JSON:API, Google API (AIP-193), Stripe, plain, custom | RFC 9457                      | flat JSON  |
| Typed error catalog with custom entries | yes                                                             | registry                      | no         |
| Validation hooks                        | Zod, Valibot, Standard Schema                                   | Zod, Valibot, Standard Schema | no         |
| OpenAPI response helpers                | yes, derived from the format schema                             | yes                           | no         |
| Error report hook with shared error id  | yes                                                             | no                            | no         |
| Hono `HTTPException` interop            | extends it                                                      | maps it                       | n/a        |
| Runtime                                 | web standards only                                              | web standards only            | Node       |

## License

[MIT](./LICENSE)
