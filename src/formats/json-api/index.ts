/**
 * JSON:API 1.1 error document format (SPEC 7.2): `{ errors: [ErrorObject] }`
 * with one error object per validation issue.
 * @ref https://jsonapi.org/format/#errors
 * @packageDocumentation
 */
import type { BanError } from '../../core/ban-error';
import type { ResolvedDefinition } from '../../core/definition';
import type { IssueLocation, ValidationIssue } from '../../validation/issue';
import type { JsonSchema, RenderContext, SchemaContext } from '../context';
import type { ErrorFormat } from '../types';

import {
  isPointerLocation,
  nameFromPath,
  pointerFromPath,
} from '../../validation/issue';
import { constant } from '../schema-helpers';
import { readLocation } from '../validation-entries';

export interface JsonApiOptions {
  /** Base for `links.type`; overrides the instance `docsBaseUrl`. */
  readonly typeLinkBaseUrl?: string | undefined;
  /** Produces `links.about`, a URL for this occurrence. */
  readonly aboutLink?:
    | ((error: BanError, ctx: RenderContext) => string | undefined)
    | undefined;
  /** Emit `id`. Default true. */
  readonly includeId?: boolean | undefined;
  /** Key for the trace id inside `meta`. Default `traceId`; `false` disables. */
  readonly traceIdMetaKey?: string | false | undefined;
}

export interface JsonApiLinks {
  readonly type?: string;
  readonly about?: string;
}

export interface JsonApiSource {
  readonly pointer?: string;
  readonly parameter?: string;
  readonly header?: string;
}

/**
 * A JSON:API 1.1 error object.
 * @ref https://jsonapi.org/format/#error-objects
 */
export interface JsonApiErrorObject {
  readonly id?: string;
  readonly links?: JsonApiLinks;
  /** The HTTP status as a string, as the specification requires. */
  readonly status: string;
  readonly code: string;
  readonly title: string;
  readonly detail?: string;
  readonly source?: JsonApiSource;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface JsonApiBody {
  readonly errors: ReadonlyArray<JsonApiErrorObject>;
}

/**
 * No parameters: the specification allows only `ext` and `profile`.
 * @ref https://jsonapi.org/format/#content-negotiation-servers
 */
export const JSON_API_CONTENT_TYPE = 'application/vnd.api+json';

interface Resolved {
  readonly typeLinkBaseUrl: string | undefined;
  readonly aboutLink:
    | ((error: BanError, ctx: RenderContext) => string | undefined)
    | undefined;
  readonly includeId: boolean;
  readonly traceIdMetaKey: string | false;
}

function links(
  error: BanError,
  ctx: RenderContext,
  options: Resolved,
): JsonApiLinks | undefined {
  const base = options.typeLinkBaseUrl ?? ctx.docsBaseUrl;
  const type =
    error.type ?? (base === undefined ? undefined : `${base}/${error.code}`);
  const about = options.aboutLink?.(error, ctx);
  if (type === undefined && about === undefined) {
    return undefined;
  }
  return {
    ...(type === undefined ? {} : { type }),
    ...(about === undefined ? {} : { about }),
  };
}

function sharedMeta(
  ctx: RenderContext,
  options: Resolved,
): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...ctx.meta };
  if (options.traceIdMetaKey !== false && ctx.traceId !== undefined) {
    meta[options.traceIdMetaKey] = ctx.traceId;
  }
  if (ctx.stack !== undefined) {
    meta['stack'] = ctx.stack;
  }
  return meta;
}

function errorObject(
  error: BanError,
  ctx: RenderContext,
  options: Resolved,
  detail: string | undefined,
  source: JsonApiSource | undefined,
  meta: Record<string, unknown>,
): JsonApiErrorObject {
  const linkMembers = links(error, ctx, options);
  return {
    ...(options.includeId ? { id: error.id } : {}),
    ...(linkMembers === undefined ? {} : { links: linkMembers }),
    status: String(error.status),
    code: error.code,
    title: error.title,
    ...(detail === undefined ? {} : { detail }),
    ...(source === undefined ? {} : { source }),
    ...(Object.keys(meta).length === 0 ? {} : { meta }),
  };
}

/**
 * `source.pointer` for bodies, `source.parameter` for query parameters,
 * `source.header` for headers. JSON:API has no member for path or cookie
 * parameters, so those are described in `meta` instead.
 * @ref https://jsonapi.org/format/#error-objects
 */
