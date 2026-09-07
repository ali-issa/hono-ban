/**
 * The Hono app every runtime smoke test drives (SPEC 14.2). It imports each
 * published subpath and throws one error per feature family, so a runtime
 * that lacks an API the package relies on fails here instead of in
 * production. Web standards only: the same module runs on Bun, Deno, and
 * workerd. Never import from `src/` here, and import no database driver:
 * the workerd bundle inlines every import of this file, so the Postgres
 * routes throw driver-shaped fixtures instead.
 */
import type { ErrorReport } from 'hono-ban';

import { sValidator } from '@hono/standard-validator';
import { vValidator } from '@hono/valibot-validator';
import { zValidator } from '@hono/zod-validator';
import { trace } from '@opentelemetry/api';
import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import * as v from 'valibot';
import { z } from 'zod';

import { bearerChallenge, createBan } from 'hono-ban';
import { googleApi } from 'hono-ban/formats/google-api';
import { jsonApi } from 'hono-ban/formats/json-api';
import { plain } from 'hono-ban/formats/plain';
import { problemDetails } from 'hono-ban/formats/problem-details';
import { stripe } from 'hono-ban/formats/stripe';
import { errorResponses, validationResponse } from 'hono-ban/openapi';
import { traceIdFromOtel } from 'hono-ban/otel';
import { postgresMapper } from 'hono-ban/postgresql';
import { hook as standardHook } from 'hono-ban/standard-schema';
import { renderError } from 'hono-ban/testing';
import { hook as valibotHook } from 'hono-ban/valibot';
import { hook as zodHook } from 'hono-ban/zod';

import { DOCS_BASE_URL } from './checks.ts';

// The default format, imported explicitly so its subpath is exercised too.
const ban = createBan({
  format: problemDetails(),
  docsBaseUrl: DOCS_BASE_URL,
  errors: { ORDER_CONFLICT: { status: 409, title: 'Order Conflict' } },
  map: postgresMapper({
    constraints: { orders_email_key: 'That email is already registered' },
  }),
});
const jsonApiBan = createBan({
  format: jsonApi(),
  docsBaseUrl: DOCS_BASE_URL,
});
const plainBan = createBan({ format: plain() });
const googleApiBan = createBan({
  format: googleApi({ domain: 'smoke.example.com' }),
  docsBaseUrl: DOCS_BASE_URL,
});
const stripeBan = createBan({ format: stripe(), docsBaseUrl: DOCS_BASE_URL });

/** Reports by error id, read back through `GET /reports/:id`. */
const reports = new Map<string, ErrorReport>();

const OrderInput = z.object({
  email: z.email(),
  quantity: z.number().int().positive(),
});
const OrderInputValibot = v.object({
  email: v.pipe(v.string(), v.email()),
  quantity: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export const app = new Hono();
app.onError(
  ban.onError({
    traceId: traceIdFromOtel(trace),
    onReport: (report) => {
      reports.set(report.id, report);
    },
  }),
);
// The runtime's own name, so the report says which one was exercised.
app.get('/runtime', (c) => c.text(navigator.userAgent));
app.get('/orders/missing', () => {
  throw ban.notFound('Order 42 does not exist');
});
app.get('/orders/conflict', () => {
  throw ban.ORDER_CONFLICT('Already shipped', {
    meta: { orderId: 42 },
    headers: { 'Retry-After': '30' },
  });
});
app.post('/orders', zValidator('json', OrderInput, zodHook(ban)), (c) =>
  c.json({ ok: true }),
);
app.post(
  '/orders/valibot',
  vValidator('json', OrderInputValibot, valibotHook(ban)),
  (c) => c.json({ ok: true }),
);
// Zod 4 schemas implement Standard Schema, so one schema serves both hooks.
app.post(
  '/orders/standard',
  sValidator('json', OrderInput, standardHook(ban)),
  (c) => c.json({ ok: true }),
);
app.use('/secure/*', bearerAuth({ token: 'secret' }));
app.get('/secure/orders', (c) => c.json({ ok: true }));
app.get('/scoped', () => {
  throw ban.forbidden('Token lacks orders:write', {
    headers: {
      'WWW-Authenticate': bearerChallenge({
        realm: 'api',
        scope: ['orders:write'],
        error: 'insufficient_scope',
      }),
    },
  });
});
app.get('/boom', () => {
  throw new Error('secret database string');
});
// A unique violation as node-postgres and PGlite throw it, then as Bun
// throws it (the SQLSTATE on `errno`).
app.get('/orders/duplicate', () => {
  throw Object.assign(
    new Error(
      'duplicate key value violates unique constraint "orders_email_key"',
    ),
    {
      name: 'error',
      severity: 'ERROR',
      code: '23505',
      detail: 'Key (email)=(a@b.c) already exists.',
      constraint: 'orders_email_key',
      table: 'orders',
    },
  );
});
app.get('/orders/duplicate-bun', () => {
  throw Object.assign(new Error('duplicate key value'), {
    name: 'PostgresError',
    code: 'ERR_POSTGRES_SERVER_ERROR',
    errno: '23505',
    severity: 'ERROR',
    constraint: 'orders_email_key',
  });
});
app.get('/reports/:id', (c) => {
  const report = reports.get(c.req.param('id'));
  return c.json(
    report === undefined
      ? { found: false }
      : { found: true, handled: report.handled, status: report.status },
  );
});
app.get('/openapi', (c) =>
  c.json({
    ...errorResponses(ban, [404, 'ORDER_CONFLICT']),
    422: validationResponse(ban),
  }),
);
app.get('/rendered', () => {
  // What a consumer's unit test does: render without a request.
  const rendered = renderError(ban, ban.gone('Removed'), {
    instance: '/rendered',
  });
  return new Response(JSON.stringify(rendered.body), {
    status: rendered.status,
    headers: rendered.headers,
  });
});

// Sub-apps keep their own onError when mounted (Hono wraps their handlers).
// @ref https://hono.dev/docs/api/hono#route
const jsonApiApp = new Hono();
jsonApiApp.onError(jsonApiBan.onError());
jsonApiApp.get('/missing', () => {
  throw jsonApiBan.notFound('Order 42 does not exist');
});
const plainApp = new Hono();
plainApp.onError(plainBan.onError());
plainApp.get('/missing', () => {
  throw plainBan.notFound();
});
const googleApiApp = new Hono();
googleApiApp.onError(googleApiBan.onError());
googleApiApp.get('/missing', () => {
  throw googleApiBan.notFound('Order 42 does not exist');
});
const stripeApp = new Hono();
stripeApp.onError(stripeBan.onError());
stripeApp.get('/missing', () => {
  throw stripeBan.notFound('Order 42 does not exist');
});
app.route('/json-api', jsonApiApp);
app.route('/plain', plainApp);
app.route('/google-api', googleApiApp);
app.route('/stripe', stripeApp);
