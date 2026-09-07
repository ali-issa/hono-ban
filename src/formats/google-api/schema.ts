/**
 * JSON Schema for the AIP-193 body (SPEC 7.6.3). Every detail payload is a
 * closed object pinned to its `@type`; `details` is an array of the payloads
 * this format can render for the entry, at least one long because
 * `ErrorInfo` is always present. `contains` and `prefixItems` would state that
 * more precisely, but OpenAPI 3.0 has neither, so both dialects use `items`.
 * @ref https://google.aip.dev/193#http11json-representation
 * @ref https://spec.openapis.org/oas/v3.0.3#schema-object
 * @packageDocumentation
 */
import type { ResolvedDefinition } from '../../core/definition';
import type { JsonSchema, SchemaContext, SchemaDialect } from '../context';
import type { GoogleRpcCode } from './rpc-code';

import { constant } from '../schema-helpers';
import {
  BAD_REQUEST_TYPE,
  DEBUG_INFO_TYPE,
  ERROR_INFO_TYPE,
  HELP_TYPE,
  REQUEST_INFO_TYPE,
  RETRY_INFO_TYPE,
} from './details';
import { resolveRpcCode } from './rpc-code';

export interface GoogleApiSchemaOptions {
  readonly domain: string;
  readonly rpcCodes: Readonly<Record<string, GoogleRpcCode>> | undefined;
  readonly includeRequestInfo: boolean;
}

const STRING: JsonSchema = { type: 'string' };

function detail(
  typeUrl: string,
  dialect: SchemaDialect,
  properties: Record<string, JsonSchema>,
  required: ReadonlyArray<string>,
): JsonSchema {
  return {
    type: 'object',
    required: ['@type', ...required],
    properties: { '@type': constant(typeUrl, dialect), ...properties },
    additionalProperties: false,
  };
}

function errorInfo(
  definition: ResolvedDefinition,
  ctx: SchemaContext,
  options: GoogleApiSchemaOptions,
): JsonSchema {
  return detail(
    ERROR_INFO_TYPE,
    ctx.dialect,
    {
      reason: constant(definition.code, ctx.dialect),
      domain: constant(options.domain, ctx.dialect),
      metadata: { type: 'object', additionalProperties: STRING },
    },
    ['reason', 'domain'],
  );
}

function badRequest(dialect: SchemaDialect): JsonSchema {
  return detail(
    BAD_REQUEST_TYPE,
    dialect,
    {
      fieldViolations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['description'],
          properties: { field: STRING, description: STRING, reason: STRING },
          additionalProperties: false,
        },
      },
    },
    ['fieldViolations'],
  );
}

function retryInfo(dialect: SchemaDialect): JsonSchema {
  return detail(
    RETRY_INFO_TYPE,
    dialect,
    { retryDelay: { type: 'string', pattern: '^[0-9]+s$' } },
    ['retryDelay'],
  );
}

function requestInfo(dialect: SchemaDialect): JsonSchema {
  return detail(REQUEST_INFO_TYPE, dialect, { requestId: STRING }, [
    'requestId',
  ]);
}

function debugInfo(dialect: SchemaDialect): JsonSchema {
  return detail(
    DEBUG_INFO_TYPE,
    dialect,
    { stackEntries: { type: 'array', items: STRING } },
    ['stackEntries'],
  );
}

function helpDetail(dialect: SchemaDialect): JsonSchema {
  return detail(
    HELP_TYPE,
    dialect,
    {
      links: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['description', 'url'],
          properties: {
            description: STRING,
            url: { type: 'string', format: 'uri' },
          },
          additionalProperties: false,
        },
      },
    },
    ['links'],
  );
}

export function bodySchema(
  definition: ResolvedDefinition,
  ctx: SchemaContext,
  options: GoogleApiSchemaOptions,
  validation: boolean,
): JsonSchema {
  const payloads: Array<JsonSchema> = [errorInfo(definition, ctx, options)];
  if (validation) {
    payloads.push(badRequest(ctx.dialect));
  }
  payloads.push(retryInfo(ctx.dialect));
  if (options.includeRequestInfo) {
    payloads.push(requestInfo(ctx.dialect));
  }
  payloads.push(debugInfo(ctx.dialect), helpDetail(ctx.dialect));
  return {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message', 'status', 'details'],
        properties: {
          code: constant(definition.status, ctx.dialect),
          message: STRING,
          status: constant(
            resolveRpcCode(
              definition.code,
              definition.status,
              options.rpcCodes,
            ),
            ctx.dialect,
          ),
          details: { type: 'array', minItems: 1, items: { anyOf: payloads } },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  };
}
