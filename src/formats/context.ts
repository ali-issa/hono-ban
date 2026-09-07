/**
 * Context objects handed to formats. Kept free of `BanError` so formats and
 * the error class can reference each other without an import cycle.
 * @packageDocumentation
 */

export interface RenderContext {
  readonly requestId: string | undefined;
  readonly traceId: string | undefined;
  /** RFC 9457 `instance`; the request path unless the error sets one. */
  readonly instance: string | undefined;
  readonly method: string | undefined;
  readonly includeStack: boolean;
  readonly docsBaseUrl: string | undefined;
  /** Already sanitized (ADR 0007). */
  readonly meta: Readonly<Record<string, unknown>>;
  /** Present only when `includeStack` is on and the status is 5xx. */
  readonly stack: string | undefined;
  /** True on the second render after the body cap was exceeded (SPEC 6.8). */
  readonly truncated: boolean;
}

/** What callers may override when rendering outside the handler. */
export type RenderOptions = Partial<Omit<RenderContext, 'meta' | 'stack'>>;

/**
 * OpenAPI 3.1 schema objects are JSON Schema 2020-12; OpenAPI 3.0 predates
 * `const`, so formats emit single-value `enum`s there instead.
 * @ref https://spec.openapis.org/oas/v3.1.0#schema-object
 * @ref https://spec.openapis.org/oas/v3.0.3#schema-object
 */
export type SchemaDialect = 'draft-2020-12' | 'openapi-3.0';

export interface SchemaContext {
  readonly docsBaseUrl: string | undefined;
  readonly dialect: SchemaDialect;
}

/** A JSON Schema 2020-12 object. */
export type JsonSchema = Record<string, unknown>;
