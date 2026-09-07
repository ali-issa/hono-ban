import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { RenderOptions } from '../formats/context';
import type { ValidationIssue } from '../validation/issue';
import type { ResolvedDefinition } from './definition';

import { HTTPException } from 'hono/http-exception';

import { generateErrorId } from '../internal/id';
import { safeStringify } from '../internal/json';

/**
 * Per-error options accepted by every factory (SPEC 2). `status`, `code`, and
 * `title` are absent on purpose: the catalog fixes them and the generated
 * schemas pin them with `const`, so a per-call value would make the response
 * contradict its own schema (ADR 0011). `ban.custom()` takes them through
 * `CustomErrorInit` because it has no schema.
 */
export interface BanErrorOptions {
  readonly detail?: string | undefined;
  /** RFC 9457 `type`: a URI reference (section 3.1.1). Not validated. */
  readonly type?: string | undefined;
  /**
   * RFC 9457 `instance`: a URI reference (section 3.1.5). Defaults to the
   * request path at render time.
   */
  readonly instance?: string | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
  readonly headers?: HeadersInit | undefined;
  readonly cause?: unknown;
  readonly id?: string | undefined;
}

export interface RenderedError {
  readonly status: ContentfulStatusCode;
  /** Includes `Content-Type` for the format that rendered `body`. */
  readonly headers: Headers;
  readonly body: unknown;
}

export type Renderer = (
  error: BanError,
  options?: RenderOptions,
) => RenderedError;

export interface BanErrorInit extends BanErrorOptions {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly title: string;
  readonly definition?: ResolvedDefinition | undefined;
  readonly issues?: ReadonlyArray<ValidationIssue> | undefined;
  /** Injected by factories so `getResponse()` renders in the instance's format. */
  readonly render?: Renderer | undefined;
}

/**
 * The single error class. Extends Hono's `HTTPException` so `app.onError` and
 * every Hono middleware treat it as an HTTP error, while carrying the fields
 * the formats render (SPEC 4).
 * @ref https://hono.dev/docs/api/exception
 */
export class BanError extends HTTPException {
  override readonly name: string = 'BanError';
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly type: string | undefined;
  readonly instance: string | undefined;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly headers: Headers;
  readonly definition: ResolvedDefinition | undefined;
  readonly issues: ReadonlyArray<ValidationIssue> | undefined;
  readonly #render: Renderer | undefined;

  constructor(init: BanErrorInit) {
    super(init.status, {
      message: init.detail ?? init.title,
      cause: init.cause,
    });
    this.id = init.id ?? generateErrorId();
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    this.type = init.type;
    this.instance = init.instance;
    this.meta = init.meta ?? {};
    this.headers = new Headers(init.headers);
    this.definition = init.definition;
    this.issues = init.issues;
    this.#render = init.render;
  }

  /** The fields needed to rebuild an equivalent error (used by the body cap). */
  toInit(): BanErrorInit {
    return {
      status: this.status,
      code: this.code,
      title: this.title,
      detail: this.detail,
      type: this.type,
      instance: this.instance,
      meta: this.meta,
      headers: this.headers,
      cause: this.cause,
      id: this.id,
      definition: this.definition,
      issues: this.issues,
      render: this.#render,
    };
  }

  override getResponse(): Response {
    if (this.#render === undefined) {
      const headers = new Headers(this.headers);
      headers.set('Content-Type', 'application/json');
      return new Response(
        safeStringify({
          status: this.status,
          code: this.code,
          title: this.title,
          detail: this.detail,
          id: this.id,
        }),
        { status: this.status, headers },
      );
    }
    const rendered = this.#render(this);
    return new Response(safeStringify(rendered.body), {
      status: rendered.status,
      headers: rendered.headers,
    });
  }
}

export function isBanError(value: unknown): value is BanError {
  return value instanceof BanError;
}
