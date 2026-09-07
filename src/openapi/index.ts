/**
 * OpenAPI response helpers (SPEC 9). The objects returned are plain OpenAPI
 * Response Objects whose schemas come from the instance's format, so they drop
 * straight into `@hono/zod-openapi` route configs (which accept raw schema
 * objects in `content`) or any other generator.
 * @ref https://spec.openapis.org/oas/v3.1.0#response-object
 * @ref https://github.com/asteasolutions/zod-to-openapi/blob/master/src/openapi-registry.ts
 * @packageDocumentation
 */
import type { ResolvedDefinition } from '../core/definition';
import type {
  JsonSchema,
  SchemaContext,
  SchemaDialect,
} from '../formats/context';
import type { ErrorFormat } from '../formats/types';

import { indexByStatus } from '../core/definition';

/** The part of a `Ban` instance the helpers read. */
export interface SchemaSource {
  readonly format: ErrorFormat;
  readonly catalog: Readonly<Record<string, ResolvedDefinition>>;
  readonly docsBaseUrl: string | undefined;
  readonly validationKey: string;
}

export interface OpenApiOptions {
  /** Default `draft-2020-12` (OpenAPI 3.1). Use `openapi-3.0` for 3.0 documents. */
  readonly dialect?: SchemaDialect | undefined;
  /** Overrides the definition's description. */
  readonly description?: string | undefined;
}

export interface MediaTypeObject {
  readonly schema: JsonSchema;
}

export interface ResponseObject {
  readonly description: string;
  readonly content: Readonly<Record<string, MediaTypeObject>>;
}

export type ErrorRef = string | number;

function resolve(ban: SchemaSource, ref: ErrorRef): ResolvedDefinition {
  const definition =
    typeof ref === 'number'
      ? indexByStatus(ban.catalog).get(ref)
      : ban.catalog[ref];
  if (definition === undefined) {
    throw new RangeError(
      `No catalog entry for ${typeof ref === 'number' ? 'status' : 'key'} "${ref}"`,
    );
  }
  return definition;
}

function context(ban: SchemaSource, options: OpenApiOptions): SchemaContext {
  return {
    docsBaseUrl: ban.docsBaseUrl,
    dialect: options.dialect ?? 'draft-2020-12',
  };
}

function response(
  ban: SchemaSource,
  description: string,
  schema: JsonSchema,
): ResponseObject {
  return {
    description,
    content: { [ban.format.contentType]: { schema } },
  };
}

/** JSON Schema for one catalog entry, by key or by status (primary entry). */
export function errorSchema(
  ban: SchemaSource,
  ref: ErrorRef,
  options: OpenApiOptions = {},
): JsonSchema {
  return ban.format.schema(resolve(ban, ref), context(ban, options));
}

export function errorResponse(
  ban: SchemaSource,
  ref: ErrorRef,
  options: OpenApiOptions = {},
): ResponseObject {
  const definition = resolve(ban, ref);
  return response(
    ban,
    options.description ?? definition.description,
    ban.format.schema(definition, context(ban, options)),
  );
}

/** Drops structurally identical schemas: a format may emit one shape for every entry. */
function uniqueSchemas(schemas: ReadonlyArray<JsonSchema>): Array<JsonSchema> {
  const seen = new Set<string>();
  return schemas.filter((schema) => {
    const key = JSON.stringify(schema);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Response Objects keyed by status. Entries sharing a status (for example
 * `BAD_REQUEST` and `MALFORMED_JSON`) merge into one `anyOf` response whose
 * description joins theirs with " or ". `anyOf`, not `oneOf`: a body has to
 * match at least one entry's schema, and a format whose schemas do not
 * discriminate by `code` would fail `oneOf` by matching several (ADR 0011).
 * @ref https://json-schema.org/draft/2020-12/json-schema-core#section-10.2.1.2
 */
export function errorResponses(
  ban: SchemaSource,
  refs: ReadonlyArray<ErrorRef>,
  options: OpenApiOptions = {},
): Record<string, ResponseObject> {
  const ctx = context(ban, options);
  const grouped = new Map<number, Array<ResolvedDefinition>>();
  for (const ref of refs) {
    const definition = resolve(ban, ref);
    const group = grouped.get(definition.status) ?? [];
    if (!group.some((existing) => existing.key === definition.key)) {
      group.push(definition);
    }
    grouped.set(definition.status, group);
  }
  const responses: Record<string, ResponseObject> = {};
  for (const [status, definitions] of grouped) {
    const schemas = uniqueSchemas(
      definitions.map((d) => ban.format.schema(d, ctx)),
    );
    const [first, ...rest] = schemas;
    if (first === undefined) {
      continue;
    }
    responses[String(status)] = response(
      ban,
      definitions.map((d) => d.description).join(' or '),
      rest.length === 0 ? first : { anyOf: schemas },
    );
  }
  return responses;
}

/** JSON Schema for `ban.validation()` bodies. */
export function validationSchema(
  ban: SchemaSource,
  options: OpenApiOptions = {},
): JsonSchema {
  return ban.format.validationSchema(
    resolve(ban, ban.validationKey),
    context(ban, options),
  );
}

export function validationResponse(
  ban: SchemaSource,
  options: OpenApiOptions = {},
): ResponseObject {
  const definition = resolve(ban, ban.validationKey);
  return response(
    ban,
    options.description ?? definition.description,
    validationSchema(ban, options),
  );
}
