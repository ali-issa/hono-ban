/**
 * Google API error format (SPEC 7.6): the AIP-193 HTTP/1.1+JSON
 * representation of `google.rpc.Status`, `{ error: { code, message, status,
 * details } }`, with `code` the HTTP status, `status` the `google.rpc.Code`
 * name, and `details` the standard payloads from `error_details.proto`
 * packed as `google.protobuf.Any`. `ErrorInfo` is always present, as AIP-193
 * requires.
 * @ref https://google.aip.dev/193#http11json-representation
 * @ref https://github.com/googleapis/googleapis/blob/master/google/rpc/status.proto
 * @ref https://github.com/googleapis/googleapis/blob/master/google/rpc/error_details.proto
 * @packageDocumentation
 */
import type { BanError } from '../../core/ban-error';
import type { ResolvedDefinition } from '../../core/definition';
import type { ValidationIssue } from '../../validation/issue';
import type { JsonSchema, RenderContext, SchemaContext } from '../context';
import type { ErrorFormat } from '../types';
import type { GoogleApiDetail, GoogleApiErrorInfo } from './details';
import type { GoogleRpcCode } from './rpc-code';

import { VALIDATION_DETAIL } from '../../internal/constants';
import { assertMemberName } from '../../internal/member-name';
import {
  BAD_REQUEST_TYPE,
  DEBUG_INFO_TYPE,
  ERROR_INFO_TYPE,
  fieldViolation,
  help,
  METADATA_KEY_PATTERN,
  REQUEST_INFO_TYPE,
  retryInfo,
  toMetadata,
} from './details';
import { resolveRpcCode } from './rpc-code';
import { bodySchema } from './schema';

export type {
  GoogleApiBadRequest,
  GoogleApiDebugInfo,
  GoogleApiDetail,
  GoogleApiErrorInfo,
  GoogleApiFieldViolation,
  GoogleApiHelp,
  GoogleApiHelpLink,
  GoogleApiRequestInfo,
  GoogleApiRetryInfo,
} from './details';
export type { GoogleRpcCode } from './rpc-code';

export interface GoogleApiOptions {
  /**
   * `ErrorInfo.domain`: "the logical grouping to which the reason belongs",
   * globally unique, typically the service name (`pubsub.googleapis.com`).
   * Required because AIP-193 requires `ErrorInfo` and a domain has no
   * derivable default.
   * @ref https://google.aip.dev/193#errorinfo
   */
  readonly domain: string;
  /**
   * `status` per catalog code, for entries whose HTTP status maps to the
   * wrong `google.rpc.Code` by default (a 409 that is `ALREADY_EXISTS`, not
   * `ABORTED`). A catalog code that is itself a `google.rpc.Code` name needs
   * no entry here.
   */
  readonly rpcCodes?: Readonly<Record<string, GoogleRpcCode>> | undefined;
  /** Base for the `Help` link; overrides the instance `docsBaseUrl`. */
  readonly helpLinkBaseUrl?: string | undefined;
  /** Key for the trace id inside `ErrorInfo.metadata`. Default `traceId`; `false` disables. */
  readonly traceIdMetadataKey?: string | false | undefined;
  /** Emit `RequestInfo.requestId` with the error id. Default true. */
  readonly includeRequestInfo?: boolean | undefined;
}

/** The `error` member: AIP-193's `Error.Status`, not `google.rpc.Status`. */
export interface GoogleApiStatus {
  /** The HTTP status code. */
  readonly code: number;
  readonly message: string;
  /** The `google.rpc.Code` name. */
  readonly status: GoogleRpcCode;
  readonly details: ReadonlyArray<GoogleApiDetail>;
}

export interface GoogleApiBody {
  readonly error: GoogleApiStatus;
}

/**
 * Google APIs answer errors as plain JSON; there is no dedicated media type.
 * @ref https://google.aip.dev/193#http11json-representation
 */
export const GOOGLE_API_CONTENT_TYPE = 'application/json';

/**
 * `metadata` keys written from `ctx.meta` that a `traceIdMetadataKey` of the
 * same name would silently replace: `location` carries the validation target
 * (SPEC 8.2).
 */
const RESERVED_METADATA_KEYS: ReadonlySet<string> = new Set(['location']);

interface Resolved {
  readonly domain: string;
  readonly rpcCodes: Readonly<Record<string, GoogleRpcCode>> | undefined;
  readonly helpLinkBaseUrl: string | undefined;
  readonly traceIdMetadataKey: string | false;
  readonly includeRequestInfo: boolean;
}

