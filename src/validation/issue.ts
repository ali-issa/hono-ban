/**
 * Validator-agnostic issue shape and the pointer helpers formats use (SPEC 8).
 * @packageDocumentation
 */

export type IssueLocation =
  | 'body'
  | 'form'
  | 'query'
  | 'param'
  | 'header'
  | 'cookie';

export interface ValidationIssue {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
  readonly code?: string | undefined;
  readonly expected?: string | undefined;
  readonly received?: string | undefined;
}

/** Hono validator targets, in the order `@hono/zod-openapi` validates them. */
export type HookTarget =
  | 'json'
  | 'form'
  | 'query'
  | 'param'
  | 'header'
  | 'cookie';

const TARGET_LOCATIONS: Readonly<Record<HookTarget, IssueLocation>> = {
  json: 'body',
  form: 'form',
  query: 'query',
  param: 'param',
  header: 'header',
  cookie: 'cookie',
};

export function locationFromTarget(target: HookTarget): IssueLocation {
  return TARGET_LOCATIONS[target];
}

/**
 * Normalizes a validator path segment. Symbols are allowed by Standard Schema
 * and Zod 4; they become their description so a pointer is still produced.
 */
export function normalizeSegment(segment: PropertyKey): string | number {
  if (typeof segment === 'symbol') {
    return segment.description ?? 'symbol';
  }
  return segment;
}

/**
 * RFC 6901 JSON Pointer: `~` becomes `~0` before `/` becomes `~1`.
 * @ref https://www.rfc-editor.org/rfc/rfc6901#section-3
 */
export function pointerFromPath(path: ReadonlyArray<string | number>): string {
  if (path.length === 0) {
    return '';
  }
  return `/${path
    .map((segment) =>
      String(segment).replaceAll('~', '~0').replaceAll('/', '~1'),
    )
    .join('/')}`;
}

/** The first path segment as a string; parameters and headers are flat. */
export function nameFromPath(path: ReadonlyArray<string | number>): string {
  const first = path[0];
  return first === undefined ? '' : String(first);
}

/** Whether a location is addressed by JSON Pointer rather than by name. */
export function isPointerLocation(location: IssueLocation): boolean {
  return location === 'body' || location === 'form';
}
