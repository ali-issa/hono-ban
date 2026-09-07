import type { ErrorFormat } from '../formats/types';
import type { ValidationIssue } from '../validation/issue';
import type { BanError, BanErrorOptions, Renderer } from './ban-error';
import type { ResolvedDefinition } from './definition';
import type { CustomErrorInit } from './types';

/**
 * What every module needs from an instance without depending on the public
 * `Ban` object (which would create import cycles).
 */
export interface BanCore {
  readonly catalog: Readonly<Record<string, ResolvedDefinition>>;
  /** Primary definition per status (SPEC 3). */
  readonly byStatus: ReadonlyMap<number, ResolvedDefinition>;
  readonly format: ErrorFormat;
  readonly docsBaseUrl: string | undefined;
  readonly validationKey: string;
  readonly generateId: () => string;
  readonly render: Renderer;
  /** Throws `RangeError` for an unknown key. */
  definition(key: string): ResolvedDefinition;
  build(
    definition: ResolvedDefinition,
    options: BanErrorOptions,
    issues?: ReadonlyArray<ValidationIssue>,
  ): BanError;
  custom(init: CustomErrorInit): BanError;
}
