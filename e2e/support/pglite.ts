import type { PGlite } from '@electric-sql/pglite';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import type { Env } from 'hono';

import type {
  EmptyCatalog,
  ErrorMapper,
  ErrorReport,
  HandlerOptions,
} from 'hono-ban';

import type { RunningServer } from './server';

import { PGlite as PGliteClient } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';
import { afterAll, beforeAll, expect } from 'vitest';

import { createBan } from 'hono-ban';

import { startServer } from './server';

/**
 * Shared harness for the `postgresql-*` files that run real server errors:
 * an in-memory PGlite (PostgreSQL in-process, throwing pg-protocol's
 * `DatabaseError`, the class node-postgres and Neon share), a Drizzle
 * instance over it (which wraps the driver error in `DrizzleQueryError` with
 * the driver error on `cause`), one failing statement per route, the
 * expected outcome per statement, and a leak check on every body. The
 * statements are plain strings so any client can run them: `harness()` uses
 * PGlite and Drizzle directly, `harnessWith()` takes an executor per route
 * prefix (the node-postgres and postgres.js files connect real drivers to
 * the same PGlite through `./pglite-socket`).
 * @ref https://pglite.dev/docs/api
 * @ref https://orm.drizzle.team/docs/connect-pglite
 */

/** SPEC 13 `UNEXPECTED_DETAIL`. */
export const UNEXPECTED_DETAIL = 'An unexpected error occurred';

/** Server text that must never appear in a response body. */
const SERVER_TEXT = [
  'a@b.c',
  'users_email_key',
  'children_parent_id_fkey',
  'strict_parent_id_fkey',
  'users_age_check',
  'Failing row',
  'duplicate key',
  'violates unique',
  'violates foreign key',
  'violates check',
  'violates not-null',
  'violates RESTRICT',
  'null value in column',
  'invalid input syntax',
  'relation "nope"',
  'custom text',
  'Failed query',
];

const SETUP = [
  'create table parents(id int primary key)',
  'create table children(id int primary key, parent_id int references parents(id))',
  'create table strict(id int primary key, parent_id int references parents(id) on delete restrict)',
  'create table users(id int primary key, email text not null unique, age int check (age >= 0))',
  'create sequence s start 2 maxvalue 2 no cycle',
  'insert into parents values (1)',
  'insert into children values (1, 1)',
  'insert into strict values (1, 1)',
  "insert into users values (1, 'a@b.c', 1)",
];

/** One failing statement per route; every route is a GET so a plain fetch drives it. */
const STATEMENTS: Readonly<Record<string, string>> = {
  duplicate: "insert into users values (2, 'a@b.c', 1)",
  'fk-missing': 'insert into children values (2, 99)',
  'fk-referenced': 'delete from parents where id = 1',
  'not-null': 'insert into users (id, age) values (3, 1)',
  check: "insert into users values (4, 'x@y.z', -1)",
  'invalid-uuid': "select 'abc'::uuid",
  'division-by-zero': 'select 1/0',
  sequence: "select nextval('s'), nextval('s')",
  'undefined-table': 'select * from nope',
  raise: "do $$ begin raise exception 'custom text'; end $$",
};

/**
 * Expected outcome per built-in table row (SPEC 6.10): route, status, code,
 * detail, SQLSTATE. `/fk-restrict` is the hand-written three-statement route.
 */
export const BUILTIN_ROWS: ReadonlyArray<
  [string, number, string, string, string]
> = [
  [
    '/duplicate',
    409,
    'CONFLICT',
    'A record with the same value already exists',
    '23505',
  ],
  [
    '/fk-missing',
    409,
    'CONFLICT',
    'A referenced record does not exist or is still in use',
    '23503',
  ],
  [
    '/fk-referenced',
    409,
    'CONFLICT',
    'A referenced record does not exist or is still in use',
    '23503',
  ],
  ['/fk-restrict', 409, 'CONFLICT', 'A record is still in use', '23001'],
  [
    '/not-null',
    422,
    'UNPROCESSABLE_CONTENT',
    'A required value is missing',
    '23502',
  ],
  [
    '/check',
    422,
    'UNPROCESSABLE_CONTENT',
    'A value violates a constraint',
    '23514',
  ],
  [
    '/invalid-uuid',
    422,
    'UNPROCESSABLE_CONTENT',
    'A value is invalid or out of range',
    '22P02',
  ],
];

