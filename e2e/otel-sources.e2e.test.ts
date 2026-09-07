/**
 * The `OtelSource` shapes `traceIdFromOtel` accepts (SPEC 10.3), exercised
 * over HTTP against the real Node SDK: the `{ trace }` object form feeding a
 * JSON:API `meta.traceId` (SPEC 7.2.1), the whole `@opentelemetry/api`
 * namespace, and a structural mock whose span context is invalid (all-zero,
 * uppercase, short) or absent, which the adapter must ignore. The report
 * (SPEC 10.1) is checked alongside each body. Correlation with a real span
 * against Problem Details lives in `otel-correlation.e2e.test.ts`.
 * @ref https://opentelemetry.io/docs/languages/js/instrumentation/
 * @ref https://www.w3.org/TR/trace-context/#trace-id
 */

import type { ReadableSpan } from '@opentelemetry/sdk-trace-node';
import type { MiddlewareHandler } from 'hono';

import type { ErrorReport } from 'hono-ban';
import type { OtelSource, OtelSpanContextLike } from 'hono-ban/otel';

import type { RunningServer } from './support/server';

import * as otelApi from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { jsonApi } from 'hono-ban/formats/json-api';
import { traceIdFromOtel } from 'hono-ban/otel';

import { startServer } from './support/server';

const { trace } = otelApi;

/**
 * One provider per file: the global tracer provider cannot be replaced and a
 * second `register()` only logs a warning. `register()` with no
 * `contextManager` installs `AsyncLocalStorageContextManager`, which carries
 * the active span from the middleware into `onError`.
 * @ref e2e/node_modules/@opentelemetry/sdk-trace-node/build/src/NodeTracerProvider.js (register -> setupContextManager)
 * @ref e2e/node_modules/@opentelemetry/sdk-trace-node/build/src/NodeTracerProvider.d.ts (constructor(config?: NodeTracerConfig))
 * @ref node_modules/.pnpm/@opentelemetry+sdk-trace@2.11.0_@opentelemetry+api@1.9.1/node_modules/@opentelemetry/sdk-trace/build/src/types.d.ts (TracerProviderOptions.spanProcessors)
 */
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();
const tracer = trace.getTracer('hono-ban-e2e');

afterAll(async () => {
  await provider.shutdown();
});

/** @ref https://www.w3.org/TR/trace-context/#trace-id */
const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/u;
/** @ref https://www.w3.org/TR/trace-context/#traceparent-header-field-values */
const HEADER_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const HEADER_PARENT_ID = '00f067aa0ba902b7';
const TRACEPARENT = `00-${HEADER_TRACE_ID}-${HEADER_PARENT_ID}-01`;
const NOT_FOUND = 404;
const DETAIL = 'Order 42 does not exist';

/**
 * Opens an active span for the request; Hono calls `onError` from the same
 * `dispatch` frame that threw, so the span is active while hono-ban renders.
 * @ref https://opentelemetry.io/docs/languages/js/instrumentation/#create-spans
 * @ref e2e/node_modules/hono/dist/compose.js (onError runs inside the throwing dispatch)
 */
const withSpan: MiddlewareHandler = async (c, next) => {
  await tracer.startActiveSpan(
    `${c.req.method} ${c.req.path}`,
    async (span) => {
      try {
        await next();
      } finally {
        span.end();
      }
    },
  );
};

const reports: Array<ErrorReport> = [];

function onReport(report: ErrorReport): void {
  reports.push(report);
}

beforeEach(() => {
  reports.length = 0;
  exporter.reset();
});

/**
 * The single span the last request finished. `SimpleSpanProcessor` exports
 * asynchronously; flushing first keeps the read deterministic.
 */
async function onlySpan(): Promise<ReadableSpan> {
  await provider.forceFlush();
  const spans = exporter.getFinishedSpans();
  expect(spans).toHaveLength(1);
  const [span] = spans;
  if (span === undefined) {
    throw new Error('expected exactly one exported span');
  }
  return span;
}

function onlyReport(): ErrorReport {
  expect(reports).toHaveLength(1);
  const [report] = reports;
  if (report === undefined) {
    throw new Error('expected exactly one report');
  }
  return report;
}

/** Starts `app` before the enclosing suite and closes it afterwards. */
function useServer(app: Hono): () => RunningServer {
  let running: RunningServer | undefined;
  beforeAll(async () => {
    running = await startServer(app);
  });
  afterAll(async () => {
    await running?.close();
  });
  return () => {
    if (running === undefined) {
      throw new Error('server not started');
    }
    return running;
  };
}

