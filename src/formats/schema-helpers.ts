import type { JsonSchema, SchemaDialect } from './context';

/** A single allowed value, spelled for the target dialect. */
export function constant(
  value: string | number,
  dialect: SchemaDialect,
): JsonSchema {
  return dialect === 'openapi-3.0' ? { enum: [value] } : { const: value };
}
