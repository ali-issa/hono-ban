# hono-ban 1.0: implementation specification

- Status: normative for the 1.0 line; `docs/DESIGN.md` explains the why

The key words MUST, MUST NOT, SHOULD, and MAY are used as in RFC 2119. Every section names the
source file that implements it and the tests that prove it. When this document and the code
disagree, fix one of them in the same pull request.

Contents

1. Public surface and module map
2. Core types
3. Built-in catalog
4. `BanError`
5. Factories, `error`, `custom`, `assert`, `from`
6. The `onError` handler
7. Formats
8. Validation
9. OpenAPI
10. Observability
11. Testing utilities
12. Packaging
13. Constants
14. Test plan

---

## 1. Public surface and module map

`hono` is the only peer dependency. Every integration module types the third-party objects it
receives structurally (ADR 0009), so installing `hono-ban` never pulls in or requires Zod, Valibot,
`@standard-schema/spec`, `@hono/*` validators, `@opentelemetry/api`, or Ajv.

| Subpath                            | Exports                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hono-ban`                         | `createBan`, `assert`, `defineFormat`, `problemDetails`, `bearerChallenge`, `BanError`, `isBanError`, `BUILTIN_CATALOG`, `FACTORY_NAMES`, `parseTraceparent`, `pointerFromPath`, `nameFromPath`, `locationFromTarget`, and every type in sections 2, 3.2, 4, 7, 8                                                             |
| `hono-ban/formats/problem-details` | `problemDetails(options?)`, `PROBLEM_DETAILS_CONTENT_TYPE`, `ProblemDetailsOptions`, `ProblemDetailsBody`                                                                                                                                                                                                                     |
| `hono-ban/formats/json-api`        | `jsonApi(options?)`, `JSON_API_CONTENT_TYPE`, `JsonApiOptions`, `JsonApiBody`, `JsonApiErrorObject`, `JsonApiLinks`, `JsonApiSource`                                                                                                                                                                                          |
| `hono-ban/formats/google-api`      | `googleApi(options)`, `GOOGLE_API_CONTENT_TYPE`, `GoogleApiOptions`, `GoogleApiBody`, `GoogleApiStatus`, `GoogleApiDetail`, `GoogleApiErrorInfo`, `GoogleApiBadRequest`, `GoogleApiFieldViolation`, `GoogleApiRetryInfo`, `GoogleApiRequestInfo`, `GoogleApiDebugInfo`, `GoogleApiHelp`, `GoogleApiHelpLink`, `GoogleRpcCode` |
| `hono-ban/formats/stripe`          | `stripe(options?)`, `STRIPE_CONTENT_TYPE`, `StripeOptions`, `StripeBody`, `StripeErrorObject`, `StripeErrorType`                                                                                                                                                                                                              |
| `hono-ban/formats/plain`           | `plain()`, `PLAIN_CONTENT_TYPE`, `PlainBody`                                                                                                                                                                                                                                                                                  |
| `hono-ban/zod`                     | `hook(ban)`, `defaultHook(ban)`, `fromZodError(ban, error, location, options?)`, `toIssues(error)`, `ZodIssueLike`, `ZodErrorLike`, `ZodHookResult`                                                                                                                                                                           |
| `hono-ban/valibot`                 | `hook(ban)`, `fromValibotIssues(ban, issues, location, options?)`, `toIssues(issues)`, `ValibotIssueLike`, `ValibotPathItemLike`, `ValibotHookResult`                                                                                                                                                                         |
| `hono-ban/standard-schema`         | `hook(ban)`, `fromIssues(ban, issues, location, options?)`, `toIssues(issues)`, `StandardHookResult`                                                                                                                                                                                                                          |
| `hono-ban/openapi`                 | `errorSchema`, `errorResponse`, `errorResponses`, `validationSchema`, `validationResponse`, `SchemaSource`, `OpenApiOptions`, `ResponseObject`, `MediaTypeObject`, `ErrorRef`                                                                                                                                                 |
| `hono-ban/otel`                    | `traceIdFromOtel(source)`, `OtelSource`, `OtelTraceLike`, `OtelSpanLike`, `OtelSpanContextLike`                                                                                                                                                                                                                               |
| `hono-ban/testing`                 | `renderError`, `expectBanError`, `assertFormatConformance`, `ExpectedError`, `ConformanceOptions`, `SchemaValidator`                                                                                                                                                                                                          |

Source layout. Every module with behavior has a sibling `*.test.ts`; contract types have
`*.test-d.ts` (the validator hooks share `validation/hooks.test-d.ts`). Type-only and data-only
modules (`types.ts`, `context.ts`, `internal.ts`, `report.ts`, `resolve.ts`, `hook.ts`,
`schema-helpers.ts`) are covered through their consumers; coverage thresholds apply to all of
`src/`. Imports form a DAG (`import/no-cycle` is enforced, type-only imports included).

```
src/
  index.ts                     root entry
  internal/
    constants.ts               section 13
    id.ts                      generateErrorId(): crypto.randomUUID()
    json.ts                    safeStringify(), isPlainRecord()
    sanitize-meta.ts           sanitizeMeta() (ADR 0007)
    standard-schema-types.ts   vendored Standard Schema and Standard JSON Schema interfaces
  core/
    catalog.ts                 BUILTIN_CATALOG, FACTORY_NAMES, SECONDARY_KEYS (section 3)
    definition.ts              ErrorDefinition, ResolvedDefinition, resolveDefinition(), indexByStatus(), reasonPhrase()
    ban-error.ts               BanError, BanErrorOptions, BanErrorInit, RenderedError, Renderer (section 4)
    types.ts                   Factory, Catalog, BanOptions, BanInstance, Ban, HandlerOptions, ErrorReport, ... (section 2)
    internal.ts                BanCore: what modules share without importing the public Ban
    factories.ts               parseFactoryArgs(), createFactory() (5.1, 5.2)
    assert.ts                  assert() (5.4)
    from.ts                    createFrom() (5.5)
    render.ts                  createRenderer() (6.7)
    create-ban.ts              createBan()
  formats/
    context.ts                 RenderContext, RenderOptions, SchemaContext, SchemaDialect, JsonSchema
    types.ts                   ErrorFormat
    schema-helpers.ts          constant(value, dialect)
    extension-members.ts       flattenMeta() (7.1.2, ADR 0008)
    validation-entries.ts      ValidationEntry, toValidationEntries(), readLocation(), VALIDATION_ENTRIES_SCHEMA
    define-format.ts           defineFormat() (7.5)
    problem-details/index.ts   7.1
    json-api/
      index.ts                 jsonApi(), JsonApiOptions, JsonApiBody (7.2)
      schema.ts                bodySchema() (7.2.3)
    plain/index.ts             7.3
    google-api/
      index.ts                 googleApi(), GoogleApiOptions, GoogleApiBody (7.6)
      rpc-code.ts              GoogleRpcCode, rpcCodeFromStatus(), resolveRpcCode() (7.6.1)
      details.ts               detail payload types and builders (7.6.2)
      schema.ts                bodySchema() (7.6.3)
    stripe/index.ts            7.7
  headers/
    bearer-challenge.ts        bearerChallenge(), BearerChallengeOptions (3.2)
  handler/
    on-error.ts                createOnError(): the pipeline (6.2), fallback (6.4)
    headers.ts                 mergeHeaders() (6.9), assertHeaderName(), assertHeadersInit(), lastResortHeaders() (6.4)
    resolve.ts                 resolveThrown() (6.3)
    request-id.ts              readRequestId() (6.5)
    traceparent.ts             parseTraceparent(), TraceContext (6.6)
    body-cap.ts                capBody() (6.8)
    report.ts                  buildReport() (10.1)
  validation/
    issue.ts                   ValidationIssue, IssueLocation, HookTarget, pointerFromPath(), nameFromPath(), normalizeSegment(), locationFromTarget()
    validation-error.ts        createValidation(): ban.validation() (8.2)
    hook.ts                    createHook(), scalarToString(), ValidationSource, HookResultBase (8.4)
    zod.ts                     8.5
    valibot.ts                 8.6
    standard-schema.ts         8.7
  openapi/index.ts             section 9
  observability/otel.ts        10.3
  testing/index.ts             section 11
  test-support/ajv.ts          compileWithAjv() for the repository's own conformance tests; not published
