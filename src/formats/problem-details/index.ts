/**
 * RFC 9457 Problem Details format (SPEC 7.1). The default format: `type`,
 * `status`, `title`, `detail`, `instance`, then the library members and the
 * flattened `meta` extension members (ADR 0008).
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-3
 * @packageDocumentation
 */
import type { BanError } from '../../core/ban-error';
import type { ResolvedDefinition } from '../../core/definition';
import type { ValidationIssue } from '../../validation/issue';
import type { JsonSchema, RenderContext, SchemaContext } from '../context';
import type { ErrorFormat } from '../types';
import type { ValidationEntry } from '../validation-entries';

import {
  EXTENSION_NAME_PATTERN,
  VALIDATION_DETAIL,
} from '../../internal/constants';
import { assertMemberName } from '../../internal/member-name';
import { flattenMeta } from '../extension-members';
import { constant } from '../schema-helpers';
import {
  readLocation,
  toValidationEntries,
  VALIDATION_ENTRIES_SCHEMA,
} from '../validation-entries';

export interface ProblemDetailsOptions {
  /** Base for `type` URIs; overrides the instance `docsBaseUrl`. */
  readonly typeBaseUrl?: string | undefined;
  /** Emit the catalog `code` extension member. Default true. */
  readonly includeCode?: boolean | undefined;
  /** Emit the error `id` extension member. Default true. */
  readonly includeId?: boolean | undefined;
  /** Name of the trace id extension member. Default `traceId`; `false` disables. */
  readonly traceIdMember?: string | false | undefined;
  /** Emit `instance` (the request path). Default true. */
  readonly instance?: boolean | undefined;
}

/**
 * An RFC 9457 problem details object. Extension members are top level
 * (ADR 0008), so the shape is open.
 */
export interface ProblemDetailsBody {
  readonly [member: string]: unknown;
  readonly type: string;
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly instance?: string;
}

export const PROBLEM_DETAILS_CONTENT_TYPE = 'application/problem+json';
const ABOUT_BLANK = 'about:blank';
const TRACE_ID_PATTERN = '^[0-9a-f]{32}$';
/**
 * Members `meta` may never fill in, whether or not this error emits them
 * (SPEC 7.1.2, ADR 0008): a `meta.detail` of 42 must not become the `detail`
 * of an error that has none, or the body stops matching its own schema.
 */
const RESERVED_MEMBERS: ReadonlySet<string> = new Set([
  'type',
  'status',
  'title',
  'detail',
  'instance',
  'code',
  'id',
  'traceId',
  'stack',
  'errors',
]);

interface Resolved {
  readonly typeBaseUrl: string | undefined;
  readonly includeCode: boolean;
  readonly includeId: boolean;
  readonly traceIdMember: string | false;
  readonly instance: boolean;
}

/**
 * `type` falls back to `about:blank`, in which case RFC 9457 says the title
 * should be the reason phrase; the built-in catalog satisfies this.
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-4.2.1
 */
function resolveType(
  error: BanError,
  ctx: RenderContext,
  options: Resolved,
): string {
  if (error.type !== undefined) {
    return error.type;
  }
  const base = options.typeBaseUrl ?? ctx.docsBaseUrl;
  return base === undefined ? ABOUT_BLANK : `${base}/${error.code}`;
}

/**
 * Member precedence (SPEC 7.1.1): standard members, then library members,
 * then `meta` extension members whose names are not reserved.
 */
function renderBase(
  error: BanError,
  ctx: RenderContext,
  options: Resolved,
  detail: string | undefined,
  errors?: ReadonlyArray<ValidationEntry>,
): ProblemDetailsBody {
  const body: Record<string, unknown> = {};
  if (detail !== undefined) {
    body['detail'] = detail;
  }
  if (options.instance && ctx.instance !== undefined) {
    body['instance'] = ctx.instance;
  }
  if (options.includeCode) {
    body['code'] = error.code;
  }
  if (options.includeId) {
    body['id'] = error.id;
  }
  if (options.traceIdMember !== false && ctx.traceId !== undefined) {
    body[options.traceIdMember] = ctx.traceId;
  }
  if (ctx.stack !== undefined) {
    body['stack'] = ctx.stack;
  }
  if (errors !== undefined) {
    body['errors'] = errors;
  }
  const standard = {
    type: resolveType(error, ctx, options),
    status: error.status,
    title: error.title,
  };
  const extensions = flattenMeta(ctx.meta);
  for (const key of Object.keys(extensions)) {
    if (!RESERVED_MEMBERS.has(key) && key !== options.traceIdMember) {
      body[key] = extensions[key];
    }
  }
  return { ...standard, ...body };
}

