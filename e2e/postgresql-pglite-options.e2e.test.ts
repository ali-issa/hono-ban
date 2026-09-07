import { describe, expect, it } from 'vitest';

import { postgresMapper } from 'hono-ban/postgresql';

import { call, harness, useDatabase } from './support/pglite';

/**
 * `postgresMapper` options against real server errors (SPEC 6.10):
 * `constraints` and `columns` as details and as issue mappings, a `codes`
 * override, and `includeStack` on a mapped 5xx rendering the driver stack
 * rather than the ORM wrapper's. The built-in table is
 * `postgresql-pglite.e2e.test.ts`.
 */

const database = useDatabase();

describe('constraints, columns, and codes', () => {
  const h = harness(
    database,
    postgresMapper({
      constraints: {
        users_email_key: {
          issue: {
            path: ['email'],
            message: 'That email is already registered',
          },
        },
        children_parent_id_fkey:
          'The parent does not exist or still has children',
      },
      columns: {
        'users.email': {
          issue: { path: ['email'], message: 'Email is required' },
        },
      },
      codes: {
        '42P01': {
          key: 'NOT_IMPLEMENTED',
          detail: 'This resource is not available yet',
        },
      },
    }),
  );

  it('maps the unique constraint to a validation error', async () => {
    const { res, body } = await call(h, '/duplicate');
    expect(res.status).toBe(422);
    expect(body).toMatchObject({
      code: 'VALIDATION_FAILED',
      location: 'body',
      errors: [
        { pointer: '/email', detail: 'That email is already registered' },
      ],
    });
  });

  it('maps the not-null column to a validation error', async () => {
    const { body } = await call(h, '/not-null');
    expect(body).toMatchObject({
      code: 'VALIDATION_FAILED',
      errors: [{ pointer: '/email', detail: 'Email is required' }],
    });
  });

  it('applies a constraint detail and a code override', async () => {
    const fk = await call(h, '/fk-missing');
    expect(fk.body).toMatchObject({
      status: 409,
      detail: 'The parent does not exist or still has children',
    });
    const missing = await call(h, '/undefined-table');
    expect(missing.res.status).toBe(501);
    expect(missing.body).toMatchObject({
      code: 'NOT_IMPLEMENTED',
      detail: 'This resource is not available yet',
    });
    expect(missing.report.handled).toBe(true);
  });
});

describe('includeStack on a mapped 5xx', () => {
  const h = harness(
    database,
    postgresMapper({
      codes: {
        '42P01': { key: 'INTERNAL_SERVER_ERROR', detail: 'Query failed' },
      },
    }),
    { includeStack: true },
  );

  it('renders the driver stack, whose first line is the server message', async () => {
    const res = await h.fetch('/undefined-table');
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(500);
    expect(body['detail']).toBe('Query failed');
    expect(body['stack']).toEqual(
      expect.stringContaining('relation "nope" does not exist'),
    );
  });

  it('does not render the ORM wrapper stack that carries the query', async () => {
    const res = await h.fetch('/drizzle/undefined-table');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['stack']).toEqual(expect.stringContaining('relation "nope"'));
    expect(body['stack']).not.toContain('Failed query');
  });

  it('adds no stack to a mapped 4xx', async () => {
    const res = await h.fetch('/duplicate');
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(409);
    expect(body['stack']).toBeUndefined();
  });
});