function errorInfo(
  error: BanError,
  ctx: RenderContext,
  options: Resolved,
): GoogleApiErrorInfo {
  const metadata = toMetadata(ctx.meta);
  if (options.traceIdMetadataKey !== false && ctx.traceId !== undefined) {
    metadata[options.traceIdMetadataKey] = ctx.traceId;
  }
  return {
    '@type': ERROR_INFO_TYPE,
    reason: error.code,
    domain: options.domain,
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

function helpUrl(
  error: BanError,
  ctx: RenderContext,
  options: Resolved,
): string | undefined {
  if (error.type !== undefined) {
    return error.type;
  }
  const base = options.helpLinkBaseUrl ?? ctx.docsBaseUrl;
  return base === undefined ? undefined : `${base}/${error.code}`;
}

/**
 * Detail order (SPEC 7.6.2): `ErrorInfo`, `BadRequest` (validation only),
 * `RetryInfo`, `RequestInfo`, `DebugInfo`, `Help`. Each type appears at most
 * once, as AIP-193 requires.
 */
function renderBody(
  error: BanError,
  ctx: RenderContext,
  options: Resolved,
  issues?: ReadonlyArray<ValidationIssue>,
): GoogleApiBody {
  const details: Array<GoogleApiDetail> = [errorInfo(error, ctx, options)];
  // proto3 JSON omits an empty repeated field and the schema requires
  // `fieldViolations`, so a validation error without issues has no
  // `BadRequest`; `message` still says validation failed.
  if (issues !== undefined && issues.length > 0) {
    details.push({
      '@type': BAD_REQUEST_TYPE,
      fieldViolations: issues.map((issue) => fieldViolation(issue)),
    });
  }
  const retry = retryInfo(error.headers);
  if (retry !== undefined) {
    details.push(retry);
  }
  if (options.includeRequestInfo) {
    details.push({ '@type': REQUEST_INFO_TYPE, requestId: error.id });
  }
  if (ctx.stack !== undefined) {
    details.push({
      '@type': DEBUG_INFO_TYPE,
      stackEntries: ctx.stack.split('\n'),
    });
  }
  const link = help(error.code, helpUrl(error, ctx, options));
  if (link !== undefined) {
    details.push(link);
  }
  return {
    error: {
      code: error.status,
      message:
        error.detail ??
        (issues === undefined ? error.title : VALIDATION_DETAIL),
      status: resolveRpcCode(error.code, error.status, options.rpcCodes),
      details,
    },
  };
}

/**
 * AIP-193 Google API errors (SPEC 7.6). Throws `TypeError` when
 * `traceIdMetadataKey` falls outside the `ErrorInfo.metadata` key grammar
 * or names a key the format writes from `ctx.meta`.
 * @ref https://google.aip.dev/193
 */
export function googleApi(
  options: GoogleApiOptions,
): ErrorFormat<GoogleApiBody> {
  const resolved: Resolved = {
    domain: options.domain,
    rpcCodes: options.rpcCodes,
    helpLinkBaseUrl: options.helpLinkBaseUrl,
    traceIdMetadataKey: options.traceIdMetadataKey ?? 'traceId',
    includeRequestInfo: options.includeRequestInfo ?? true,
  };
  if (resolved.traceIdMetadataKey !== false) {
    assertMemberName(
      'traceIdMetadataKey',
      resolved.traceIdMetadataKey,
      RESERVED_METADATA_KEYS,
      METADATA_KEY_PATTERN,
    );
  }
  const schemaOptions = {
    domain: resolved.domain,
    rpcCodes: resolved.rpcCodes,
    includeRequestInfo: resolved.includeRequestInfo,
  };
  return {
    name: 'google-api',
    contentType: GOOGLE_API_CONTENT_TYPE,
    render(error: BanError, ctx: RenderContext): GoogleApiBody {
      return renderBody(error, ctx, resolved);
    },
    renderValidation(
      error: BanError,
      issues: ReadonlyArray<ValidationIssue>,
      ctx: RenderContext,
    ): GoogleApiBody {
      return renderBody(error, ctx, resolved, issues);
    },
    schema(definition: ResolvedDefinition, ctx: SchemaContext): JsonSchema {
      return bodySchema(definition, ctx, schemaOptions, false);
    },
    validationSchema(
      definition: ResolvedDefinition,
      ctx: SchemaContext,
    ): JsonSchema {
      return bodySchema(definition, ctx, schemaOptions, true);
    },
  };
}
