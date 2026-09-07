/**
 * OpenTelemetry trace correlation against the real Node SDK, over HTTP.
 * Covers SPEC 10.3 (`traceIdFromOtel(trace)`), 10.2 (the same id in body,
 * header and report), 6.2 (the `traceId` option replaces `traceparent`
 * parsing and carries no span id) and 6.6 (the exported parser as a composed
 * fallback). Middleware opens an active span per request the way an HTTP
 * instrumentation would; the body and report trace ids must equal the trace
 * id of the span the `InMemorySpanExporter` received. The sibling file
 * `otel-sources.e2e.test.ts` covers the other `OtelSource` shapes and
 * JSON:API.
 * @ref https://opentelemetry.io/docs/languages/js/instrumentation/
 * @ref https://www.w3.org/TR/trace-context/#trace-id
 */

import type { ReadableSpan } from '@opentelemetry/sdk-trace-node';
import type { MiddlewareHandler } from 'hono';

import type { ErrorReport } from 'hono-ban';

import type { RunningServer } from './support/server';

import { trace } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createBan, parseTraceparent } from 'hono-ban';
import { traceIdFromOtel } from 'hono-ban/otel';

import { startServer } from './support/server';

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
 * Opens an active span for the request. `startActiveSpan` runs `next()`
 * inside `context.with(...)`, and Hono calls `onError` from the same
 * `dispatch` frame that threw, so the span is still active while hono-ban
 * resolves the error. The incoming `traceparent` is deliberately not
 * extracted: the span starts a fresh trace so the tests can tell the option
 * apart from the header.
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

describe('traceIdFromOtel(trace) with Problem Details', () => {
  const ban = createBan();
  const app = new Hono();
  app.onError(ban.onError({ traceId: traceIdFromOtel(trace), onReport }));
  app.use('/traced/*', withSpan);
  app.get('/traced/boom', () => {
    throw ban.notFound(DETAIL);
  });
  app.get('/untraced/boom', () => {
    throw ban.notFound(DETAIL);
  });
  const server = useServer(app);

  it('body and report carry the exported span trace id (SPEC 10.3, 10.2)', async () => {
    const res = await server().fetch('/traced/boom');
    expect(res.status).toBe(NOT_FOUND);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = await res.json();
    const span = await onlySpan();
    const { traceId } = span.spanContext();
    expect(span.name).toBe('GET /traced/boom');
    // @ref https://www.w3.org/TR/trace-context/#trace-id (16 bytes as 32 lowercase hex characters)
    expect(traceId).toMatch(TRACE_ID_PATTERN);
    // @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.2 (traceId is an extension member)
    expect(body.traceId).toBe(traceId);
    const report = onlyReport();
    expect(report.context.traceId).toBe(traceId);
    // SPEC 6.2: the option yields `{ traceId }` only; spanId comes from traceparent parsing, which the option replaces.
    expect(report.context.spanId).toBeUndefined();
    // SPEC 10.2: the same id in body, header and report.
    expect(body.id).toBe(report.id);
    expect(res.headers.get('x-error-id')).toBe(report.id);
  });

  it('wins over a traceparent header with a different trace id (SPEC 6.2)', async () => {
    const res = await server().fetch('/traced/boom', {
      headers: { traceparent: TRACEPARENT },
    });
    const body = await res.json();
    const { traceId } = (await onlySpan()).spanContext();
    expect(traceId).not.toBe(HEADER_TRACE_ID);
    expect(body.traceId).toBe(traceId);
    const report = onlyReport();
    expect(report.context.traceId).toBe(traceId);
    // SPEC 6.2: with the option set the header is never parsed, so its parent id does not become spanId.
    expect(report.context.spanId).toBeUndefined();
  });

  it('yields nothing without an active span, even when traceparent is present (SPEC 6.2)', async () => {
    const res = await server().fetch('/untraced/boom', {
      headers: { traceparent: TRACEPARENT },
    });
    expect(res.status).toBe(NOT_FOUND);
    const body = await res.json();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    expect(body).not.toHaveProperty('traceId');
    const report = onlyReport();
    expect(report.context.traceId).toBeUndefined();
    expect(report.context.spanId).toBeUndefined();
  });
});

describe('composing traceIdFromOtel with parseTraceparent (SPEC 6.6)', () => {
  const fromOtel = traceIdFromOtel(trace);
  const ban = createBan();
  const app = new Hono();
  app.onError(
    ban.onError({
      // The option replaces header parsing (SPEC 6.2); a consumer who wants
      // the header as a fallback composes it with the exported parser.
      traceId: (c) =>
        fromOtel() ?? parseTraceparent(c.req.header('traceparent'))?.traceId,
      onReport,
    }),
  );
  app.use('/traced/*', withSpan);
  app.get('/traced/boom', () => {
    throw ban.notFound(DETAIL);
  });
  app.get('/untraced/boom', () => {
    throw ban.notFound(DETAIL);
  });
  const server = useServer(app);

  it('falls back to the traceparent trace id when no span is active', async () => {
    const res = await server().fetch('/untraced/boom', {
      headers: { traceparent: TRACEPARENT },
    });
    const body = await res.json();
    // @ref https://www.w3.org/TR/trace-context/#traceparent-header-field-values
    expect(body.traceId).toBe(HEADER_TRACE_ID);
    const report = onlyReport();
    expect(report.context.traceId).toBe(HEADER_TRACE_ID);
    // Still the option form: SPEC 6.2 gives it no way to supply a spanId.
    expect(report.context.spanId).toBeUndefined();
  });

  it('prefers the active span over the header', async () => {
    const res = await server().fetch('/traced/boom', {
      headers: { traceparent: TRACEPARENT },
    });
    const body = await res.json();
    const { traceId } = (await onlySpan()).spanContext();
    expect(traceId).not.toBe(HEADER_TRACE_ID);
    expect(body.traceId).toBe(traceId);
    expect(onlyReport().context.traceId).toBe(traceId);
  });
});
