/**
 * Stripe-style error format (SPEC 7.7): `{ error: { code, doc_url, message,
 * param, request_log_url, type } }`, the members of Stripe's `api_errors`
 * object that a general API can fill, in the alphabetical order Stripe
 * serializes them. Stripe's shape is a vendor convention, not a
 * specification; it ships in-tree because it is the most copied error
 * envelope in commercial APIs (ADR 0014).
 * @ref https://docs.stripe.com/api/errors
 * @ref https://github.com/stripe/openapi/blob/master/openapi/spec3.json (components.schemas.api_errors)
 * @packageDocumentation
 */
import type { BanError } from '../../core/ban-error';
import type { ResolvedDefinition } from '../../core/definition';
import type { ValidationIssue } from '../../validation/issue';
import type { JsonSchema, RenderContext, SchemaContext } from '../context';
import type { ErrorFormat } from '../types';

import { VALIDATION_DETAIL } from '../../internal/constants';
import { constant } from '../schema-helpers';

/**
 * The closed `type` enumeration of `api_errors`. Stripe's SDKs classify
 * authentication, permission, and rate limit errors by HTTP status, not by
 * `type`; on the wire those carry `invalid_request_error`.
 * @ref https://docs.stripe.com/api/errors (type)
 * @ref https://github.com/stripe/stripe-node/blob/master/src/Error.ts (generateV1Error)
 */
export type StripeErrorType =
  | 'api_error'
  | 'card_error'
  | 'idempotency_error'
  | 'invalid_request_error';

export interface StripeOptions {
  /** Base for `doc_url`; overrides the instance `docsBaseUrl`. */
  readonly docUrlBaseUrl?: string | undefined;
  /**
   * `type` per catalog code, for entries the status-based default gets wrong
   * (an `idempotency_error` on a 400, a `card_error` on a 400).
   */
  readonly types?: Readonly<Record<string, StripeErrorType>> | undefined;
  /**
   * Produces `request_log_url`, "a URL to the request log entry in your
   * dashboard". The one member of Stripe's shape that can carry the error id
   * to the client in the body; the `X-Error-Id` header carries it regardless.
   */
  readonly requestLogUrl?:
    | ((error: BanError, ctx: RenderContext) => string | undefined)
    | undefined;
}

/**
 * The `error` member. Members Stripe reserves for card payments
 * (`charge`, `decline_code`, `payment_intent`, ...) are never emitted.
 * @ref https://docs.stripe.com/api/errors
 */
export interface StripeErrorObject {
  /** The catalog code in lower snake case, Stripe's spelling. */
  readonly code: string;
  readonly doc_url?: string;
  readonly message: string;
  /** The offending parameter in Stripe's bracket notation, validation only. */
  readonly param?: string;
  readonly request_log_url?: string;
  readonly type: StripeErrorType;
}

export interface StripeBody {
  readonly error: StripeErrorObject;
}

/** Stripe answers errors as plain JSON. */
export const STRIPE_CONTENT_TYPE = 'application/json';

const PAYMENT_REQUIRED = 402;
const CLIENT_ERROR = 400;
const SERVER_ERROR = 500;

interface Resolved {
  readonly docUrlBaseUrl: string | undefined;
  readonly types: Readonly<Record<string, StripeErrorType>> | undefined;
  readonly requestLogUrl:
    | ((error: BanError, ctx: RenderContext) => string | undefined)
    | undefined;
}

/**
 * Stripe's own classification, as implemented by its SDKs: 402 is a card
 * error, every other 4xx an invalid request, everything else an API error.
 * An unauthenticated request to api.stripe.com answers 401 with
 * `"type": "invalid_request_error"`.
 * @ref https://github.com/stripe/stripe-node/blob/master/src/Error.ts (generateV1Error)
 * @ref https://docs.stripe.com/api/errors (HTTP status code summary)
 */