function baseSchema(
  definition: ResolvedDefinition,
  ctx: SchemaContext,
  options: Resolved,
  validation: boolean,
): JsonSchema {
  // `type` and `instance` are URI references (RFC 9457 sections 3.1.1 and
  // 3.1.5, RFC 3986 section 4.1), so relative values conform as well.
  // @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.1.1
  // @ref https://www.rfc-editor.org/rfc/rfc3986#section-4.1
  const properties: Record<string, JsonSchema> = {
    type: { type: 'string', format: 'uri-reference' },
    status: constant(definition.status, ctx.dialect),
    title: constant(definition.title, ctx.dialect),
    detail: { type: 'string' },
  };
  if (options.instance) {
    properties['instance'] = { type: 'string', format: 'uri-reference' };
  }
  if (options.includeCode) {
    properties['code'] = constant(definition.code, ctx.dialect);
  }
  if (options.includeId) {
    properties['id'] = { type: 'string' };
  }
  if (options.traceIdMember !== false) {
    properties[options.traceIdMember] = {
      type: 'string',
      pattern: TRACE_ID_PATTERN,
    };
  }
  if (validation) {
    properties['errors'] = VALIDATION_ENTRIES_SCHEMA;
  }
  return {
    type: 'object',
    required: validation
      ? ['type', 'status', 'title', 'errors']
      : ['type', 'status', 'title'],
    properties,
    additionalProperties: true,
  };
}

/**
 * RFC 9457 Problem Details, the default format. Throws `TypeError` when
 * `traceIdMember` names a reserved member (7.1.2) or falls outside the
 * extension member grammar (`EXTENSION_NAME_PATTERN`): `renderBase` writes
 * the trace id after the library members and before the standard ones win,
 * so `'status'` would replace the numeric status and `'id'` the error id.
 * @ref https://www.rfc-editor.org/rfc/rfc9457
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-4
 */
export function problemDetails(
  options: ProblemDetailsOptions = {},
): ErrorFormat<ProblemDetailsBody> {
  const resolved: Resolved = {
    typeBaseUrl: options.typeBaseUrl,
    includeCode: options.includeCode ?? true,
    includeId: options.includeId ?? true,
    traceIdMember: options.traceIdMember ?? 'traceId',
    instance: options.instance ?? true,
  };
  if (
    resolved.traceIdMember !== false &&
    resolved.traceIdMember !== 'traceId'
  ) {
    assertMemberName(
      'traceIdMember',
      resolved.traceIdMember,
      RESERVED_MEMBERS,
      EXTENSION_NAME_PATTERN,
    );
  }
  return {
    name: 'problem-details',
    contentType: PROBLEM_DETAILS_CONTENT_TYPE,
    render(error: BanError, ctx: RenderContext): ProblemDetailsBody {
      return renderBase(error, ctx, resolved, error.detail);
    },
    renderValidation(
      error: BanError,
      issues: ReadonlyArray<ValidationIssue>,
      ctx: RenderContext,
    ): ProblemDetailsBody {
      return renderBase(
        error,
        ctx,
        resolved,
        error.detail ?? VALIDATION_DETAIL,
        toValidationEntries(issues, readLocation(ctx.meta)),
      );
    },
    schema(definition: ResolvedDefinition, ctx: SchemaContext): JsonSchema {
      return baseSchema(definition, ctx, resolved, false);
    },
    validationSchema(
      definition: ResolvedDefinition,
      ctx: SchemaContext,
    ): JsonSchema {
      return baseSchema(definition, ctx, resolved, true);
    },
  };
}