describe('traceIdFromOtel({ trace }) with JSON:API', () => {
  const ban = createBan({ format: jsonApi() });
  const app = new Hono();
  app.onError(ban.onError({ traceId: traceIdFromOtel({ trace }), onReport }));
  app.use('*', withSpan);
  app.get('/boom', () => {
    throw ban.notFound(DETAIL);
  });
  const server = useServer(app);

  it('carries the span trace id in errors[0].meta.traceId (SPEC 7.2.1)', async () => {
    const res = await server().fetch('/boom');
    expect(res.status).toBe(NOT_FOUND);
    // @ref https://jsonapi.org/format/#content-negotiation-servers
    expect(res.headers.get('content-type')).toBe('application/vnd.api+json');
    const body = await res.json();
    const { traceId } = (await onlySpan()).spanContext();
    expect(traceId).toMatch(TRACE_ID_PATTERN);
    // @ref https://jsonapi.org/format/#error-objects (meta holds non-standard members)
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].status).toBe('404');
    expect(body.errors[0].meta.traceId).toBe(traceId);
    const report = onlyReport();
    expect(report.context.traceId).toBe(traceId);
    // SPEC 10.2: the same id in body, header and report.
    expect(body.errors[0].id).toBe(report.id);
    expect(res.headers.get('x-error-id')).toBe(report.id);
  });
});

describe('structural OtelSource (SPEC 10.3)', () => {
  let current: OtelSpanContextLike | undefined;
  const source: OtelSource = {
    getActiveSpan: () => {
      const spanContext = current;
      return spanContext === undefined
        ? undefined
        : { spanContext: () => spanContext };
    },
  };
  const ban = createBan();
  const app = new Hono();
  app.onError(ban.onError({ traceId: traceIdFromOtel(source), onReport }));
  app.get('/boom', () => {
    throw ban.notFound(DETAIL);
  });
  const server = useServer(app);

  // @ref e2e/node_modules/@opentelemetry/api/build/src/trace/invalid-span-constants.d.ts (INVALID_TRACEID, INVALID_SPANID)
  const INVALID_TRACE_ID = '0'.repeat(32);
  const INVALID_SPAN_ID = '0'.repeat(16);
  const cases: Array<{
    name: string;
    spanContext: OtelSpanContextLike | undefined;
    expected: string | undefined;
  }> = [
    {
      name: 'a valid span context is used',
      spanContext: { traceId: HEADER_TRACE_ID, spanId: HEADER_PARENT_ID },
      expected: HEADER_TRACE_ID,
    },
    {
      name: 'no active span yields nothing',
      spanContext: undefined,
      expected: undefined,
    },
    {
      name: 'the all-zero invalid span context is ignored',
      spanContext: { traceId: INVALID_TRACE_ID, spanId: INVALID_SPAN_ID },
      expected: undefined,
    },
    {
      name: 'an uppercase trace id is ignored',
      spanContext: {
        traceId: HEADER_TRACE_ID.toUpperCase(),
        spanId: HEADER_PARENT_ID,
      },
      expected: undefined,
    },
    {
      name: 'a short trace id is ignored',
      spanContext: {
        traceId: HEADER_TRACE_ID.slice(0, 16),
        spanId: HEADER_PARENT_ID,
      },
      expected: undefined,
    },
  ];

  // A traceparent rides along on every request: with the option set it must
  // never leak into the body, whatever the mock returns (SPEC 6.2).
  it.each(cases)('$name', async ({ spanContext, expected }) => {
    current = spanContext;
    const res = await server().fetch('/boom', {
      headers: { traceparent: TRACEPARENT },
    });
    expect(res.status).toBe(NOT_FOUND);
    const body = await res.json();
    if (expected === undefined) {
      expect(body).not.toHaveProperty('traceId');
    } else {
      expect(body.traceId).toBe(expected);
    }
    const report = onlyReport();
    expect(report.context.traceId).toBe(expected);
    expect(report.context.spanId).toBeUndefined();
  });

  it('accepts the whole @opentelemetry/api namespace as well as the trace API', () => {
    const fromNamespace = traceIdFromOtel(otelApi);
    const fromTrace = traceIdFromOtel(trace);
    expect(fromNamespace()).toBeUndefined();
    expect(fromTrace()).toBeUndefined();
    const seen = tracer.startActiveSpan('probe', (span) => {
      try {
        return {
          traceId: span.spanContext().traceId,
          fromNamespace: fromNamespace(),
          fromTrace: fromTrace(),
        };
      } finally {
        span.end();
      }
    });
    expect(seen.traceId).toMatch(TRACE_ID_PATTERN);
    expect(seen.fromNamespace).toBe(seen.traceId);
    expect(seen.fromTrace).toBe(seen.traceId);
  });
});