function issueSource(
  issue: ValidationIssue,
  location: IssueLocation,
): JsonApiSource | undefined {
  if (isPointerLocation(location)) {
    return { pointer: pointerFromPath(issue.path) };
  }
  if (location === 'query') {
    return { parameter: nameFromPath(issue.path) };
  }
  if (location === 'header') {
    return { header: nameFromPath(issue.path) };
  }
  return undefined;
}

function issueMeta(
  issue: ValidationIssue,
  location: IssueLocation,
  shared: Record<string, unknown>,
): Record<string, unknown> {
  const meta: Record<string, unknown> = { ...shared, location };
  if (location === 'param' || location === 'cookie') {
    meta['name'] = nameFromPath(issue.path);
  }
  if (issue.code !== undefined) {
    meta['code'] = issue.code;
  }
  if (issue.expected !== undefined) {
    meta['expected'] = issue.expected;
  }
  if (issue.received !== undefined) {
    meta['received'] = issue.received;
  }
  return meta;
}

function errorObjectSchema(
  definition: ResolvedDefinition,
  ctx: SchemaContext,
  options: Resolved,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {
    ...(options.includeId ? { id: { type: 'string' } } : {}),
    // Links are URI references (RFC 3986 section 4.1), the same class RFC
    // 9457 uses for `type`, so a relative `about` link conforms too.
    // @ref https://jsonapi.org/format/#document-links
    // @ref https://www.rfc-editor.org/rfc/rfc3986#section-4.1
    links: {
      type: 'object',
      properties: {
        type: { type: 'string', format: 'uri-reference' },
        about: { type: 'string', format: 'uri-reference' },
      },
      additionalProperties: false,
    },
    status: constant(String(definition.status), ctx.dialect),
    code: constant(definition.code, ctx.dialect),
    title: constant(definition.title, ctx.dialect),
    detail: { type: 'string' },
    source: {
      type: 'object',
      properties: {
        pointer: { type: 'string' },
        parameter: { type: 'string' },
        header: { type: 'string' },
      },
      additionalProperties: false,
    },
    meta: { type: 'object' },
  };
  return {
    type: 'object',
    required: ['status', 'code', 'title'],
    properties,
    additionalProperties: false,
  };
}

function bodySchema(
  definition: ResolvedDefinition,
  ctx: SchemaContext,
  options: Resolved,
): JsonSchema {
  return {
    type: 'object',
    required: ['errors'],
    properties: {
      errors: {
        type: 'array',
        minItems: 1,
        items: errorObjectSchema(definition, ctx, options),
      },
    },
    additionalProperties: false,
  };
}

/**
 * JSON:API 1.1 error documents (SPEC 7.2).
 * @ref https://jsonapi.org/format/#errors
 */
export function jsonApi(
  options: JsonApiOptions = {},
): ErrorFormat<JsonApiBody> {
  const resolved: Resolved = {
    typeLinkBaseUrl: options.typeLinkBaseUrl,
    aboutLink: options.aboutLink,
    includeId: options.includeId ?? true,
    traceIdMetaKey: options.traceIdMetaKey ?? 'traceId',
  };
  return {
    name: 'json-api',
    contentType: JSON_API_CONTENT_TYPE,
    render(error: BanError, ctx: RenderContext): JsonApiBody {
      return {
        errors: [
          errorObject(
            error,
            ctx,
            resolved,
            error.detail,
            undefined,
            sharedMeta(ctx, resolved),
          ),
        ],
      };
    },
    renderValidation(
      error: BanError,
      issues: ReadonlyArray<ValidationIssue>,
      ctx: RenderContext,
    ): JsonApiBody {
      const location = readLocation(ctx.meta);
      const shared = sharedMeta(ctx, resolved);
      return {
        errors: issues.map((issue) =>
          errorObject(
            error,
            ctx,
            resolved,
            issue.message,
            issueSource(issue, location),
            issueMeta(issue, location, shared),
          ),
        ),
      };
    },
    schema(definition: ResolvedDefinition, ctx: SchemaContext): JsonSchema {
      return bodySchema(definition, ctx, resolved);
    },
    validationSchema(
      definition: ResolvedDefinition,
      ctx: SchemaContext,
    ): JsonSchema {
      return bodySchema(definition, ctx, resolved);
    },
  };
}
