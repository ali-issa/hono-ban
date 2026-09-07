import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { BUILTIN_CATALOG, SECONDARY_KEYS } from './catalog';

/** A catalog entry as written by the user (SPEC 2). */
export interface ErrorDefinition {
  readonly status: ContentfulStatusCode;
  /** Defaults to the IANA reason phrase for `status`. */
  readonly title?: string | undefined;
  /** Defaults to the catalog key. */
  readonly code?: string | undefined;
  /**
   * URI reference identifying the error type (RFC 9457 section 3.1.1, RFC
   * 3986 section 4.1); give an absolute URI so clients need no base to
   * resolve it. Not validated. When omitted, formats derive `${base}/${code}`
   * at render time from their own base URL option or the instance
   * `docsBaseUrl` (ADR 0010).
   * @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.1.1
   * @ref https://www.rfc-editor.org/rfc/rfc3986#section-4.1
   */
  readonly type?: string | undefined;
  /** OpenAPI response description. Defaults to `title`. */
  readonly description?: string | undefined;
}

/** A catalog entry after defaults are applied. Every field is present. */
export interface ResolvedDefinition {
  readonly key: string;
  readonly status: ContentfulStatusCode;
  readonly title: string;
  readonly code: string;
  /**
   * Only an explicitly declared type. `undefined` lets the format derive one
   * from `typeBaseUrl ?? docsBaseUrl`, else `about:blank` (Problem Details) or
   * no `links.type` (JSON:API).
   */
  readonly type: string | undefined;
  readonly description: string;
}

const PHRASES: ReadonlyMap<number, string> = new Map(
  Object.entries(BUILTIN_CATALOG)
    .filter(([key]) => !SECONDARY_KEYS.has(key))
    .map(([, definition]) => [definition.status, definition.title]),
);

/** IANA reason phrase for a status the built-in catalog knows about. */
export function reasonPhrase(status: number): string | undefined {
  return PHRASES.get(status);
}

/**
 * Primary definition per status (SPEC 3): the built-in entry named after the
 * status wins; a custom entry only claims a status no built-in covers.
 */
export function indexByStatus(
  catalog: Readonly<Record<string, ResolvedDefinition>>,
): Map<number, ResolvedDefinition> {
  const byStatus = new Map<number, ResolvedDefinition>();
  for (const [key, definition] of Object.entries(catalog)) {
    if (Object.hasOwn(BUILTIN_CATALOG, key) && !SECONDARY_KEYS.has(key)) {
      byStatus.set(definition.status, definition);
    }
  }
  for (const definition of Object.values(catalog)) {
    if (!byStatus.has(definition.status)) {
      byStatus.set(definition.status, definition);
    }
  }
  return byStatus;
}

export function resolveDefinition(
  key: string,
  definition: ErrorDefinition,
): ResolvedDefinition {
  const code = definition.code ?? key;
  const title = definition.title ?? reasonPhrase(definition.status) ?? 'Error';
  return {
    key,
    status: definition.status,
    title,
    code,
    type: definition.type,
    description: definition.description ?? title,
  };
}
