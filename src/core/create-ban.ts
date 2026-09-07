import type { ErrorFormat } from '../formats/types';
import type { BanError, BanErrorOptions } from './ban-error';
import type { ResolvedDefinition } from './definition';
import type { BanCore } from './internal';
import type {
  Ban,
  BanInstance,
  BanOptions,
  Catalog,
  CustomErrorInit,
  EmptyCatalog,
  NoReserved,
} from './types';

import { problemDetails } from '../formats/problem-details';
import { createOnError } from '../handler/on-error';
import { generateErrorId } from '../internal/id';
import { createValidation } from '../validation/validation-error';
import { BanError as BanErrorClass } from './ban-error';
import { BUILTIN_CATALOG, FACTORY_NAMES } from './catalog';
import { indexByStatus, reasonPhrase, resolveDefinition } from './definition';
import { createFactory } from './factories';
import { createFrom } from './from';
import { createRenderer } from './render';

const INSTANCE_KEYS = [
  'format',
  'catalog',
  'docsBaseUrl',
  'validationKey',
  'error',
  'custom',
  'validation',
  'from',
  'onError',
  'render',
] as const satisfies ReadonlyArray<keyof BanInstance<Catalog>>;

const RESERVED_KEYS: ReadonlySet<string> = new Set<string>([
  ...INSTANCE_KEYS,
  ...Object.keys(FACTORY_NAMES),
]);

function buildCatalog(custom: Catalog): {
  readonly catalog: Record<string, ResolvedDefinition>;
  readonly byStatus: Map<number, ResolvedDefinition>;
} {
  const catalog: Record<string, ResolvedDefinition> = {};
  for (const [key, definition] of Object.entries(BUILTIN_CATALOG)) {
    catalog[key] = resolveDefinition(key, definition);
  }
  for (const [key, definition] of Object.entries(custom)) {
    catalog[key] = resolveDefinition(key, definition);
  }
  return { catalog, byStatus: indexByStatus(catalog) };
}

/**
 * Creates an instance: built-in and custom factories, the handler, and the
 * helpers, all sharing one catalog and one format (SPEC 2, 5).
 */
export function createBan<const TErrors extends Catalog = EmptyCatalog>(
  options: BanOptions<TErrors> & {
    readonly errors?: NoReserved<TErrors> | undefined;
  } = {},
): Ban<TErrors> {
  const custom = (options.errors ?? {}) as Catalog;
  for (const key of Object.keys(custom)) {
    if (RESERVED_KEYS.has(key)) {
      throw new TypeError(
        `Catalog key "${key}" collides with a hono-ban instance member`,
      );
    }
  }
  const format: ErrorFormat = options.format ?? problemDetails();
  const docsBaseUrl = options.docsBaseUrl;
  const generateId = options.id ?? generateErrorId;
  const { catalog, byStatus } = buildCatalog(custom);
  const render = createRenderer(format, docsBaseUrl);

  const core: BanCore = {
    catalog,
    byStatus,
    format,
    docsBaseUrl,
    validationKey: options.validationKey ?? 'VALIDATION_FAILED',
    generateId,
    render,
    definition(key: string): ResolvedDefinition {
      const definition = catalog[key];
      if (definition === undefined) {
        throw new RangeError(`Unknown error key "${key}"`);
      }
      return definition;
    },
    build(definition, errorOptions: BanErrorOptions, issues): BanError {
      return new BanErrorClass({
        ...errorOptions,
        status: definition.status,
        code: definition.code,
        title: definition.title,
        type: errorOptions.type ?? definition.type,
        id: errorOptions.id ?? generateId(),
        definition,
        issues,
        render,
      });
    },
    custom(init: CustomErrorInit): BanError {
      return new BanErrorClass({
        ...init,
        code: init.code ?? 'CUSTOM',
        title: init.title ?? reasonPhrase(init.status) ?? 'Error',
        id: init.id ?? generateId(),
        render,
      });
    },
  };
  if (!Object.hasOwn(catalog, core.validationKey)) {
    throw new RangeError(
      `validationKey "${core.validationKey}" is not in the catalog`,
    );
  }

  const from = createFrom(core);
  const instance: Record<string, unknown> = {
    format,
    catalog,
    docsBaseUrl,
    validationKey: core.validationKey,
    error: (key: string, errorOptions: BanErrorOptions = {}): BanError =>
      core.build(core.definition(key), errorOptions),
    custom: (init: CustomErrorInit): BanError => core.custom(init),
    validation: createValidation(core),
    from,
    render,
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reason: the object is assembled from the catalog at runtime; create-ban.test-d.ts proves the shape
  const ban = instance as unknown as Ban<TErrors>;
  instance['onError'] = createOnError(core, ban, from, options.map);
  for (const [name, key] of Object.entries(FACTORY_NAMES)) {
    instance[name] = createFactory(core, key);
  }
  for (const key of Object.keys(custom)) {
    instance[key] = createFactory(core, key);
  }
  return ban;
}