```

## 2. Core types

All in `src/core/types.ts`, `src/core/ban-error.ts`, `src/core/definition.ts`, and
`src/formats/context.ts`; re-exported from `src/index.ts`. Every optional property is declared
`?: T | undefined` because the package compiles with `exactOptionalPropertyTypes`.

```ts
import type { Context, Env, ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface ErrorDefinition {
  readonly status: ContentfulStatusCode;
  readonly title?: string | undefined; // default: IANA reason phrase, else 'Error'
  readonly code?: string | undefined; // default: the catalog key
  readonly type?: string | undefined; // explicit URI reference only (RFC 9457 3.1.1); formats derive `${base}/${code}` otherwise (ADR 0010)
  readonly description?: string | undefined; // default: title (OpenAPI response description)
}

export interface ResolvedDefinition {
  readonly key: string;
  readonly status: ContentfulStatusCode;
  readonly title: string;
  readonly code: string;
  readonly type: string | undefined; // never derived here; see 7.1.1 and 7.2.1
  readonly description: string;
}

export interface BanErrorOptions {
  readonly detail?: string | undefined;
  readonly type?: string | undefined; // no code or title here: the catalog fixes them and the schema pins them (ADR 0011)
  readonly instance?: string | undefined; // RFC 9457 instance; default: request path at render time
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  readonly headers?: HeadersInit | undefined;
  readonly cause?: unknown;
  readonly id?: string | undefined;
}

export interface Factory {
  (detail?: string, options?: BanErrorOptions): BanError;
  (options: BanErrorOptions): BanError;
}

export type Catalog = Readonly<Record<string, ErrorDefinition>>;
export type EmptyCatalog = Record<never, never>;
export type ErrorKey<TErrors extends Catalog> = keyof BuiltinCatalog | (keyof TErrors & string);
export type BuiltinFactories = { readonly [K in FactoryName]: Factory };
export type CustomFactories<TErrors extends Catalog> = { readonly [K in keyof TErrors]: Factory };
export type ErrorMapper<TErrors extends Catalog> = (
  error: unknown,
  ban: Ban<TErrors>,
) => BanError | undefined;

export interface BanOptions<TErrors extends Catalog> {
  readonly format?: ErrorFormat | undefined; // default problemDetails()
  readonly errors?: TErrors | undefined;
  readonly docsBaseUrl?: string | undefined;
  readonly validationKey?: NoInfer<ErrorKey<TErrors>> | undefined; // default 'VALIDATION_FAILED'
  readonly map?: NoInfer<ErrorMapper<TErrors>> | undefined;
  readonly id?: (() => string) | undefined; // default crypto.randomUUID()
}

export interface CustomErrorInit extends BanErrorOptions {
  readonly status: ContentfulStatusCode;
  readonly code?: string | undefined; // default 'CUSTOM'; free because custom errors have no schema
  readonly title?: string | undefined; // default: IANA reason phrase, else 'Error'
}

export interface ValidationOptions {
  readonly location: IssueLocation;
  readonly detail?: string | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

export interface RenderedError {
  readonly status: ContentfulStatusCode;
  readonly headers: Headers; // includes Content-Type for the format
  readonly body: unknown;
}

export type Renderer = (error: BanError, options?: RenderOptions) => RenderedError;
export type RenderOptions = Partial<Omit<RenderContext, 'meta' | 'stack'>>;

export interface BanInstance<TErrors extends Catalog> {
  readonly format: ErrorFormat;
  readonly catalog: Readonly<Record<ErrorKey<TErrors>, ResolvedDefinition>>;
  readonly docsBaseUrl: string | undefined;
  readonly validationKey: ErrorKey<TErrors>;
  readonly error: (key: ErrorKey<TErrors>, options?: BanErrorOptions) => BanError;
  readonly custom: (init: CustomErrorInit) => BanError;
  readonly validation: (
    issues: ReadonlyArray<ValidationIssue>,
    options: ValidationOptions,
  ) => BanError;
  readonly from: (value: unknown) => BanError;
  readonly onError: <E extends Env = Env>(options?: HandlerOptions<E, TErrors>) => ErrorHandler<E>;
  readonly render: Renderer;
}

export type Ban<TErrors extends Catalog> = BuiltinFactories &
  CustomFactories<TErrors> &
  BanInstance<TErrors>;
export type ReservedKey = keyof BanInstance<Catalog> | FactoryName;
export type NoReserved<T extends Catalog> = {
  readonly [K in keyof T]: K extends ReservedKey ? never : T[K];
};

export function createBan<const TErrors extends Catalog = EmptyCatalog>(
  options?: BanOptions<TErrors> & { readonly errors?: NoReserved<TErrors> | undefined },
): Ban<TErrors>;
```

Rules and rationale:

- Instance members are function-typed properties, not methods, so `ban.from` and `ban.render` can be
  passed around unbound and `unbound-method` lint stays quiet.
- `validationKey` and `map` are wrapped in `NoInfer`: without it, a typo in `validationKey` makes
  TypeScript infer `TErrors` from `keyof TErrors`, fail the constraint, and fall back to `Catalog`,
  which would accept any string. `create-ban.test-d.ts` proves
  `createBan({ validationKey: 'NOPE' })` is rejected.
- **Reserved keys.** `createBan` rejects at the type level any custom key that is an instance member
  or a built-in factory name, and throws `TypeError` at runtime for the same condition.
- **Overriding a built-in.** A custom key equal to a built-in key replaces that definition; the
  camelCase factory keeps working and uses the replacement.
- Hono's `ContentfulStatusCode` covers official statuses only; a non-standard status such as 499
  needs a cast on the caller's side.

## 3. Built-in catalog

`src/core/catalog.ts` exports `BUILTIN_CATALOG` (`as const`, `{ status, title }` per key),
`FACTORY_NAMES` (camelCase name to key; aliases point at the same key), and `SECONDARY_KEYS`. Titles
are the IANA reason phrases; RFC 9110 names are used for 413 and 422, and the names they replaced
are kept as factory aliases: `payloadTooLarge` (RFC 7231 section 6.5.11) and `unprocessableEntity`
(RFC 4918 section 11.2; RFC 7231 never defined 422, RFC 9110 appendix B.3 added it from WebDAV).
@ref https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml @ref
https://www.rfc-editor.org/rfc/rfc9110#name-status-codes @ref
https://www.rfc-editor.org/rfc/rfc4918#section-11.2 @ref
https://www.rfc-editor.org/rfc/rfc9110#appendix-B.3

| Key                             | Status | Factory                                   | Title                           |
| ------------------------------- | ------ | ----------------------------------------- | ------------------------------- |
| BAD_REQUEST                     | 400    | badRequest                                | Bad Request                     |
| MALFORMED_JSON                  | 400    | malformedJson                             | Malformed JSON                  |
| UNAUTHORIZED                    | 401    | unauthorized                              | Unauthorized                    |
| PAYMENT_REQUIRED                | 402    | paymentRequired                           | Payment Required                |
| FORBIDDEN                       | 403    | forbidden                                 | Forbidden                       |
| NOT_FOUND                       | 404    | notFound                                  | Not Found                       |
| METHOD_NOT_ALLOWED              | 405    | methodNotAllowed                          | Method Not Allowed              |
| NOT_ACCEPTABLE                  | 406    | notAcceptable                             | Not Acceptable                  |
| PROXY_AUTHENTICATION_REQUIRED   | 407    | proxyAuthenticationRequired               | Proxy Authentication Required   |
| REQUEST_TIMEOUT                 | 408    | requestTimeout                            | Request Timeout                 |
| CONFLICT                        | 409    | conflict                                  | Conflict                        |
| GONE                            | 410    | gone                                      | Gone                            |
| LENGTH_REQUIRED                 | 411    | lengthRequired                            | Length Required                 |
| PRECONDITION_FAILED             | 412    | preconditionFailed                        | Precondition Failed             |
| CONTENT_TOO_LARGE               | 413    | contentTooLarge, payloadTooLarge          | Content Too Large               |
| URI_TOO_LONG                    | 414    | uriTooLong                                | URI Too Long                    |
| UNSUPPORTED_MEDIA_TYPE          | 415    | unsupportedMediaType                      | Unsupported Media Type          |
| RANGE_NOT_SATISFIABLE           | 416    | rangeNotSatisfiable                       | Range Not Satisfiable           |
| EXPECTATION_FAILED              | 417    | expectationFailed                         | Expectation Failed              |
| MISDIRECTED_REQUEST             | 421    | misdirectedRequest                        | Misdirected Request             |
| UNPROCESSABLE_CONTENT           | 422    | unprocessableContent, unprocessableEntity | Unprocessable Content           |
| VALIDATION_FAILED               | 422    | validationFailed                          | Validation Failed               |
| LOCKED                          | 423    | locked                                    | Locked                          |
| FAILED_DEPENDENCY               | 424    | failedDependency                          | Failed Dependency               |
| TOO_EARLY                       | 425    | tooEarly                                  | Too Early                       |
| UPGRADE_REQUIRED                | 426    | upgradeRequired                           | Upgrade Required                |
| PRECONDITION_REQUIRED           | 428    | preconditionRequired                      | Precondition Required           |
| TOO_MANY_REQUESTS               | 429    | tooManyRequests                           | Too Many Requests               |
| REQUEST_HEADER_FIELDS_TOO_LARGE | 431    | requestHeaderFieldsTooLarge               | Request Header Fields Too Large |
| UNAVAILABLE_FOR_LEGAL_REASONS   | 451    | unavailableForLegalReasons                | Unavailable For Legal Reasons   |
| INTERNAL_SERVER_ERROR           | 500    | internalServerError                       | Internal Server Error           |
| NOT_IMPLEMENTED                 | 501    | notImplemented                            | Not Implemented                 |
| BAD_GATEWAY                     | 502    | badGateway                                | Bad Gateway                     |
| SERVICE_UNAVAILABLE             | 503    | serviceUnavailable                        | Service Unavailable             |
| GATEWAY_TIMEOUT                 | 504    | gatewayTimeout                            | Gateway Timeout                 |
| HTTP_VERSION_NOT_SUPPORTED      | 505    | httpVersionNotSupported                   | HTTP Version Not Supported      |
| VARIANT_ALSO_NEGOTIATES         | 506    | variantAlsoNegotiates                     | Variant Also Negotiates         |
| INSUFFICIENT_STORAGE            | 507    | insufficientStorage                       | Insufficient Storage            |
| LOOP_DETECTED                   | 508    | loopDetected                              | Loop Detected                   |
| NOT_EXTENDED                    | 510    | notExtended                               | Not Extended                    |
| NETWORK_AUTHENTICATION_REQUIRED | 511    | networkAuthenticationRequired             | Network Authentication Required |

Rules:

- 418 is not included.
- `MALFORMED_JSON` and `VALIDATION_FAILED` are the secondary entries: they share a status with a
  primary entry so OpenAPI documents and clients can tell them apart.
- **Primary entry per status** (`indexByStatus()` in `definition.ts`): the built-in entry named
  after the status wins; a custom entry only claims a status no built-in covers. 400 resolves to
  `BAD_REQUEST`, 422 to `UNPROCESSABLE_CONTENT`.
- `catalog.test.ts` asserts IANA completeness (every 4xx and 5xx except 418, once each as a
  primary), title equality with the IANA phrase, alias targets, and that every key has a factory.

### 3.1 Headers some statuses require

The library fills in `Content-Type`, the error id header, and `Cache-Control` (6.9). Some statuses
also require a header only the application can write; the factories accept it through `headers`
(`ban.methodNotAllowed({ headers: { Allow: 'GET, HEAD' } })`) and `ban.from()` keeps it from an
`HTTPException` (5.5). The library never fabricates these values.

| Status   | Header                          | Strength | Source                                                 |
| -------- | ------------------------------- | -------- | ------------------------------------------------------ |
| 401      | `WWW-Authenticate`              | MUST     | https://www.rfc-editor.org/rfc/rfc9110#section-15.5.2  |
| 405      | `Allow`                         | MUST     | https://www.rfc-editor.org/rfc/rfc9110#section-15.5.6  |
| 407      | `Proxy-Authenticate`            | MUST     | https://www.rfc-editor.org/rfc/rfc9110#section-15.5.8  |
| 416      | `Content-Range: bytes */N`      | SHOULD   | https://www.rfc-editor.org/rfc/rfc9110#section-15.5.17 |
| 451      | `Link: <...>; rel="blocked-by"` | SHOULD   | https://www.rfc-editor.org/rfc/rfc7725#section-4       |
| 429      | `Retry-After`                   | MAY      | https://www.rfc-editor.org/rfc/rfc6585#section-4       |
| 503, 3xx | `Retry-After`                   | MAY      | https://www.rfc-editor.org/rfc/rfc9110#section-10.2.3  |

For bearer tokens the 401 challenge follows RFC 6750 section 3 (`Bearer realm=..., error=...`), and
RFC 9728 section 5.1 adds `resource_metadata`; `hono/bearer-auth` produces the former and `from()`
preserves it. `bearerChallenge()` (3.2) builds the value. @ref
https://www.rfc-editor.org/rfc/rfc6750#section-3 @ref
https://www.rfc-editor.org/rfc/rfc9728#section-5.1

### 3.2 `bearerChallenge(options?)` (`headers/bearer-challenge.ts`, ADR 0013)

```ts
export interface BearerChallengeOptions {
  readonly realm?: string | undefined; // printable ASCII; `"` and `\` escaped as quoted-pairs
  readonly scope?: string | ReadonlyArray<string> | undefined; // scope-tokens, space-joined; empty list omits
  readonly error?: string | undefined; // invalid_request | invalid_token | insufficient_scope | extension
  readonly errorDescription?: string | undefined;
  readonly errorUri?: string | undefined;
  readonly resourceMetadata?: string | undefined; // RFC 9728 5.1
}
export function bearerChallenge(options?: BearerChallengeOptions): string;
```

Returns `Bearer ` followed by the present attributes in the order above, each as `name="value"`,
joined by `, `. With no attribute the result is `Bearer realm=""` (RFC 6750 requires one; this is
what `hono/bearer-auth` sends). Values are checked against RFC 6749 appendix A: `scope-token`,
`error_uri`, and `resource_metadata` must be `NQCHAR` (%x21 / %x23-5B / %x5D-7E), `error` and
`error_description` must be `NQSCHAR` (`NQCHAR` plus space), and `realm` must be printable ASCII;
anything else throws a `TypeError` naming the attribute. A string `scope` is split on single spaces
and each token checked. The function only builds the value; it travels through
`BanErrorOptions.headers`. @ref https://www.rfc-editor.org/rfc/rfc6750#section-3 @ref
https://www.rfc-editor.org/rfc/rfc6749#appendix-A @ref
https://www.rfc-editor.org/rfc/rfc9728#section-5.1 @ref
https://www.rfc-editor.org/rfc/rfc9110#section-5.6.4

## 4. `BanError`

File: `src/core/ban-error.ts`.

```ts
export interface BanErrorInit extends BanErrorOptions {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly title: string;
  readonly definition?: ResolvedDefinition | undefined;
  readonly issues?: ReadonlyArray<ValidationIssue> | undefined;
  readonly render?: Renderer | undefined; // injected by factories
}

export class BanError extends HTTPException {
  override readonly name: string = 'BanError';
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly type: string | undefined;
  readonly instance: string | undefined;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly headers: Headers;
  readonly definition: ResolvedDefinition | undefined;
  readonly issues: ReadonlyArray<ValidationIssue> | undefined;
  constructor(init: BanErrorInit);
  toInit(): BanErrorInit; // rebuild an equivalent error (body cap uses it)
  override getResponse(): Response;
}
export function isBanError(value: unknown): value is BanError;
```

- `super(status, { message: detail ?? title, cause })`; `res` is never passed.
- `id` is `init.id ?? generateErrorId()`; `meta` is stored as given (sanitized at render time);
  `headers` is `new Headers(init.headers)`.
- `getResponse()` uses the injected renderer when present (status, headers including `Content-Type`,
  `safeStringify(body)`); otherwise it returns `{ status, code, title, detail, id }` as
  `application/json` with the error's headers. Neither branch adds the handler's `Cache-Control`
  default or the error id header (6.9); those belong to `ban.onError()`.
- No `process`, `Error.captureStackTrace`, or other non-web globals.
- @ref https://hono.dev/docs/api/exception

## 5. Factories, `error`, `custom`, `assert`, `from`

### 5.1 Factory call forms (`factories.ts`)

```ts
ban.notFound();
ban.notFound('Order 42 does not exist');
ban.notFound('Order 42 does not exist', { meta: { orderId: 42 } });
ban.notFound({ detail: 'Order 42 does not exist', headers: { 'Retry-After': '30' } });
```

`parseFactoryArgs(first, second)`: `undefined` first means `second ?? {}`; a string first is the
`detail` and wins over `second.detail`; an object first is the options; anything else throws
`TypeError` (JavaScript callers).

### 5.2 Construction (`BanCore.build`)

`status`, `title`, `code` come from the resolved definition and cannot be changed per call: the
format's schema pins them with `const`, so a per-call value would make the body contradict the
documented response (ADR 0011). `type` comes from the definition, overridable by options; `detail`,
`instance`, `meta`, `headers`, `cause`, `id` come from options; `id` defaults to the instance's
generator; `definition` and `render` are set. Factories are pure and never throw except for the
argument `TypeError`.

### 5.3 `ban.error(key, options?)` and `ban.custom(init)`

`error` is the generic factory; an unknown key throws `RangeError`. `custom` builds an error with no
catalog definition: `title` defaults to the IANA phrase for `status` (else `'Error'`), `code`
defaults to `'CUSTOM'`, `definition` is `undefined`, so the OpenAPI helpers cannot document it.

### 5.4 `assert(value, error)` (standalone, `assert.ts`)

```ts
export function assert<T>(
  value: T,
  error: () => BanError,
): asserts value is Exclude<NonNullable<T>, false>;
```

Throws `error()` when `value` is `null`, `undefined`, or `false`; `0` and `''` pass. It is a
standalone export rather than `ban.assert()` because TypeScript applies assertion signatures only
when every name in the call target has an explicit type annotation (TS2775), and
`const ban = createBan()` has none. `assert.test-d.ts` proves `User | undefined` narrows to `User`
and `boolean | null` narrows to `true`.

### 5.5 `ban.from(value)` (`from.ts`)

1. `BanError` is returned unchanged.
2. `HTTPException`: `status = value.status`; if `status === 400` and
   `message === 'Malformed JSON in request body'` (Hono's validator, exact match) the entry is
   `MALFORMED_JSON`, else the primary entry for the status; if no entry exists (non-standard status)
   the result is `custom({ status, title: 'Error' })`. `detail` is the message unless empty; the
   body of `value.res` is discarded and every header is copied except those describing that body
   (`BODY_HEADERS`, section 13: `Content-Type`, `Content-Length`, `Content-Encoding`,
   `Content-Location`, `Content-Range`, `Transfer-Encoding`), because a kept `Content-Length`
   truncates the rendered body on the wire and a kept `Content-Encoding` makes clients decompress
   plain text; `cause = value`. `Content-Range` is kept when `status === 416`: there it states the
   selected representation's complete length (`bytes */N`), not the body's range, and RFC 9110 says
   a 416 SHOULD carry it. @ref https://github.com/honojs/hono/blob/main/src/validator/validator.ts
   @ref https://www.rfc-editor.org/rfc/rfc9110#section-8.3 @ref
   https://www.rfc-editor.org/rfc/rfc9110#section-14.4 @ref
   https://www.rfc-editor.org/rfc/rfc9110#section-15.5.17
3. Anything else becomes `INTERNAL_SERVER_ERROR` with `detail = UNEXPECTED_DETAIL` and
   `cause = value`.

`from` never throws. `from.test.ts` covers each branch, including `WWW-Authenticate` surviving from
`hono/bearer-auth`, a proxied response losing its framing and coding headers, and a 416 keeping
`Content-Range`.

## 6. The `onError` handler

File: `src/handler/on-error.ts`. `ban.onError(options?)` returns a Hono `ErrorHandler<E>`.

```ts
export interface HandlerOptions<E extends Env = Env, TErrors extends Catalog = Catalog> {
  readonly includeStack?: boolean | undefined; // default false
  readonly requestIdHeader?: string | false | undefined; // default 'X-Request-Id'
  readonly requestId?: ((c: Context<E>) => string | undefined) | undefined; // replaces the header lookup
  readonly traceId?: ((c: Context<E>) => string | undefined) | undefined; // replaces traceparent parsing
  readonly onReport?: ((report: ErrorReport, c: Context<E>) => void | Promise<void>) | undefined;
  readonly headers?: HeadersInit | undefined;
  readonly errorIdHeader?: string | false | undefined; // default 'X-Error-Id'
  readonly maxBodyBytes?: number | undefined; // default 65536
  readonly transform?: ((body: unknown, error: BanError, c: Context<E>) => unknown) | undefined;
  readonly map?: ErrorMapper<TErrors> | undefined; // overrides the instance map
}
```

`ban.onError()` itself throws `TypeError` when `requestIdHeader` or `errorIdHeader` is not a valid
HTTP field name or when `headers` holds a name or value the `Headers` constructor rejects
(`headers.ts`). `Headers` throws the same `TypeError` from `set()` and from its constructor; checked
once at construction, the mistake fails at startup instead of inside the header merge (6.9) that
both fallback tiers share, where it would affect every response. @ref
https://fetch.spec.whatwg.org/#dom-headers-set @ref
https://fetch.spec.whatwg.org/#concept-headers-fill

### 6.1 Guarantees

- Resolves to a `Response` for every `Error` Hono hands it; never throws or rejects.
- Calls `onReport` exactly once per invocation and swallows anything `onReport` throws.
- Hono itself only routes `Error` instances to `onError`; a thrown string or plain object is
  rethrown by Hono before the handler runs (`handleError` in `hono-base.ts`). `ban.from()` still
  handles such values for callers who convert them by hand.

### 6.2 Algorithm

```
(thrown, c):
  try {
    requestId = options.requestId ? options.requestId(c) : readRequestId(c.req.header(requestIdHeader))  // 6.5
    trace     = options.traceId ? { traceId: options.traceId(c) } : parseTraceparent(c.req.header('traceparent'))  // 6.6
    { error, handled } = resolveThrown(thrown, ban, from, map)                                          // 6.3
    renderOptions = { requestId, traceId, instance: c.req.path, method: c.req.method, includeStack }
    rendered = render(error, renderOptions)                                                             // 6.7
    apply = (body) => transform ? transform(body, error, c) : body
    text = capBody(apply(rendered.body), error, renderOptions, render, maxBodyBytes, apply)             // 6.8
    headers = mergeHeaders(options.headers, rendered.headers, errorIdHeader, error.id)                   // 6.9
    await report(onReport, buildReport({...}), c)                                                       // 10.1
    return new Response(text, { status: error.status, headers })
  } catch (failure) {
    return fallback(failure, thrown, c)                                                                 // 6.4
  }
```

`transform` runs before the size cap and again on the minimal body when the cap re-renders (6.8).
`onReport` is awaited; fire-and-forget work belongs in `c.executionCtx.waitUntil()` inside the
callback.

`transform` is also the localization point. RFC 9457 allows `title` to change between occurrences
only for localization (section 3.1.3), and the catalog fixes `title` (ADR 0011), so a localized body
is produced by `transform` from `c.req.header('accept-language')`, and the application states the
language with `Content-Language` through `options.headers` or the error's headers; the library never
sets `Content-Language`. @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.1.3 @ref
https://www.rfc-editor.org/rfc/rfc9110#section-8.5

### 6.3 `resolveThrown` (`resolve.ts`)

`BanError` or `HTTPException` go through `from` with `handled: true`. Otherwise `map`, when set,
runs: a `BanError` result is used with `handled: true`; `undefined` falls through; any other value
throws `TypeError` (a handler failure). Without a mapping the value goes through `from` with
`handled: false`. A `map` that throws propagates to 6.4.

### 6.4 `fallback`

1. Build `INTERNAL_SERVER_ERROR` with `UNEXPECTED_DETAIL` and `cause = thrown`, render it through
   the format with default options, apply the header merge, respond 500.
2. If that throws too (the format is broken), respond with a hand-built `application/json` body
   `{ status: 500, title: 'Internal Server Error', detail, id }`. The header merge (6.9) still
   applies, so `options.headers` and the error id header are present (10.2).
3. If the merge itself throws (`options.headers` changed or started throwing after the construction
   check), `lastResortHeaders` answers with `Content-Type`, `Cache-Control: no-store`, and the error
   id header only; the header name was validated at construction, so this tier cannot throw.

Then report once with `handled: false` and `handlerFailure` set. Tests: a throwing format, a
throwing `map`, a `map` returning a non-`BanError`, a throwing `onReport` (the resolved status is
kept, not turned into 500), a `headers` getter that throws after construction (tier 3 keeps the id
in the header), header options rejected at construction.

### 6.5 Request id (`request-id.ts`)

`readRequestId(value)` returns the value only when it matches `REQUEST_ID_PATTERN`. The library
never fabricates a request id; the error id is the correlation key. `requestIdHeader: false`
disables the lookup.

### 6.6 traceparent (`traceparent.ts`)

`parseTraceparent(value)` returns `{ traceId, parentId, sampled } | undefined`. It matches
`TRACEPARENT_PATTERN` (lowercase hex only), rejects version `ff`, requires exactly 55 characters for
version `00`, accepts other versions when the first 55 characters parse and are followed by `-` or
nothing, rejects all-zero trace or parent ids, and reads the sampled bit from the flags. @ref
https://www.w3.org/TR/trace-context/#traceparent-header

### 6.7 `render` (`render.ts`, shared with `getResponse()`)

1. `meta = sanitizeMeta(error.meta)`.
2. `stack` when `includeStack` and `status >= 500`: the cause's stack when the cause is an `Error`,
   else the error's own.
3. `ctx.instance = error.instance ?? options.instance` (an explicit instance on the error wins over
   the request path).
4. `body = error.issues ? format.renderValidation(error, issues, ctx) : format.render(error, ctx)`.
5. Returns `{ status, headers: error.headers plus Content-Type: format.contentType, body }`.

### 6.8 Body cap (`body-cap.ts`)

Serialize with `safeStringify` (bigint becomes a string; a cycle throws and becomes a handler
failure). If the UTF-8 length exceeds `maxBodyBytes`, rebuild the error from `toInit()` with
`meta: {}`, no issues, and `detail` cut to 1024 characters, render again with `truncated: true` and
`includeStack: false`, run the handler's `transform` on that body too (so a redaction applied to the
first body cannot reappear), and return it.

The cap bounds the members a request can inflate: `meta`, validation issues, `detail`, and the
stack. The members left in the minimal body (`type`, `status`, `title`, `code`, `id`, `instance`,
the request id, the trace id) come from the catalog, the id generator, the request line, and the
128-character request id pattern, so they are bounded by the operator, and the minimal body is
returned as is even when a very small `maxBodyBytes` sits below their size. Tests: an oversized
`meta` and an oversized issue list are dropped, the detail is cut, a stack is dropped, and a
redacting `transform` still applies.

### 6.9 Header merge order

`Cache-Control: no-store` unless `options.headers` carries a `Cache-Control`; then
`options.headers`; then every header of the rendered response (the error's headers plus
`Content-Type`), so an error's own `Cache-Control` wins too; then `errorIdHeader: error.id` unless
disabled. The default exists because 404, 405, 410, 414, and 501 are heuristically cacheable (RFC
9110 section 15.1), every body carries an occurrence id, so a shared cache could replay one client's
error to another, and a 429 MUST NOT be stored (RFC 6585 section 4); see ADR 0012. Both fallback
tiers (6.4) run the same merge. `BanError.getResponse()` outside the handler adds no
`Cache-Control`. @ref https://www.rfc-editor.org/rfc/rfc9110#section-15.1 @ref
https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.5 @ref
https://www.rfc-editor.org/rfc/rfc6585#section-4

`Set-Cookie` is the exception to "later wins": its values never combine and iteration yields each
cookie separately, so the rendered response's cookies are appended after those from
`options.headers` instead of replacing them (@ref
https://fetch.spec.whatwg.org/#dom-headers-getsetcookie). The handler never sets `Vary`. The library
owns only the configured error id header name: renaming or disabling it does not reserve
`X-Error-Id`, so a header of that name supplied through `options.headers` or on the error passes
through unchanged.

## 7. Formats

```ts
export type SchemaDialect = 'draft-2020-12' | 'openapi-3.0';

export interface RenderContext {
  readonly requestId: string | undefined;
  readonly traceId: string | undefined;
  readonly instance: string | undefined;
  readonly method: string | undefined;
  readonly includeStack: boolean;
  readonly docsBaseUrl: string | undefined;
  readonly meta: Readonly<Record<string, unknown>>; // sanitized
  readonly stack: string | undefined;
  readonly truncated: boolean;
}

export interface SchemaContext {
  readonly docsBaseUrl: string | undefined;
  readonly dialect: SchemaDialect;
}

export interface ErrorFormat<TBody = unknown> {
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
```

Constant members are spelled with `constant(value, dialect)` (`schema-helpers.ts`): `{ const }` for
JSON Schema 2020-12 and OpenAPI 3.1, `{ enum: [value] }` for OpenAPI 3.0, which predates `const`.
Problem Details schemas leave `additionalProperties: true` (extension members are allowed);
JSON:API, plain, Google API, and Stripe schemas are closed. @ref
https://spec.openapis.org/oas/v3.1.0#schema-object @ref
https://spec.openapis.org/oas/v3.0.3#schema-object

### 7.1 Problem Details (`formats/problem-details`)

```ts
export interface ProblemDetailsOptions {
  readonly typeBaseUrl?: string | undefined; // base for derived `type`; wins over the instance docsBaseUrl
  readonly includeCode?: boolean | undefined; // default true
  readonly includeId?: boolean | undefined; // default true
  readonly traceIdMember?: string | false | undefined; // default 'traceId'
  readonly instance?: boolean | undefined; // default true
}
```

`contentType = 'application/problem+json'`, no `charset` parameter. @ref
https://www.rfc-editor.org/rfc/rfc9457#section-3

`problemDetails()` throws `TypeError` (`internal/member-name.ts`) when `traceIdMember` is a reserved
member name other than `traceId` (7.1.2), a `PROTO_KEYS` entry, or does not match
`EXTENSION_NAME_PATTERN`: `renderBase` writes the trace id after the library members and the
standard members are spread last, so `'status'` would replace the numeric status and `'id'` the
error id, and a name outside the grammar is not an extension member by the format's own rule.

#### 7.1.1 `render`

Emitted order: `type`, `status` (number), `title`, `detail` (when defined), `instance` (when enabled
and known), `code`, `id`, `[traceIdMember]` (when known), `stack` (when present), then each `meta`
extension member whose name is not reserved (7.1.2). `type` is `error.type` (an explicitly declared
URI, ADR 0010), else `${typeBaseUrl ?? ctx.docsBaseUrl}/${code}`, else `about:blank`. @ref
https://www.rfc-editor.org/rfc/rfc9457#section-4.2.1

#### 7.1.2 Extension members (`extension-members.ts`, ADR 0008)

`flattenMeta(meta)` copies each key matching `EXTENSION_NAME_PATTERN` to the top level and keeps the
others under one `meta` member (merged into an existing plain-object `meta` key, otherwise replacing
it). The renderer then drops every flattened key whose name is reserved: `type`, `status`, `title`,
`detail`, `instance`, `code`, `id`, `traceId`, `stack`, `errors`, and the configured
`traceIdMember`. Reserved names are dropped whether or not this error emits the member, so a
`meta.detail` of `42` can never become the `detail` of an error that has none and the body always
matches its own schema. Tests: a `meta` with `status: 'nope'` renders `status: 404`; `x` and `1st`
end up under `meta`; `retryAfter` is top level; `detail: 42` on an error without a detail is
dropped. @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.2 @ref
https://www.rfc-editor.org/rfc/rfc9457#section-4 (extension member naming, the paragraph after the
definition requirements)

#### 7.1.3 `renderValidation`

Same body with `detail` defaulting to `'Request validation failed'`, the `location` extension member
(from `meta.location`, see 8.2), and `errors`:

```json
"errors": [
  { "location": "body", "pointer": "/email", "detail": "Invalid email address", "code": "invalid_format" },
  { "location": "query", "name": "page", "detail": "Expected number", "code": "invalid_type" }
]
```

Entries (`ValidationEntry` in `validation-entries.ts`) carry `location`, `detail`, optional `code`,
`expected`, `received`, plus `pointer` for `body` and `form` or `name` (first path segment) for
`query`, `param`, `header`, `cookie`.

#### 7.1.4 `schema`

```json
{
  "type": "object",
  "required": ["type", "status", "title"],
  "properties": {
    "type": { "type": "string", "format": "uri-reference" },
    "status": { "const": 404 },
    "title": { "const": "Not Found" },
    "detail": { "type": "string" },
    "instance": { "type": "string", "format": "uri-reference" },
    "code": { "const": "NOT_FOUND" },
    "id": { "type": "string" },
    "traceId": { "type": "string", "pattern": "^[0-9a-f]{32}$" }
  },
  "additionalProperties": true
}
```

Optional members appear only when the matching option is on. `validationSchema` adds `errors` (array
of the entry schema) and requires it.

### 7.2 JSON:API (`formats/json-api`)

```ts
export interface JsonApiOptions {
  readonly typeLinkBaseUrl?: string | undefined; // base for derived `links.type`; wins over docsBaseUrl
  readonly aboutLink?: ((error: BanError, ctx: RenderContext) => string | undefined) | undefined;
  readonly includeId?: boolean | undefined; // default true
  readonly traceIdMetaKey?: string | false | undefined; // default 'traceId'
}
```

`contentType = 'application/vnd.api+json'` without parameters. @ref
https://jsonapi.org/format/#content-negotiation-servers

`jsonApi()` throws `TypeError` when `traceIdMetaKey` is a `meta` key the format writes itself
(`stack`, `location`, `name`, `code`, `expected`, `received`), a `PROTO_KEYS` entry, or not a
JSON:API member name (at least one character; starts and ends with a letter, digit, or a code point
at U+0080 or above; `-`, `_`, and space allowed in between). @ref
https://jsonapi.org/format/#document-member-names

#### 7.2.1 `render`

`{ errors: [errorObject] }` with members in this order, omitting undefined ones: `id`, `links`
(`type` from `error.type` or `${base}/${code}` with `base = typeLinkBaseUrl ?? ctx.docsBaseUrl`,
`about` from `aboutLink`; omitted when both are missing), `status` as a string, `code`, `title`,
`detail`, `meta` (`ctx.meta` plus `[traceIdMetaKey]` and `stack`; omitted when empty). @ref
https://jsonapi.org/format/#error-objects

#### 7.2.2 `renderValidation`

One error object per issue sharing `id`, `status`, `code`, and `title`, with
`detail = issue.message`, `source` = `{ pointer }` for `body` and `form`, `{ parameter }` for
`query`, `{ header }` for `header`, omitted for `param` and `cookie` (JSON:API defines no member for
them), and `meta` = shared meta plus `location`, `name` (param and cookie only), `code`, `expected`,
`received`. An empty issue list renders one error object with
`detail = error.detail ?? 'Request validation failed'`, no `source`, and `meta` = shared meta plus
`location`, because `errors` must hold at least one object (7.2.3). @ref
https://jsonapi.org/format/#errors-processing

#### 7.2.3 `schema` (`schema.ts`)

Closed body `{ errors: [ErrorObject, ...] }`; error objects require `status`, `code`, `title`,
constrain them to the definition's values (`status` as a string), type `links` (`type` and `about`
as `format: uri-reference`, the class JSON:API assigns to link strings), `source`, and `meta`, and
are closed too. @ref https://jsonapi.org/format/#document-links @ref
https://www.rfc-editor.org/rfc/rfc3986#section-4.1

### 7.3 Plain (`formats/plain`)

`contentType = 'application/json'`. Body order: `status`, `code`, `title`, `detail`, `id`,
`instance`, `traceId`, `meta` (nested, omitted when empty), `stack`, `errors` (validation only,
Problem Details entry shape). Schema is closed.

### 7.4 Conformance (`testing`)

```ts
assertFormatConformance(format, catalog, { compile, docsBaseUrl? })
```

`compile(schema)` returns a validator `(body) => problems[]`; the repository uses Ajv 2020 with
`ajv-formats` (`src/test-support/ajv.ts`). For every definition it renders a minimal error, one with
`detail`, colliding and short `meta` keys, nested meta, and headers, one with a stack, and per
location a validation error with two issues and one with none (`ban.validation([])` is legal, and a
schema that demands at least one entry must still be met), then validates each body against `schema`
or `validationSchema` (dialect `draft-2020-12`). Failures are collected into one `AggregateError`.

### 7.5 `defineFormat` (`define-format.ts`)

```ts
export function defineFormat<TBody>(spec: FormatSpec<TBody>): ErrorFormat<TBody>;
export function defineFormat<TSchema extends StandardJsonSchema>(
  spec: StandardFormatSpec<TSchema>,
): ErrorFormat<InferStandardOutput<TSchema>>;
```

`FormatSpec` is `ErrorFormat` with `renderValidation` (defaults to `render`) and `validationSchema`
(defaults to `schema`) optional. `StandardFormatSpec` takes a Standard JSON Schema object;
`schema()` calls `spec.schema['~standard'].jsonSchema.output({ target: ctx.dialect })` and the body
type is the schema's output type. The Standard Schema interfaces are vendored in
`src/internal/standard-schema-types.ts`. @ref https://standardschema.dev/json-schema

### 7.6 Google API (`formats/google-api`, ADR 0014)

```ts
export interface GoogleApiOptions {
  readonly domain: string; // ErrorInfo.domain; required, AIP-193 requires ErrorInfo
  readonly rpcCodes?: Readonly<Record<string, GoogleRpcCode>> | undefined; // `status` per catalog code
  readonly helpLinkBaseUrl?: string | undefined; // base for the Help link; wins over docsBaseUrl
  readonly traceIdMetadataKey?: string | false | undefined; // default 'traceId'
  readonly includeRequestInfo?: boolean | undefined; // default true
}
```

`contentType = 'application/json'`. The body is the AIP-193 HTTP/1.1+JSON representation of
`google.rpc.Status`: `{ error: { code, message, status, details } }`, where `code` is the HTTP
status (not `google.rpc.Status.code`), `status` is the `google.rpc.Code` name, and `details` holds
the standard payloads of `error_details.proto` in proto3 JSON form: each carries its type URL as
`@type`, field names are lowerCamelCase, and fields at their default value (empty string, empty
list, empty map) are omitted. @ref https://google.aip.dev/193#http11json-representation @ref
https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto @ref
https://protobuf.dev/programming-guides/json/

`googleApi()` throws `TypeError` when `traceIdMetadataKey` does not match `METADATA_KEY_PATTERN`
(7.6.2), is `location` (written from `ctx.meta` for validation errors, 8.2), or is a `PROTO_KEYS`
entry.

#### 7.6.1 `status` (`rpc-code.ts`)

Resolution order per entry: `rpcCodes[code]`; else the catalog `code` itself when it names a
`google.rpc.Code` (`NOT_FOUND`, `ALREADY_EXISTS`); else the HTTP status through the table gax-nodejs
uses to turn an HTTP error into a status code: 400 `INVALID_ARGUMENT`, 401 `UNAUTHENTICATED`, 403
`PERMISSION_DENIED`, 404 `NOT_FOUND`, 409 `ABORTED`, 416 `OUT_OF_RANGE`, 429 `RESOURCE_EXHAUSTED`,
499 `CANCELLED`, 501 `UNIMPLEMENTED`, 503 `UNAVAILABLE`, 504 `DEADLINE_EXCEEDED`; any other 2xx
`OK`, any other 4xx `FAILED_PRECONDITION`, any other 5xx `INTERNAL`, everything else `UNKNOWN`. The
result depends only on the definition, so the schema pins `status` with `constant()`. @ref
https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto @ref
https://github.com/googleapis/gax-nodejs/blob/main/gax/src/status.ts

#### 7.6.2 `render` and `renderValidation` (`details.ts`)

`error` members in order: `code` (number), `message` (`detail`, else `title`; for validation
`detail`, else `'Request validation failed'`), `status`, `details`. Payloads in order, each type at
most once as AIP-193 requires:

| Payload       | When                                              | Members                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ErrorInfo`   | always                                            | `reason` = catalog `code`; `domain` = the option; `metadata` = `ctx.meta` with every value a string (strings verbatim, bigint decimal, everything else JSON; `undefined`, functions, and symbols dropped) and every key outside `METADATA_KEY_PATTERN` dropped, plus `[traceIdMetadataKey]` when known, omitted when empty |
| `BadRequest`  | validation with at least one issue                | `fieldViolations`, one per issue: `field` = the path in proto JSON path syntax (`items[0].sku`; omitted for an empty path), `description` = the message, `reason` = the issue code upper-cased when present; proto3 JSON omits an empty repeated field, so no issues means no `BadRequest`                                 |
| `RetryInfo`   | the error's `Retry-After` header is delay-seconds | `retryDelay` = `${seconds}s`; the HTTP-date form needs the current time and formats are pure, so it is not converted                                                                                                                                                                                                       |
| `RequestInfo` | `includeRequestInfo`                              | `requestId` = the error id (10.2 coherence)                                                                                                                                                                                                                                                                                |
| `DebugInfo`   | `ctx.stack` defined                               | `stackEntries` = the stack split on newlines                                                                                                                                                                                                                                                                               |
| `Help`        | a documentation URL exists and is absolute        | one link `{ description: 'Documentation for ${code} errors', url }` with `url` = `error.type`, else `${helpLinkBaseUrl ?? ctx.docsBaseUrl}/${code}`; AIP-193 requires an absolute URL with a scheme, so a relative one yields no `Help`                                                                                    |

Validation `meta.location` (8.2) reaches `ErrorInfo.metadata.location`. `LocalizedMessage` is not
emitted (the handler `transform` is the localization point, 6.2); `QuotaFailure`,
`PreconditionFailure`, and `ResourceInfo` have no source in `BanError`.

`METADATA_KEY_PATTERN` (`details.ts`) is `/^[a-z][a-zA-Z0-9_-]{1,63}$/u`: `error_details.proto` says
`ErrorInfo.metadata` keys "must match a regular expression of `[a-z][a-zA-Z0-9-_]+`" and "must be
limited to 64 characters in length". `toMetadata` drops a key outside it (`order.id`, `UserId`)
rather than throwing, because a throw at render time would turn the error being rendered into a 500;
the key set comes from application code, so a dropped key shows up in the application's own tests.
`reason` is not validated against its grammar (`[A-Z][A-Z0-9_]+[A-Z0-9]`); every built-in code
conforms. @ref https://google.aip.dev/193#errorinfo @ref https://google.aip.dev/193#help

#### 7.6.3 `schema` (`schema.ts`)

Closed at every level: `error` requires `code`, `message`, `status`, `details`; `code` and `status`
are `constant()`; `details` is an array with `minItems: 1` whose `items` is an `anyOf` over the
payload schemas, each a closed object pinning `@type` with `constant()`, `ErrorInfo` also pinning
`reason` and `domain` and typing `metadata` as `additionalProperties: { type: 'string' }` with
`propertyNames: { pattern: METADATA_KEY_PATTERN }` in the 2020-12 dialect only (the OpenAPI 3.0
schema object has neither `propertyNames` nor `patternProperties`), `Help.links[].url` as
`format: uri`. `schema` leaves `BadRequest` out of the `anyOf`; `validationSchema` includes it;
`RequestInfo` appears only when `includeRequestInfo`. `contains` and `prefixItems` would state
"ErrorInfo first" but OpenAPI 3.0 has neither, so both dialects share the `items` form. @ref
https://spec.openapis.org/oas/v3.0.3#schema-object

### 7.7 Stripe (`formats/stripe`, ADR 0014)

```ts
export type StripeErrorType =
  'api_error' | 'card_error' | 'idempotency_error' | 'invalid_request_error';

export interface StripeOptions {
  readonly docUrlBaseUrl?: string | undefined; // base for doc_url; wins over docsBaseUrl
  readonly types?: Readonly<Record<string, StripeErrorType>> | undefined; // `type` per catalog code
  readonly requestLogUrl?:
    ((error: BanError, ctx: RenderContext) => string | undefined) | undefined;
}
```

`contentType = 'application/json'`. Body
`{ error: { code, doc_url?, message, param?, request_log_url?, type } }`: the members of Stripe's
`api_errors` object that a general API can fill, in alphabetical order, which is the order Stripe
serializes (an unauthenticated request to `api.stripe.com` answers
`{"error":{"message":"...","type":"invalid_request_error"}}`). Members Stripe reserves for card
payments (`advice_code`, `charge`, `decline_code`, `network_advice_code`, `network_decline_code`,
`payment_intent`, `payment_method`, `payment_method_type`, `setup_intent`, `source`) are never
emitted. @ref https://docs.stripe.com/api/errors @ref
https://github.com/stripe/openapi/blob/master/openapi/spec3.json (`components.schemas.api_errors`)

#### 7.7.1 `render` and `renderValidation`

- `code`: the catalog `code` lower-cased (`NOT_FOUND` becomes `not_found`), Stripe's spelling; a
  lower snake code declared in the catalog is unchanged.
- `doc_url`: `error.type`, else `${docUrlBaseUrl ?? ctx.docsBaseUrl}/${code}` with the code as
  spelled in the catalog (the same URL every format derives, ADR 0010); omitted when neither exists.
- `message`: `detail`, else `title`. Validation: the first issue's message, else `detail`, else
  `'Request validation failed'`.
- `param`: validation only, the first issue's path in Stripe's bracket notation (`items[0][sku]`,
  `page`), the `deepObject` form encoding of its requests; omitted for an empty path. Stripe reports
  one problem per response, so the remaining issues are dropped. @ref
  https://spec.openapis.org/oas/v3.0.3#style-values
- `request_log_url`: `requestLogUrl(error, ctx)` when the option is set and returns a string.
- `type`: `types[code]`, else by status the way Stripe's SDKs classify errors: 402 `card_error`, any
  other 4xx `invalid_request_error`, everything else `api_error`. @ref
  https://github.com/stripe/stripe-node/blob/master/src/Error.ts (`generateV1Error`)

Nothing else is rendered: the shape has no member for `meta`, the trace id, the stack, or the error
id, which travels only in the `X-Error-Id` header (and in `request_log_url` when the application
builds one from `error.id`).

#### 7.7.2 `schema`

Closed: `error` requires `code`, `message`, `type`; `code` (lower-cased) and `type` are
`constant()`; `doc_url` and `request_log_url` are `format: uri-reference`, the latter present only
when `requestLogUrl` is set; `param` appears only in `validationSchema`.

## 8. Validation

### 8.1 Types (`validation/issue.ts`)

```ts
export type IssueLocation = 'body' | 'form' | 'query' | 'param' | 'header' | 'cookie';
export type HookTarget = 'json' | 'form' | 'query' | 'param' | 'header' | 'cookie';
export interface ValidationIssue {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
  readonly code?: string | undefined;
  readonly expected?: string | undefined;
  readonly received?: string | undefined;
}
```

### 8.2 `ban.validation(issues, { location, detail?, meta? })`

Builds the `validationKey` entry (default `VALIDATION_FAILED`, 422) with `issues` attached and
`meta.location = location`; formats read the location back with `readLocation(ctx.meta)`.

### 8.3 Pointers and names

`pointerFromPath` follows RFC 6901 (`~` to `~0` before `/` to `~1`; `''` for an empty path);
`nameFromPath` is the first segment as a string; `normalizeSegment` turns symbols into their
description (or `'symbol'`). @ref https://www.rfc-editor.org/rfc/rfc6901#section-3

### 8.4 Hooks (`validation/hook.ts`)

Every Hono validator calls its hook as `hook(result & { target }, c)` and continues when the hook
returns nothing. `createHook(ban, extract)` returns `(result) => void` that does nothing on
`success` and otherwise throws
`ban.validation(extract(result), { location: locationFromTarget(target) })` (`json` maps to `body`).
The result types are structural supersets of what the validators pass, so `hooks.test-d.ts` proves
assignability to `@hono/zod-validator`, `@hono/zod-openapi` (`defaultHook`),
`@hono/valibot-validator`, and `@hono/standard-validator` hook types without those packages being
dependencies. @ref
https://github.com/honojs/middleware/blob/main/packages/zod-validator/src/index.ts @ref
https://github.com/honojs/middleware/blob/main/packages/zod-openapi/src/index.ts @ref
https://github.com/honojs/middleware/blob/main/packages/valibot-validator/src/index.ts @ref
https://github.com/honojs/middleware/blob/main/packages/standard-validator/src/index.ts

### 8.5 Zod (`hono-ban/zod`)

Reads `error.issues[]` with `path` (PropertyKey[]), `message`, `code`, and scalar `expected` and
`received` when present, so Zod 3.25+ and Zod 4 both work (`zod.test.ts` covers both). @ref
https://zod.dev/error-formatting

### 8.6 Valibot (`hono-ban/valibot`)

Reads `issues[]` with `type` (as `code`), `message`, `expected` (omitted when `null`), `received`,
and `path[].key` (non-scalar keys render as `?`). @ref https://valibot.dev/api/BaseIssue/

### 8.7 Standard Schema (`hono-ban/standard-schema`)

Reads `issues[]` with `message` and `path` (raw keys or `{ key }` segments). The spec defines no
code, expected, or received. @ref https://standardschema.dev

## 9. OpenAPI (`hono-ban/openapi`)

```ts
export interface OpenApiOptions {
  readonly dialect?: SchemaDialect | undefined;
  readonly description?: string | undefined;
}
export function errorSchema(ban, ref: string | number, options?): JsonSchema;
export function errorResponse(ban, ref, options?): ResponseObject;
export function errorResponses(
  ban,
  refs: ReadonlyArray<string | number>,
  options?,
): Record<string, ResponseObject>;
export function validationSchema(ban, options?): JsonSchema;
export function validationResponse(ban, options?): ResponseObject;
```

- A number resolves to the primary entry for that status; a string to the catalog key; unknown refs
  and `CUSTOM` throw `RangeError`.
- `ResponseObject` is `{ description, content: { [format.contentType]: { schema } } }` with
  `description` defaulting to the definition's.
- `errorResponses` groups by status; entries sharing a status merge into `{ anyOf: [...] }` with
  descriptions joined by `' or '`, after structurally identical schemas are collapsed (a format that
  emits one shape for every entry yields that schema once, not an `anyOf`). `anyOf` rather than
  `oneOf`: a body must satisfy at least one entry's schema, and `oneOf` would reject a body that
  matches several branches (ADR 0011). @ref
  https://json-schema.org/draft/2020-12/json-schema-core#section-10.2.1.2
- `@hono/zod-openapi` accepts raw schema objects in `content[*].schema`
  (`ZodMediaTypeObject.schema: ZodType | SchemaObject | ReferenceObject`), so the objects drop
  straight into `createRoute({ responses })`. `openapi/index.test.ts` generates an OpenAPI 3.1
  document and asserts the emitted schemas deep-equal `errorSchema()`. Pass
  `{ dialect: 'openapi-3.0' }` for 3.0 documents. @ref
  https://github.com/asteasolutions/zod-to-openapi/blob/master/src/openapi-registry.ts
- `OpenAPIHono.doc()` always generates a 3.0.x document (it uses `OpenApiGeneratorV3` whatever the
  `openapi` string says); `doc31()` generates 3.1. Pair `doc()` with `{ dialect: 'openapi-3.0' }`
  and `doc31()` with the default dialect. Verified in `e2e/openapi-document.e2e.test.ts`. @ref
  https://github.com/honojs/middleware/blob/main/packages/zod-openapi/src/index.ts

## 10. Observability

### 10.1 `ErrorReport` (`handler/report.ts`)

```ts
export interface ErrorReport {
  readonly id: string;
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly error: BanError;
  readonly cause: unknown; // the thrown value, or error.cause when the BanError itself was thrown
  readonly handled: boolean;
  readonly handlerFailure: unknown; // set only on the fallback path
  readonly context: { requestId; traceId; spanId; method; path };
}
```

### 10.2 Coherence

The same `id` appears in the body, in the error id header, and in the report (`on-error.test.ts`).
Stripe is the exception (7.7): its shape has no member for the id, which travels in the header and
the report only.

### 10.3 `hono-ban/otel`

`traceIdFromOtel(source)` accepts the `trace` API or the whole `@opentelemetry/api` namespace
(structurally: `getActiveSpan()` returning a span with `spanContext().traceId`) and returns a
zero-argument function that yields the active span's trace id when it is 32 lowercase hex characters
and not all zeros. Usage: `ban.onError({ traceId: traceIdFromOtel(trace) })`. @ref
https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_api.SpanContext.html

## 11. Testing utilities (`hono-ban/testing`)

- `renderError(ban, error, options?)`: `ban.render`.
- `expectBanError(value, expected?)`: asserts `value is BanError`, comparing `status`, `code`,
  `detail` when given, with readable messages.
- `assertFormatConformance(format, catalog, { compile })`: section 7.4.

## 12. Packaging

`tsdown.config.ts` entries (keys become `exports` subpaths; `exports: true` rewrites `package.json`
and CI diffs it):

```
index, formats/problem-details, formats/json-api, formats/plain, formats/google-api, formats/stripe,
zod, valibot, standard-schema, openapi, otel, testing
```

`peerDependencies` is `{ "hono": ">=4.12.34" }` and there are no `dependencies`. Validators,
`@hono/*` packages, `@opentelemetry/api`, Ajv, and `ajv-formats` are devDependencies used only by
tests. `sideEffects: false`. publint and attw run as part of the build.

The repository is a pnpm workspace with two packages: the root (published) and `e2e/` (private,
`hono-ban-e2e`). `e2e/` depends on `hono-ban` through `workspace:*`, so its imports resolve through
the `exports` map above into `dist/`, and its own `tsconfig.json` checks the emitted declarations.
`pnpm test:e2e` builds first, then type-checks and runs it. `e2e/smoke/` holds the runtime smoke
test and its Bun, Deno, and workerd entry points (14.2); `pnpm test:runtimes` builds and runs the
three. Section 14 lists the suites.

## 13. Constants (`src/internal/constants.ts`)

| Name                        | Value                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `UNEXPECTED_DETAIL`         | `'An unexpected error occurred'`                                                                                         |
| `VALIDATION_DETAIL`         | `'Request validation failed'`                                                                                            |
| `MALFORMED_JSON_MESSAGE`    | `'Malformed JSON in request body'`                                                                                       |
| `DEFAULT_REQUEST_ID_HEADER` | `'X-Request-Id'`                                                                                                         |
| `DEFAULT_ERROR_ID_HEADER`   | `'X-Error-Id'`                                                                                                           |
| `DEFAULT_CACHE_CONTROL`     | `'no-store'`                                                                                                             |
| `DEFAULT_MAX_BODY_BYTES`    | `65536`                                                                                                                  |
| `TRUNCATED_DETAIL_LENGTH`   | `1024`                                                                                                                   |
| `REQUEST_ID_PATTERN`        | `/^[A-Za-z0-9._-]{1,128}$/u`                                                                                             |
| `TRACEPARENT_PATTERN`       | `/^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})/u`                                                          |
| `TRACEPARENT_LENGTH`        | `55`                                                                                                                     |
| `EXTENSION_NAME_PATTERN`    | `/^[A-Za-z][A-Za-z0-9_]{2,}$/u`                                                                                          |
| `PROTO_KEYS`                | `Set { '__proto__', 'constructor', 'prototype' }`                                                                        |
| `BODY_HEADERS`              | `Set { 'content-type', 'content-length', 'content-encoding', 'content-location', 'content-range', 'transfer-encoding' }` |

## 14. Test plan

Coverage thresholds (90 percent) are enforced by Vitest.

| Module               | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/catalog`       | IANA completeness, title equality, alias targets, factory coverage, type mapping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `core/definition`    | defaults, derived `type`, explicit values, unknown status title                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `core/ban-error`     | HTTPException interop, message fallback, id, headers/meta/cause, `getResponse` both branches, `toInit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `core/factories`     | call forms, detail precedence, `TypeError`, `type`/`instance`/`id` options, `code` and `title` rejected at the type level, aliases, purity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `core/assert`        | throws for `null`, `undefined`, `false`; passes `0`, `''`; producer laziness; narrowing types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `core/from`          | passthrough, status mapping, `MALFORMED_JSON` exact match, `res` headers kept and body headers dropped, `Content-Range` kept on 416, custom and non-standard statuses, unknown values                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `core/create-ban`    | every built-in factory, custom factories, overriding a built-in, reserved keys (runtime and types), `validationKey`, format and id generator, `custom`, `render`, typed `onError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `core/render`        | meta sanitization, stack rules, explicit instance, validation branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `headers/*`          | `bearerChallenge` attribute order, empty-realm fallback, scope string and list, realm quoted-pairs, `TypeError` per grammar, round trip through `Headers` and a factory                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `handler/*`          | request id validation, traceparent grammar, body cap (transform re-applied, stack dropped), single-handler and middleware apps, bearer-auth headers, Hono validator JSON failure, constant 500, map precedence and failures, format failure fallback, header-merge failure (tier 3), header options rejected at construction, `onReport` failure, transform, header merge including `Set-Cookie`, `Cache-Control` default and overrides, error id header options, request id options, traceparent into body and report, trace override, Hono rethrowing non-Errors                                                                                   |
| `formats/*`          | extension flattening and precedence, Problem Details members and toggles, `traceIdMember` rejected, validation entries, plain shape, JSON:API objects and sources, `traceIdMetaKey` rejected, empty issue list, closed schemas, OpenAPI 3.0 `enum`, `defineFormat` both forms and types, Google API `status` resolution, metadata stringification and key filtering, `traceIdMetadataKey` rejected, empty issue list without `BadRequest`, `propertyNames` per dialect, field paths, `RetryInfo`, absolute-only `Help`, closed detail schemas, Stripe member order, `type` classification, first-issue `param`, Ajv conformance for all five formats |
| `validation/*`       | pointer escaping, symbols, target mapping, `ban.validation`, Zod 4 and Zod 3 issues, `zValidator` and `OpenAPIHono` hooks, Valibot issues and `vValidator`, Standard Schema issues and `sValidator`, hook type assignability                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `openapi`            | key and status resolution, descriptions, `RangeError`s, dialect, `anyOf` grouping and identical-schema collapse, content type, validation response, generated OpenAPI 3.1 document                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `observability/otel` | fake and real trace APIs, invalid ids                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `testing`            | `expectBanError` messages, `renderError`, `assertFormatConformance` on a broken format                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 14.1 End-to-end suite (`e2e/`)

The `e2e/` workspace package (section 12) consumes the built package and runs every file against a
real `@hono/node-server` HTTP server on an ephemeral port (`e2e/support/server.ts`). Bodies are read
with `fetch` and, wherever the package publishes a schema, validated with Ajv
(`e2e/support/ajv.ts`). `pnpm test:e2e` runs it; CI runs it on Node 22 and 24.

| File(s)                                                             | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package-surface`                                                   | every subpath in section 1 resolves through `exports` and exports exactly the listed values; first HTTP round trip                                                                                                                                                                                                                                                                                                                                                   |
| `catalog-builtins`, `catalog-custom`                                | every `FACTORY_NAMES` entry over HTTP (status, title, code, `about:blank`, `X-Error-Id`), aliases, call forms, custom entries and overrides, `custom()`, `assert()` narrowing, reserved-key and `validationKey` constructor errors                                                                                                                                                                                                                                   |
| `handler-identity-ids`, `-reports`, `-correlation`                  | id coherence across body, header, report; `errorIdHeader`; header merge matrix including `Set-Cookie` and the `Cache-Control` default and override; deterministic ids; 20 concurrent requests; `ErrorReport` shape and `handled`; `includeStack` rules; request id and traceparent tables; `traceId` override                                                                                                                                                        |
| `handler-not-found`                                                 | `app.notFound` throwing `ban.notFound()` reaches `onError` on both Hono dispatch paths (no handler matched; one middleware matched) with body, header, and report; matched routes untouched                                                                                                                                                                                                                                                                          |
| `handler-resolution-from`, `-headers`, `-pipeline`, `-body`         | `from()` branches (plain `Error`, `HTTPException`, bearer-auth, malformed JSON, unknown status); an adopted response losing `Content-Length` and `Content-Encoding` but keeping `Retry-After`, a 416 keeping `Content-Range`, and a `bearerChallenge` value arriving verbatim; instance and handler `map` precedence; tier-1 and tier-2 fallback with headers; `transform` before and after the cap; `maxBodyBytes`; `onReport` once and swallowed; non-Error throws |
| `format-problem-details-members`, `-extensions`, `-schema`          | member order, `type` derivation for four instance shapes, toggles, ADR 0008 flattening and reserved names, proto keys, bigint, validation bodies for all locations, schema equality and Ajv conformance                                                                                                                                                                                                                                                              |
| `format-json-api`, `format-json-api-validation`                     | exact media type, error object members, `links`, nested `meta`, `traceIdMetaKey`, per-issue `source` for every location, RFC 6901 pointers, Ajv conformance                                                                                                                                                                                                                                                                                                          |
| `format-custom-oauth`                                               | the README's OAuth 2.0 token endpoint `defineFormat` example (RFC 6749 5.2): `error`, `error_description`, `error_uri` from `code`, `detail`, `type`; `invalid_client` with the app's challenge; `bearerChallenge` pairing; conformance in both dialects                                                                                                                                                                                                             |
| `format-google-api`, `-validation`, `-options`                      | AIP-193 member order, `status` derivation for built-in and custom codes, `ErrorInfo.metadata` strings and trace id, `RetryInfo` from `Retry-After`, `DebugInfo` under `includeStack`, absolute-only `Help`, `BadRequest` per location and issue, `validationSchema` versus `schema`, every option over HTTP, Ajv conformance, 3.0 `enum`                                                                                                                             |
| `format-validation-empty-issues`                                    | `ban.validation([])` over HTTP for all five formats validates against `validationSchema`                                                                                                                                                                                                                                                                                                                                                                             |
| `format-stripe`                                                     | exact serialized text in alphabetical order, `type` by status and per-code override, an unknown `Error` as `api_error` with the constant detail, first-issue `param` per location, `request_log_url`, closed schemas, Ajv conformance                                                                                                                                                                                                                                |
| `format-plain-custom-plain`, `-define`, `-testing`                  | `plain()` body and schema, `defineFormat` hand-written and Standard JSON Schema (Zod 4) forms over HTTP, `renderError`, `expectBanError`, `assertFormatConformance` failures                                                                                                                                                                                                                                                                                         |
| `validation-zod`, `validation-zod-direct`, `validation-zod-openapi` | `zValidator` hook for every target, pointer escaping, typed passthrough, `validationKey`, `fromZodError`, `toIssues`, `OpenAPIHono` `defaultHook` parity                                                                                                                                                                                                                                                                                                             |
| `validation-valibot-standard-valibot`, `-standard-schema`           | `vValidator` and `sValidator` hooks (Zod and Valibot schemas), `expected`/`received` mapping, direct converters, `ban.validation()`, JSON:API `source` for Valibot issues                                                                                                                                                                                                                                                                                            |
| `openapi-document`, `openapi-responses`                             | served 3.1 (`doc31`) and 3.0 (`doc`) documents, `const` versus `enum`, `anyOf` grouping, real error bodies validated against the served schemas, `RangeError`s                                                                                                                                                                                                                                                                                                       |
| `otel-correlation`, `otel-sources`                                  | real `NodeTracerProvider` spans: body and report trace id equal the exported span, option wins over `traceparent`, no span outside the middleware, `{ trace }` form, invalid span contexts ignored, JSON:API `meta.traceId`                                                                                                                                                                                                                                          |

### 14.2 Runtime smoke test (`e2e/smoke/`)

The README promises Bun, Deno, and Cloudflare Workers. `e2e/smoke/app.ts` is one Hono app that
imports every published subpath and throws one error per feature family (catalog and custom entries
through an explicit `problemDetails()`, `ban.validation` through the Zod, Valibot, and Standard
Schema hooks, `HTTPException` from `hono/bearer-auth`, an unknown `Error`, JSON:API, plain, Google
API, and Stripe sub-apps, the OpenAPI helpers, `renderError` from `hono-ban/testing`, a
`bearerChallenge` header, the OpenTelemetry adapter). `checks.ts` asserts the responses through a
runtime-neutral `dispatch` function, checks `Cache-Control: no-store` and a matching `X-Error-Id` on
every Problem Details response, and `report()` throws on any failure, so the process exits non-zero.
A new subpath is not covered until `app.ts` imports it and `checks.ts` exercises it. Entry points:

| Script                  | Runtime                                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke:bun` (`run.ts`)  | Bun runs `run.ts`, which drives `app.request()` in-process; `hono-ban` resolves through `node_modules` like on Node                          |
| `smoke:deno` (`run.ts`) | Deno 2 runs the same file with `--allow-read --allow-env`; a `package.json` puts it in manual `node_modules` mode, so pnpm's install is used |
| `smoke:workerd`         | Node bundles `worker.ts` with tsdown (`platform: 'neutral'`) and runs the checks against Miniflare's workerd through `dispatchFetch`         |

CI runs the three in one job after `pnpm build`; `pnpm test:runtimes` does the same locally.
