import type { Context, Env } from 'hono';

import type {
  Ban,
  EmptyCatalog,
  ErrorReport,
  HandlerOptions,
} from '../core/types';

import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createBan } from '../core/create-ban';

function build(
  ban: Ban<EmptyCatalog>,
  options: HandlerOptions<Env, EmptyCatalog> = {},
): { app: Hono; reports: Array<ErrorReport> } {
  const app = new Hono();
  const reports: Array<ErrorReport> = [];
  app.onError(
    ban.onError({
      ...options,
      onReport: (report) => {
        reports.push(report);
      },
    }),
  );
  app.get('/not-found', () => {
    throw ban.notFound('x');
  });
  return { app, reports };
}

const ban = createBan();

describe('ban.onError correlation ids', () => {
  it('echoes a validated request id into the report and never fabricates one', async () => {
    const { app, reports } = build(ban);
    await app.request('/not-found', { headers: { 'X-Request-Id': 'req-1' } });
    await app.request('/not-found', {
      headers: { 'X-Request-Id': 'bad value!' },
    });
    await app.request('/not-found');
    expect(reports.map((r) => r.context.requestId)).toEqual([
      'req-1',
      undefined,
      undefined,
    ]);
  });

  it('supports a custom request id header, disabling it, and an override', async () => {
    const { app: custom, reports: a } = build(ban, {
      requestIdHeader: 'X-Correlation-Id',
    });
    await custom.request('/not-found', {
      headers: { 'X-Correlation-Id': 'c1', 'X-Request-Id': 'r1' },
    });
    expect(a[0]?.context.requestId).toBe('c1');
    const { app: off, reports: b } = build(ban, { requestIdHeader: false });
    await off.request('/not-found', { headers: { 'X-Request-Id': 'r1' } });
    expect(b[0]?.context.requestId).toBeUndefined();
    const { app: override, reports: d } = build(ban, {
      requestId: (c: Context) => c.req.header('X-Other'),
    });
    await override.request('/not-found', {
      headers: { 'X-Other': 'anything goes' },
    });
    expect(d[0]?.context.requestId).toBe('anything goes');
  });

  it('reads W3C traceparent into the body and the report', async () => {
    const { app, reports } = build(ban);
    const trace = '4bf92f3577b34da6a3ce929d0e0e4736';
    const response = await app.request('/not-found', {
      headers: { traceparent: `00-${trace}-00f067aa0ba902b7-01` },
    });
    await expect(response.json()).resolves.toMatchObject({ traceId: trace });
    expect(reports[0]?.context.traceId).toBe(trace);
    expect(reports[0]?.context.spanId).toBe('00f067aa0ba902b7');
    const { app: bad, reports: badReports } = build(ban);
    await bad.request('/not-found', { headers: { traceparent: 'garbage' } });
    expect(badReports[0]?.context.traceId).toBeUndefined();
  });

  it('lets a traceId override replace traceparent parsing', async () => {
    const { app, reports } = build(ban, { traceId: () => 'custom-trace' });
    await app.request('/not-found', {
      headers: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
    });
    expect(reports[0]?.context.traceId).toBe('custom-trace');
    expect(reports[0]?.context.spanId).toBeUndefined();
  });
});
