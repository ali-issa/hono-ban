/**
 * Shared JSON Schema compiler for conformance tests. Not published.
 *
 * One Ajv instance is shared by every compile: constructing Ajv 2020 and
 * registering ajv-formats costs about 4 ms, while compiling one schema costs
 * a fraction of that, and a conformance run compiles two schemas per catalog
 * entry. The schemas carry no `$id`, so nothing collides on the shared
 * instance.
 * @ref https://ajv.js.org/json-schema.html#draft-2020-12
 * @ref https://ajv.js.org/guide/managing-schemas.html#compiling-during-initialization
 */
import type { JsonSchema } from '../formats/context';
import type { SchemaValidator } from '../testing';

import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

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
