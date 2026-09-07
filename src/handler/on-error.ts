import type { Context, Env, ErrorHandler } from 'hono';

import type { BanError } from '../core/ban-error';
import type { BanCore } from '../core/internal';
import type {
  Ban,
  Catalog,
  ErrorMapper,
  ErrorReport,
  HandlerOptions,
} from '../core/types';
import type { RenderOptions } from '../formats/context';

import { BanError as BanErrorClass } from '../core/ban-error';
import {
  DEFAULT_CACHE_CONTROL,
  DEFAULT_ERROR_ID_HEADER,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_REQUEST_ID_HEADER,
  UNEXPECTED_DETAIL,
} from '../internal/constants';
import { safeStringify } from '../internal/json';
import { capBody } from './body-cap';
import { buildReport } from './report';
import { readRequestId } from './request-id';
import { resolveThrown } from './resolve';
import { parseTraceparent } from './traceparent';

const SERVER_ERROR = 500;
const SET_COOKIE = 'set-cookie';
const CACHE_CONTROL = 'cache-control';

interface Trace {
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;
}

function readTrace<E extends Env>(
  c: Context<E>,
  override: ((c: Context<E>) => string | undefined) | undefined,
): Trace {
  if (override !== undefined) {
    return { traceId: override(c), spanId: undefined };
  }
  const parsed = parseTraceparent(c.req.header('traceparent'));
  return { traceId: parsed?.traceId, spanId: parsed?.parentId };
}

/**
 * Header precedence (SPEC 6.9): `Cache-Control: no-store` as the floor, then
 * options, then the error's, then ours. `Set-Cookie` is the one header whose
 * values never combine: iteration yields each cookie separately, so `set()`
 * would keep only the last one. Cookies are appended instead, from both
 * sources.
 * @ref https://fetch.spec.whatwg.org/#concept-header-list-sort-and-combine
 * @ref https://fetch.spec.whatwg.org/#dom-headers-getsetcookie
 */
function mergeHeaders(
  base: HeadersInit | undefined,
  rendered: Headers,
  errorIdHeader: string | false,
  id: string,
): Headers {
  const headers = new Headers(base);
  if (!headers.has(CACHE_CONTROL)) {
    headers.set(CACHE_CONTROL, DEFAULT_CACHE_CONTROL);
  }
  rendered.forEach((value, name) => {
    if (name !== SET_COOKIE) {
      headers.set(name, value);
    }
  });
  for (const cookie of rendered.getSetCookie()) {
    headers.append(SET_COOKIE, cookie);
  }
  if (errorIdHeader !== false) {
    headers.set(errorIdHeader, id);
  }
  return headers;
}

/**
 * Calls `onReport` once and swallows anything it throws: a broken sink must
 * not turn a resolved 404 into a 500, and there is nothing left to report to.
 */
async function report<E extends Env>(
  onReport: HandlerOptions<E>['onReport'],
  input: ErrorReport,
  c: Context<E>,
): Promise<void> {
  if (onReport === undefined) {
    return;
  }
  try {
    await onReport(input, c);
  } catch {
    // Intentionally ignored; see the doc comment.
  }
}

/**
 * Last resort when rendering, mapping, or the format itself failed
 * (SPEC 6.4). Tries the format once more with a bare 500, then a hand-built
 * JSON body.
 */
async function fallback<E extends Env, TErrors extends Catalog>(
  failure: unknown,
  thrown: unknown,
  c: Context<E>,
  core: BanCore,
  options: HandlerOptions<E, TErrors>,
): Promise<Response> {
  let error: BanError;
  let response: Response;
  try {
    error = core.build(core.definition('INTERNAL_SERVER_ERROR'), {
      detail: UNEXPECTED_DETAIL,
      cause: thrown,
    });
    const rendered = core.render(error);
    response = new Response(safeStringify(rendered.body), {
      status: SERVER_ERROR,
      headers: mergeHeaders(
        options.headers,
        rendered.headers,
        options.errorIdHeader ?? DEFAULT_ERROR_ID_HEADER,
        error.id,
      ),
    });
  } catch {
    error = new BanErrorClass({
      status: SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      title: 'Internal Server Error',
      detail: UNEXPECTED_DETAIL,
      cause: thrown,
    });
    // The header merge still applies so the id reaches the header (SPEC 10.2).
    response = new Response(
      safeStringify({
        status: SERVER_ERROR,
        title: error.title,
        detail: error.detail,
        id: error.id,
      }),
      {
        status: SERVER_ERROR,
        headers: mergeHeaders(
          options.headers,
          new Headers({ 'Content-Type': 'application/json' }),
          options.errorIdHeader ?? DEFAULT_ERROR_ID_HEADER,
          error.id,
        ),
      },
    );
  }
  await report(
    options.onReport,
    buildReport({
      error,
      thrown,
      handled: false,
      handlerFailure: failure,
      requestId: undefined,
      traceId: undefined,
      spanId: undefined,
      method: c.req.method,
      path: c.req.path,
    }),
    c,
  );
  return response;
}

/**
 * Builds `ban.onError()` (SPEC 6). The returned handler resolves to a
 * `Response` for every input and never rejects (ADR 0002).
 */
export function createOnError<TErrors extends Catalog>(
  core: BanCore,
  ban: Ban<TErrors>,
  from: (value: unknown) => BanError,
  instanceMap: ErrorMapper<TErrors> | undefined,
): <E extends Env = Env>(
  options?: HandlerOptions<E, TErrors>,
) => ErrorHandler<E> {
  return <E extends Env = Env>(
    options: HandlerOptions<E, TErrors> = {},
  ): ErrorHandler<E> => {
    const map = options.map ?? instanceMap;
    const includeStack = options.includeStack ?? false;
    const requestIdHeader =
      options.requestIdHeader ?? DEFAULT_REQUEST_ID_HEADER;
    const errorIdHeader = options.errorIdHeader ?? DEFAULT_ERROR_ID_HEADER;
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

    return async (thrown: unknown, c: Context<E>): Promise<Response> => {
      try {
        const requestId =
          options.requestId === undefined
            ? readRequestId(
                requestIdHeader === false
                  ? undefined
                  : c.req.header(requestIdHeader),
              )
            : options.requestId(c);
        const trace = readTrace(c, options.traceId);
        const { error, handled } = resolveThrown(thrown, ban, from, map);
        const renderOptions: RenderOptions = {
          requestId,
          traceId: trace.traceId,
          instance: c.req.path,
          method: c.req.method,
          includeStack,
        };
        const rendered = core.render(error, renderOptions);
        const transform = (body: unknown): unknown =>
          options.transform === undefined
            ? body
            : options.transform(body, error, c);
        const text = capBody(
          transform(rendered.body),
          error,
          renderOptions,
          core.render,
          maxBodyBytes,
          transform,
        );
        const headers = mergeHeaders(
          options.headers,
          rendered.headers,
          errorIdHeader,
          error.id,
        );
        await report(
          options.onReport,
          buildReport({
            error,
            thrown,
            handled,
            handlerFailure: undefined,
            requestId,
            traceId: trace.traceId,
            spanId: trace.spanId,
            method: c.req.method,
            path: c.req.path,
          }),
          c,
        );
        return new Response(text, { status: error.status, headers });
      } catch (failure) {
        return fallback(failure, thrown, c, core, options);
      }
    };
  };
}
