import type { Env } from 'hono';

import type { Ban, EmptyCatalog, ErrorReport, HandlerOptions } from 'hono-ban';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { jsonApi } from 'hono-ban/formats/json-api';
import { postgresMapper } from 'hono-ban/postgresql';

import { compileWithAjv } from './support/ajv';
import { startServer } from './support/server';

/**
 * `postgresMapper` over HTTP with hand-built errors in every driver spelling
 * the module documents (SPEC 6.10): node-postgres and Neon, postgres.js
 * with and without field V (PgBouncer), Bun with the SQLSTATE on `errno`,
 * plus the shapes that must not match. Also `retryAfter`, and an issue
 * mapping rendered by JSON:API with its `source.pointer`. Real server
 * errors are `postgresql-pglite.e2e.test.ts`.
 */

/** SPEC 13 `UNEXPECTED_DETAIL`. */
const UNEXPECTED_DETAIL = 'An unexpected error occurred';
const UNAVAILABLE_DETAIL = 'Temporarily unavailable, try again later';

function shaped(name: string, fields: Record<string, unknown>): Error {
  const error = new Error('server text: duplicate key value');
  error.name = name;
  return Object.assign(error, fields);
}

/** The thrown values by route. */
const THROWN: Readonly<Record<string, () => unknown>> = {
  pg: () =>
    shaped('error', {
      severity: 'ERROR',
      code: '23505',
      detail: 'Key (email)=(a@b.c) already exists.',
      constraint: 'users_email_key',
      table: 'users',
    }),
  neon: () =>
    shaped('NeonDbError', {
      severity: 'ERROR',
      code: '23505',
      constraint: 'users_email_key',
      sourceError: undefined,
    }),
  postgresjs: () =>
    shaped('PostgresError', {
      severity_local: 'ERROR',
      severity: 'ERROR',
      code: '23505',
      constraint_name: 'users_email_key',
      table_name: 'users',
    }),
  pgbouncer: () =>
    shaped('PostgresError', { severity_local: 'FATAL', code: '08P01' }),
  bun: () =>
    shaped('PostgresError', {
      code: 'ERR_POSTGRES_SERVER_ERROR',
      errno: '23505',
      severity: 'ERROR',
      constraint: 'users_email_key',
    }),
  'bun-syntax': () =>
    shaped('PostgresError', {
      code: 'ERR_POSTGRES_SYNTAX_ERROR',
      errno: '42601',
      severity: 'ERROR',
    }),
  sequelize: () =>
    shaped('SequelizeUniqueConstraintError', {
      original: shaped('error', {
        severity: 'ERROR',
        code: '23505',
        constraint: 'users_email_key',
      }),
    }),
  prisma: () =>
    shaped('PrismaClientKnownRequestError', {
      code: 'P2002',
      clientVersion: '7.10.0',
      meta: { driverAdapterError: { cause: { originalCode: '23505' } } },
    }),
  node: () => shaped('Error', { code: 'EPIPE', errno: -32, syscall: 'write' }),
  serialization: () => shaped('error', { severity: 'ERROR', code: '40001' }),
};

interface Harness {
  readonly fetch: RunningServer['fetch'];
  readonly reports: Array<ErrorReport>;
}

function harness(
  ban: Ban<EmptyCatalog>,
  options: HandlerOptions<Env, EmptyCatalog> = {},
): Harness {
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
  for (const [name, thrown] of Object.entries(THROWN)) {
    app.get(`/${name}`, () => {
      throw thrown();
    });
  }
  let server: RunningServer | undefined;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server?.close();
  });
  return {
    reports,
    fetch: async (path, init) => {
      if (server === undefined) {
        throw new Error('server not started');
      }
      return server.fetch(path, init);
    },
  };
}

describe('driver spellings', () => {
  const h = harness(
    createBan({
      map: postgresMapper({
        retryAfter: 2,
        constraints: { users_email_key: 'That email is already registered' },
      }),
    }),
  );

  it.each(['/pg', '/neon', '/postgresjs', '/bun', '/sequelize'])(
    '%s -> 409 with the constraint detail',
    async (path) => {
      const res = await h.fetch(path);
      const text = await res.text();
      expect(res.status).toBe(409);
      expect(JSON.parse(text)).toMatchObject({
        code: 'CONFLICT',
        detail: 'That email is already registered',
      });
      expect(text).not.toContain('a@b.c');
      expect(text).not.toContain('server text');
      expect(res.headers.get('retry-after')).toBeNull();
    },
  );

  it('maps a PgBouncer error carried by postgres.js to 503 with Retry-After', async () => {
    const res = await h.fetch('/pgbouncer');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('2');
    expect(await res.json()).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      detail: UNAVAILABLE_DETAIL,
    });
    const serialization = await h.fetch('/serialization');
    expect(serialization.status).toBe(503);
    expect(serialization.headers.get('retry-after')).toBe('2');
  });

  it("leaves Bun's syntax error and the non-Postgres shapes to the handler", async () => {
    for (const path of ['/bun-syntax', '/prisma', '/node']) {
      const res = await h.fetch(path);
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(500);
      expect(body['detail']).toBe(UNEXPECTED_DETAIL);
      expect(res.headers.get('retry-after')).toBeNull();
      const report = h.reports.find((entry) => entry.id === body['id']);
      expect(report?.handled).toBe(false);
    }
  });
});

describe('issue mapping rendered by JSON:API', () => {
  const ban = createBan({
    format: jsonApi(),
    map: postgresMapper({
      constraints: {
        users_email_key: {
          issue: {
            path: ['email'],
            message: 'That email is already registered',
            code: 'unique',
          },
        },
      },
    }),
  });
  const h = harness(ban);

  it('renders one error object with source.pointer and validates against the schema', async () => {
    const res = await h.fetch('/pg');
    const body: unknown = await res.json();
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toBe('application/vnd.api+json');
    expect(body).toMatchObject({
      errors: [
        {
          status: '422',
          code: 'VALIDATION_FAILED',
          detail: 'That email is already registered',
          source: { pointer: '/email' },
          meta: { location: 'body', code: 'unique' },
        },
      ],
    });
    const definition = ban.catalog['VALIDATION_FAILED'];
    const validate = compileWithAjv(
      ban.format.validationSchema(definition, {
        dialect: 'draft-2020-12',
        docsBaseUrl: undefined,
      }),
    );
    expect(validate(body)).toEqual([]);
  });
});
