import type { BanError } from '../core/ban-error';
import type { ResolvedDefinition } from '../core/definition';
import type { ValidationIssue } from '../validation/issue';
import type { JsonSchema, RenderContext, SchemaContext } from './context';

/**
 * A wire format owns both rendering and the JSON Schema that describes what
 * it renders (ADR 0003). Formats are pure: same inputs, same body.
 */
export interface ErrorFormat<TBody = unknown> {
  readonly name: string;
  readonly contentType: string;
  render(error: BanError, ctx: RenderContext): TBody;
  renderValidation(
    error: BanError,
    issues: ReadonlyArray<ValidationIssue>,
    ctx: RenderContext,
  ): TBody;
  schema(definition: ResolvedDefinition, ctx: SchemaContext): JsonSchema;
  validationSchema(
    definition: ResolvedDefinition,
    ctx: SchemaContext,
  ): JsonSchema;
}
