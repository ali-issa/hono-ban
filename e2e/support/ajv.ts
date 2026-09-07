import type { JsonSchema } from 'hono-ban';
import type { SchemaValidator } from 'hono-ban/testing';

import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

/**
 * JSON Schema 2020-12 compiler for the e2e suite. Formats emit closed
 * schemas in that dialect, so `strict` mode catches unknown keywords. One
 * instance is shared by every compile: constructing Ajv and registering the
 * formats dominates the cost of compiling a schema, and the schemas carry no
 * `$id`, so nothing collides.
 * @ref https://ajv.js.org/json-schema.html#draft-2020-12
 * @ref https://ajv.js.org/guide/managing-schemas.html#compiling-during-initialization
 */
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

export function compileWithAjv(schema: JsonSchema): SchemaValidator {
  const validate = ajv.compile(schema);
  return (body: unknown): ReadonlyArray<string> =>
    validate(body)
      ? []
      : (validate.errors ?? []).map(
          (error) =>
            `${error.instancePath === '' ? '/' : error.instancePath} ${error.message ?? ''}`,
        );
}

/**
 * Asserts `body` against `schema`; the returned list is empty when valid.
 * Kept separate from `compileWithAjv` so tests read as one call.
 */
export function schemaErrors(
  schema: JsonSchema,
  body: unknown,
): ReadonlyArray<string> {
  return compileWithAjv(schema)(body);
}
