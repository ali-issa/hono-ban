/**
 * JSON Schema for the JSON:API error document (SPEC 7.2.3): a closed
 * `{ errors: [ErrorObject, ...] }` whose error objects pin `status`, `code`,
 * and `title` to the definition and are closed too.
 * @ref https://jsonapi.org/format/#error-objects
 * @packageDocumentation
 */
import type { ResolvedDefinition } from '../../core/definition';
import type { JsonSchema, SchemaContext } from '../context';

import { constant } from '../schema-helpers';

export interface JsonApiSchemaOptions {
  readonly includeId: boolean;
}

function errorObjectSchema(
  definition: ResolvedDefinition,
  ctx: SchemaContext,
  options: JsonApiSchemaOptions,
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

export function bodySchema(
  definition: ResolvedDefinition,
  ctx: SchemaContext,
  options: JsonApiSchemaOptions,
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
