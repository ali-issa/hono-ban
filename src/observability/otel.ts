/**
 * OpenTelemetry trace id adapter (SPEC 10.3). Typed structurally so
 * `@opentelemetry/api` is never imported; pass either the `trace` API or the
 * whole module namespace.
 * @ref https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_api.SpanContext.html
 * @ref https://open-telemetry.github.io/opentelemetry-js/interfaces/_opentelemetry_api.TraceAPI.html
 * @packageDocumentation
 */

export interface OtelSpanContextLike {
  readonly traceId: string;
  readonly spanId: string;
}

export interface OtelSpanLike {
  spanContext(): OtelSpanContextLike;
}

export interface OtelTraceLike {
  getActiveSpan(): OtelSpanLike | undefined;
}

export type OtelSource = OtelTraceLike | { readonly trace: OtelTraceLike };

const TRACE_ID = /^[0-9a-f]{32}$/u;
const ALL_ZERO = /^0+$/u;

function resolveTrace(source: OtelSource): OtelTraceLike {
  return 'getActiveSpan' in source ? source : source.trace;
}

/**
 * `ban.onError({ traceId: traceIdFromOtel(trace) })`. Returns the active
 * span's trace id when it is a valid, non-zero W3C trace id.
 */
export function traceIdFromOtel(source: OtelSource): () => string | undefined {
  const trace = resolveTrace(source);
  return (): string | undefined => {
    const span = trace.getActiveSpan();
    if (span === undefined) {
      return undefined;
    }
    const { traceId } = span.spanContext();
    return TRACE_ID.test(traceId) && !ALL_ZERO.test(traceId)
      ? traceId
      : undefined;
  };
}
