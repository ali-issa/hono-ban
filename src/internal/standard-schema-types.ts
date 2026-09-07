/**
 * Structural copies of the Standard Schema and Standard JSON Schema
 * interfaces. Vendored so the root declaration file never depends on
 * `@standard-schema/spec` being installed. Any object that satisfies the
 * published interfaces satisfies these.
 * @ref https://standardschema.dev
 * @ref https://standardschema.dev/json-schema
 * @packageDocumentation
 */

export interface StandardSchemaPathSegment {
  readonly key: PropertyKey;
}

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?:
    | ReadonlyArray<PropertyKey | StandardSchemaPathSegment>
    | undefined;
}

interface StandardSchemaTypes<TInput, TOutput> {
  readonly input: TInput;
  readonly output: TOutput;
}

export type StandardJsonSchemaTarget =
  | 'draft-2020-12'
  | 'draft-07'
  | 'openapi-3.0'
  | (string & Record<never, never>);

export interface StandardJsonSchemaOptions {
  readonly target: StandardJsonSchemaTarget;
  readonly libraryOptions?: Record<string, unknown> | undefined;
}

export interface StandardJsonSchemaConverter {
  readonly input: (
    options: StandardJsonSchemaOptions,
  ) => Record<string, unknown>;
  readonly output: (
    options: StandardJsonSchemaOptions,
  ) => Record<string, unknown>;
}

export interface StandardJsonSchemaProps<TInput, TOutput> {
  readonly version: 1;
  readonly vendor: string;
  readonly types?: StandardSchemaTypes<TInput, TOutput> | undefined;
  readonly jsonSchema: StandardJsonSchemaConverter;
}

export interface StandardJsonSchema<TInput = unknown, TOutput = TInput> {
  readonly '~standard': StandardJsonSchemaProps<TInput, TOutput>;
}

export type InferStandardOutput<TSchema extends StandardJsonSchema> =
  NonNullable<TSchema['~standard']['types']>['output'];
