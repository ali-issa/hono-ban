/**
 * JSON:API validation documents over HTTP and format conformance
 * (SPEC 7.2.2, 7.2.3, 7.4, 8.1, 8.2, 8.3).
 *
 * `ban.validation(issues, { location })` thrown from a Hono route reaches the
 * client as a 422 JSON:API error document with one error object per issue.
 * Against the built package on a real server this suite proves the `source`
 * member per location (`pointer` for body and form with RFC 6901 escaping,
 * `parameter` for query, `header` for header, none for param and cookie),
 * the `meta.location`, `meta.name`, `code`, `expected`, and `received`
 * members, the shared `id`, `status`, `code`, and `title`, the string `'422'`
 * status, and that every document validates against `validationSchema`. It
 * also runs `assertFormatConformance` from `hono-ban/testing` over the whole
 * catalog with Ajv. Non-validation documents live in
 * `format-json-api.e2e.test.ts`.
 * @ref https://jsonapi.org/format/1.1/#errors
 * @ref https://www.rfc-editor.org/rfc/rfc6901
 */
import type { IssueLocation, ValidationIssue } from 'hono-ban';
import type {
  JsonApiBody,
  JsonApiErrorObject,
  JsonApiSource,
} from 'hono-ban/formats/json-api';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { JSON_API_CONTENT_TYPE, jsonApi } from 'hono-ban/formats/json-api';
import { assertFormatConformance } from 'hono-ban/testing';

import { compileWithAjv, schemaErrors } from './support/ajv';
import { startServer } from './support/server';

const DOCS_BASE_URL = 'https://errors.example.com';
const TYPE_BASE_URL = 'https://types.example.com';
const UNPROCESSABLE = 422;
const SCHEMA_CONTEXT = {
  docsBaseUrl: DOCS_BASE_URL,
  dialect: 'draft-2020-12',
} as const;
const LOCATIONS: ReadonlyArray<IssueLocation> = [
  'body',
  'form',
  'query',
  'param',
  'header',
  'cookie',
];
/** Two issues: one with `code`, one with `expected`/`received`, so every optional meta member is exercised. */
const ISSUES: ReadonlyArray<ValidationIssue> = [
  { path: ['items', 0, 'sku'], message: 'Required', code: 'invalid_type' },
  {
    path: ['page'],
    message: 'Expected number',
    expected: 'number',
    received: 'string',
  },
];
const SHARED = {
  links: { type: `${DOCS_BASE_URL}/VALIDATION_FAILED` },
  status: '422',
  code: 'VALIDATION_FAILED',
  title: 'Validation Failed',
} as const;

interface LocationCase {
  readonly location: IssueLocation;
  /** `source` per issue; `undefined` when JSON:API defines no member for the location. */
  readonly sources: readonly [JsonApiSource, JsonApiSource] | undefined;
  /** Whether `meta.name` carries the first path segment (param and cookie only). */
  readonly named: boolean;
}

/**
 * @ref https://jsonapi.org/format/1.1/#error-objects (`source.pointer`,
 * `source.parameter`, `source.header`; nothing for path or cookie parameters)
 */
const LOCATION_CASES: ReadonlyArray<LocationCase> = [
  {
    location: 'body',
    sources: [{ pointer: '/items/0/sku' }, { pointer: '/page' }],
    named: false,
  },
  {
    location: 'form',
    sources: [{ pointer: '/items/0/sku' }, { pointer: '/page' }],
    named: false,
  },
  {
    location: 'query',
    sources: [{ parameter: 'items' }, { parameter: 'page' }],
    named: false,
  },
  {
    location: 'header',
    sources: [{ header: 'items' }, { header: 'page' }],
    named: false,
  },
  { location: 'param', sources: undefined, named: true },
  { location: 'cookie', sources: undefined, named: true },
];

interface PointerCase {
  readonly path: ReadonlyArray<string | number>;
  readonly pointer: string;
}

/**
 * `~` is escaped to `~0` before `/` becomes `~1`, so the key `~/` is `~0~1`
 * and never `~01`; array indices are plain decimal segments; an empty key is
 * `/`; an empty path is the whole document.
 * @ref https://www.rfc-editor.org/rfc/rfc6901#section-3
 * @ref https://www.rfc-editor.org/rfc/rfc6901#section-5
 */
const POINTER_CASES: ReadonlyArray<PointerCase> = [
  { path: ['items', 0, 'sku'], pointer: '/items/0/sku' },
  { path: ['tags', 2, 'nested', 0], pointer: '/tags/2/nested/0' },
  { path: ['a/b'], pointer: '/a~1b' },
  { path: ['m~n'], pointer: '/m~0n' },
  { path: ['~/'], pointer: '/~0~1' },
  { path: ['k"l'], pointer: '/k"l' },
  { path: [' '], pointer: '/ ' },
  { path: [''], pointer: '/' },
  { path: [], pointer: '' },
];

