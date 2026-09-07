import type { Env } from 'hono';

import type { Ban, Catalog, ErrorReport, HandlerOptions } from '../core/types';

import { Hono } from 'hono';

export interface Outcome {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
  readonly text: string;
  readonly report: ErrorReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Throws `thrown` from one route of a fresh app and returns what came back. */
export async function dispatch<TErrors extends Catalog>(
  ban: Ban<TErrors>,
  thrown: unknown,
  options: HandlerOptions<Env, TErrors> = {},
): Promise<Outcome> {
  const reports: Array<ErrorReport> = [];
  const app = new Hono();
  app.onError(
    ban.onError({
      ...options,
      onReport: (report) => {
        reports.push(report);
      },
    }),
  );
  app.get('/', () => {
    throw thrown;
  });
  const res = await app.request('/');
  const text = await res.text();
  const body: unknown = JSON.parse(text);
  if (!isRecord(body) || reports[0] === undefined) {
    throw new Error('unexpected response');
  }
  return {
    status: res.status,
    headers: res.headers,
    body,
    text,
    report: reports[0],
  };
}