function typeFromStatus(status: number): StripeErrorType {
  if (status === PAYMENT_REQUIRED) {
    return 'card_error';
  }
  if (status >= CLIENT_ERROR && status < SERVER_ERROR) {
    return 'invalid_request_error';
  }
  return 'api_error';
}

function resolveType(
  code: string,
  status: number,
  types: Readonly<Record<string, StripeErrorType>> | undefined,
): StripeErrorType {
  return types?.[code] ?? typeFromStatus(status);
}

/**
 * Stripe requests are form-encoded with OpenAPI `deepObject` style, so a
 * nested parameter is spelled `items[0][sku]` and `param` echoes that name.
 * @ref https://github.com/stripe/openapi/blob/master/openapi/spec3.json (requestBody encoding: style deepObject)
 * @ref https://spec.openapis.org/oas/v3.0.3#style-values
 */
function paramName(path: ReadonlyArray<string | number>): string | undefined {
  const [first, ...rest] = path;
  if (first === undefined) {
    return undefined;
  }
  let out = String(first);
  for (const segment of rest) {
    out += `[${String(segment)}]`;
  }
  return out;
}

/**
 * Members in alphabetical order, as Stripe serializes them (SPEC 7.7.1).
 * Stripe reports one problem per response, so a validation error renders its
 * first issue and drops the rest.
 */
function renderBody(
  error: BanError,
  ctx: RenderContext,
  options: Resolved,
  validation: boolean,
  issue?: ValidationIssue,
): StripeBody {
  const base = options.docUrlBaseUrl ?? ctx.docsBaseUrl;
  const docUrl =
    error.type ?? (base === undefined ? undefined : `${base}/${error.code}`);
  const param = issue === undefined ? undefined : paramName(issue.path);
  const logUrl = options.requestLogUrl?.(error, ctx);
  return {
    error: {
      code: error.code.toLowerCase(),
      ...(docUrl === undefined ? {} : { doc_url: docUrl }),
      message:
        issue?.message ??
        error.detail ??
        (validation ? VALIDATION_DETAIL : error.title),
      ...(param === undefined ? {} : { param }),
      ...(logUrl === undefined ? {} : { request_log_url: logUrl }),
      type: resolveType(error.code, error.status, options.types),
    },
  };
}

function bodySchema(
  definition: ResolvedDefinition,
  ctx: SchemaContext,
  options: Resolved,
  validation: boolean,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    code: constant(definition.code.toLowerCase(), ctx.dialect),
    doc_url: { type: 'string', format: 'uri-reference' },
    message: { type: 'string' },
  };
  if (validation) {
    properties['param'] = { type: 'string' };
  }
  if (options.requestLogUrl !== undefined) {
    properties['request_log_url'] = { type: 'string', format: 'uri-reference' };
  }
  properties['type'] = constant(
    resolveType(definition.code, definition.status, options.types),
    ctx.dialect,
  );
  return {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message', 'type'],
        properties,
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };
}

/**
 * Stripe-style errors (SPEC 7.7).
 * @ref https://docs.stripe.com/api/errors
 */
export function stripe(options: StripeOptions = {}): ErrorFormat<StripeBody> {
  const resolved: Resolved = {
    docUrlBaseUrl: options.docUrlBaseUrl,
    types: options.types,
    requestLogUrl: options.requestLogUrl,
  };
  return {
    name: 'stripe',
    contentType: STRIPE_CONTENT_TYPE,
    render(error: BanError, ctx: RenderContext): StripeBody {
      return renderBody(error, ctx, resolved, false);
    },
    renderValidation(
      error: BanError,
      issues: ReadonlyArray<ValidationIssue>,
      ctx: RenderContext,
    ): StripeBody {
      return renderBody(error, ctx, resolved, true, issues[0]);
    },
    schema(definition: ResolvedDefinition, ctx: SchemaContext): JsonSchema {
      return bodySchema(definition, ctx, resolved, false);
    },
    validationSchema(
      definition: ResolvedDefinition,
      ctx: SchemaContext,
    ): JsonSchema {
      return bodySchema(definition, ctx, resolved, true);
    },
  };
}
