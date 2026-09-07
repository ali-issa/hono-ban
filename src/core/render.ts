import type { RenderContext, RenderOptions } from '../formats/context';
import type { ErrorFormat } from '../formats/types';
import type { BanError, RenderedError, Renderer } from './ban-error';

import { sanitizeMeta } from '../internal/sanitize-meta';

const SERVER_ERROR = 500;

/**
 * The one place a `BanError` becomes a body (SPEC 6.7). Shared by the handler
 * and `BanError.getResponse()` so both apply the same sanitization.
 */
export function createRenderer(
  format: ErrorFormat,
  docsBaseUrl: string | undefined,
): Renderer {
  return (error: BanError, options: RenderOptions = {}): RenderedError => {
    const includeStack = options.includeStack ?? false;
    const source = error.cause instanceof Error ? error.cause : error;
    const ctx: RenderContext = {
      requestId: options.requestId,
      traceId: options.traceId,
      instance: error.instance ?? options.instance,
      method: options.method,
      includeStack,
      docsBaseUrl: options.docsBaseUrl ?? docsBaseUrl,
      meta: sanitizeMeta(error.meta),
      stack:
        includeStack && error.status >= SERVER_ERROR ? source.stack : undefined,
      truncated: options.truncated ?? false,
    };
    const body =
      error.issues === undefined
        ? format.render(error, ctx)
        : format.renderValidation(error, error.issues, ctx);
    const headers = new Headers(error.headers);
    headers.set('Content-Type', format.contentType);
    return { status: error.status, headers, body };
  };
}