/** Codes with no row: route and SQLSTATE; each falls through to the constant 500. */
export const FALLTHROUGH_ROWS: ReadonlyArray<[string, string]> = [
  ['/division-by-zero', '22012'],
  ['/sequence', '2200H'],
  ['/undefined-table', '42P01'],
  ['/raise', 'P0001'],
];

export interface Database {
  readonly db: PGlite;
  readonly orm: PgliteDatabase;
}

/** One database per test file, created and seeded in `beforeAll`. */
export function useDatabase(): Database {
  const db = new PGliteClient();
  const orm = drizzle({ client: db });
  beforeAll(async () => {
    for (const statement of SETUP) {
      await db.exec(statement);
    }
  });
  afterAll(async () => {
    await db.close();
  });
  return { db, orm };
}

export interface Harness {
  readonly fetch: RunningServer['fetch'];
  readonly reports: Array<ErrorReport>;
}

/** Runs one SQL statement through some client and rejects with that client's error. */
export type Execute = (statement: string) => Promise<unknown>;

/** PGlite directly under `/`, Drizzle under `/drizzle/`. */
export function harness(
  { db, orm }: Database,
  map: ErrorMapper<EmptyCatalog>,
  options: HandlerOptions<Env, EmptyCatalog> = {},
): Harness {
  return harnessWith(
    {
      '': async (statement) => db.exec(statement),
      drizzle: async (statement) => orm.execute(sql.raw(statement)),
    },
    map,
    options,
  );
}

/**
 * One app with every `STATEMENTS` route per executor, mounted under the
 * executor's prefix (`''` for the root), plus `/fk-restrict` per prefix.
 */
export function harnessWith(
  executors: Readonly<Record<string, Execute>>,
  map: ErrorMapper<EmptyCatalog>,
  options: HandlerOptions<Env, EmptyCatalog> = {},
): Harness {
  const reports: Array<ErrorReport> = [];
  const ban = createBan({ map });
  const app = new Hono();
  app.onError(
    ban.onError({
      ...options,
      onReport: (report) => {
        reports.push(report);
      },
    }),
  );
  for (const [prefix, execute] of Object.entries(executors)) {
    const base = prefix === '' ? '' : `/${prefix}`;
    for (const [name, statement] of Object.entries(STATEMENTS)) {
      app.get(`${base}/${name}`, async () => {
        await execute(statement);
        return new Response('unexpected success', { status: 200 });
      });
    }
    // The RESTRICT case needs the NO ACTION child row gone first.
    app.get(`${base}/fk-restrict`, async () => {
      await execute('delete from children where parent_id = 1');
      try {
        await execute('delete from parents where id = 1');
      } finally {
        await execute('insert into children values (1, 1)');
      }
      return new Response('unexpected success', { status: 200 });
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

export interface Outcome {
  readonly res: Response;
  readonly text: string;
  readonly body: Record<string, unknown>;
  readonly report: ErrorReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Fetches `path`, finds its report, and asserts the invariants every response shares. */
export async function call(
  { fetch, reports }: Harness,
  path: string,
): Promise<Outcome> {
  const res = await fetch(path);
  const text = await res.text();
  const body: unknown = JSON.parse(text);
  if (!isRecord(body)) {
    throw new Error(`no JSON body for ${path}`);
  }
  const report = reports.find((entry) => entry.id === body['id']);
  if (report === undefined) {
    throw new Error(`no report for ${path}`);
  }
  expect(res.headers.get('x-error-id')).toBe(body['id']);
  expect(res.headers.get('cache-control')).toBe('no-store');
  for (const secret of SERVER_TEXT) {
    expect(text).not.toContain(secret);
  }
  return { res, text, body, report };
}