/** Starts `app` for the enclosing describe block and stops it afterwards. */
function useServer(app: Hono): RunningServer['fetch'] {
  let server: RunningServer | undefined;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server?.close();
  });
  return async (path, init) => {
    if (server === undefined) {
      throw new Error('server is not running');
    }
    const response = await server.fetch(path, init);
    return response;
  };
}

async function readBody(response: Response): Promise<JsonApiBody> {
  return (await response.json()) as JsonApiBody;
}

function firstError(body: JsonApiBody): JsonApiErrorObject {
  const [object] = body.errors;
  if (object === undefined) {
    throw new Error('errors array is empty');
  }
  return object;
}

describe('jsonApi() validation documents', () => {
  const ban = createBan({ format: jsonApi(), docsBaseUrl: DOCS_BASE_URL });
  const app = new Hono();
  app.onError(ban.onError());
  for (const location of LOCATIONS) {
    app.get(`/validate/${location}`, () => {
      throw ban.validation(ISSUES, {
        location,
        detail: 'Order is invalid',
        meta: { orderId: 7 },
      });
    });
  }
  app.post('/pointer', async (c) => {
    const { path } = (await c.req.json()) as {
      path: ReadonlyArray<string | number>;
    };
    throw ban.validation([{ path, message: 'Invalid' }], { location: 'body' });
  });
  const request = useServer(app);

  it.each(LOCATION_CASES)(
    'renders one error object per issue with source and meta for $location',
    async ({ location, sources, named }) => {
      const response = await request(`/validate/${location}`);
      expect(response.status).toBe(UNPROCESSABLE);
      expect(response.headers.get('content-type')).toBe(JSON_API_CONTENT_TYPE);
      const body = await readBody(response);
      expect(body.errors).toHaveLength(2);
      const [first, second] = body.errors;
      // Every object shares the error id, which is also the X-Error-Id header.
      const id = response.headers.get('x-error-id');
      expect(first).toEqual({
        id,
        ...SHARED,
        detail: 'Required',
        ...(sources === undefined ? {} : { source: sources[0] }),
        meta: {
          orderId: 7,
          location,
          ...(named ? { name: 'items' } : {}),
          code: 'invalid_type',
        },
      });
      expect(second).toEqual({
        id,
        ...SHARED,
        detail: 'Expected number',
        ...(sources === undefined ? {} : { source: sources[1] }),
        meta: {
          orderId: 7,
          location,
          ...(named ? { name: 'page' } : {}),
          expected: 'number',
          received: 'string',
        },
      });
      // SPEC 7.2.2: `detail` is the issue message; the error's own detail is not a member.
      expect(JSON.stringify(body)).not.toContain('Order is invalid');
    },
  );

  it.each(POINTER_CASES)(
    'escapes path $path as the RFC 6901 pointer $pointer',
    async ({ path, pointer }) => {
      const response = await request('/pointer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      expect(response.status).toBe(UNPROCESSABLE);
      const body = await readBody(response);
      expect(body.errors).toHaveLength(1);
      expect(firstError(body).source).toEqual({ pointer });
    },
  );

  it('serves documents that validate against validationSchema for every location', async () => {
    const validate = compileWithAjv(
      ban.format.validationSchema(
        ban.catalog.VALIDATION_FAILED,
        SCHEMA_CONTEXT,
      ),
    );
    for (const location of LOCATIONS) {
      const body = await readBody(await request(`/validate/${location}`));
      expect(validate(body), location).toEqual([]);
    }
    const body = await readBody(await request('/validate/body'));
    // SPEC 7.2.3: error objects are closed and pinned to the entry's status.
    expect(
      validate({ errors: [{ ...firstError(body), extra: true }] }),
    ).not.toEqual([]);
    expect(
      schemaErrors(
        ban.format.validationSchema(ban.catalog.NOT_FOUND, SCHEMA_CONTEXT),
        body,
      ),
    ).not.toEqual([]);
  });
});

describe('jsonApi() conformance (SPEC 7.4)', () => {
  const ban = createBan({ format: jsonApi(), docsBaseUrl: DOCS_BASE_URL });

  it.each([
    { name: 'defaults', format: jsonApi() },
    { name: 'includeId: false', format: jsonApi({ includeId: false }) },
    {
      name: 'links and a renamed trace key',
      format: jsonApi({
        traceIdMetaKey: 'trace',
        typeLinkBaseUrl: TYPE_BASE_URL,
        aboutLink: (error) => `https://status.example.com/${error.id}`,
      }),
    },
  ])('passes assertFormatConformance with $name', ({ format }) => {
    expect(() => {
      assertFormatConformance(format, ban.catalog, {
        compile: compileWithAjv,
        docsBaseUrl: DOCS_BASE_URL,
      });
    }).not.toThrow();
  });
});
