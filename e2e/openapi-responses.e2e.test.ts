import type { BanError, JsonSchema } from 'hono-ban';

import type { RunningServer } from './support/server';

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { PROBLEM_DETAILS_CONTENT_TYPE } from 'hono-ban/formats/problem-details';
import {
  errorResponse,
  errorResponses,
  validationResponse,
  validationSchema,
} from 'hono-ban/openapi';
import { defaultHook } from 'hono-ban/zod';

import { compileWithAjv } from './support/ajv';
import { startServer } from './support/server';

/**
 * Real error responses against the served OpenAPI 3.1 document (SPEC 9,
 * 7.1.4, 7.4). Routes declare their errors with `errorResponses`,
 * `errorResponse`, and `validationResponse`, then really throw them; each
 * body fetched over HTTP must validate (Ajv 2020-12, strict) against the
 * schema read back from the document, including a 422 produced by
 * `defaultHook` from `hono-ban/zod` on an invalid request body. The sibling
 * `openapi-document` suite covers the document shape and the 3.0 dialect.
 */

const ban = createBan({
  errors: {
    ORDER_CONFLICT: {
      status: 409,
      description: 'The order changed underneath you',
    },
  },
});
const CT = PROBLEM_DETAILS_CONTENT_TYPE;
/** Keys and statuses mixed; BAD_REQUEST and MALFORMED_JSON share 400. */
const ERROR_REFS = [
  401,
  'NOT_FOUND',
  'ORDER_CONFLICT',
  'BAD_REQUEST',
  'MALFORMED_JSON',
];
const FORBIDDEN_DESCRIPTION = 'Guests may not place orders';

const Order = z.object({ id: z.string() });
const OrderInput = z.object({
  email: z.email(),
  quantity: z.number().int().positive(),
});

/** Order ids that make `GET /orders/{id}` throw a catalogued error. */
const FAILURES: Readonly<Record<string, () => BanError>> = {
  locked: () => ban.unauthorized('Sign in to see this order'),
  bad: () => ban.badRequest('Order ids are opaque strings'),
  garbled: () => ban.malformedJson('The stored order is not JSON'),
  missing: () => ban.notFound('Order does not exist'),
  stale: () => ban.error('ORDER_CONFLICT', { detail: 'Order was modified' }),
};

const app = new OpenAPIHono({ defaultHook: defaultHook(ban) });
app.onError(ban.onError());
app.openapi(
  createRoute({
    method: 'get',
    path: '/orders/{id}',
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'The order',
        content: { 'application/json': { schema: Order } },
      },
      ...errorResponses(ban, ERROR_REFS),
    },
  }),
  (c) => {
    const { id } = c.req.valid('param');
    const fail = FAILURES[id];
    if (fail !== undefined) {
      throw fail();
    }
    return c.json({ id }, 200);
  },
);
app.openapi(
  createRoute({
    method: 'post',
    path: '/orders',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: OrderInput } },
      },
    },
    responses: {
      201: {
        description: 'Created',
        content: { 'application/json': { schema: Order } },
      },
      403: errorResponse(ban, 'FORBIDDEN', {
        description: FORBIDDEN_DESCRIPTION,
      }),
      422: validationResponse(ban),
    },
  }),
  (c) => {
    if (c.req.header('x-actor') === 'guest') {
      throw ban.forbidden(FORBIDDEN_DESCRIPTION);
    }
    return c.json({ id: 'ord_1' }, 201);
  },
);
// doc() always runs the 3.0 generator; doc31() is the documented 3.1 endpoint.
// @ref https://github.com/honojs/middleware/tree/main/packages/zod-openapi#openapi-v31
app.doc31('/doc', {
  openapi: '3.1.0',
  info: { title: 'Orders', version: '1' },
});

/** The slice of a served OpenAPI document these tests read. */
interface ServedResponse {
  readonly content: Readonly<Record<string, { readonly schema: JsonSchema }>>;
}
interface Operation {
  readonly responses: Record<string, ServedResponse>;
}
interface ServedDocument {
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
  readonly components?: {
    readonly schemas?: Readonly<Record<string, JsonSchema>>;
  };
}

/**
 * The Problem Details schema declared for `status` on one operation. The
 * helpers emit schemas inline; a `$ref` would point into
 * `components/schemas`, so it is resolved before compiling.
 * @ref https://spec.openapis.org/oas/v3.1.0#responses-object
 * @ref https://spec.openapis.org/oas/v3.1.0#reference-object
 */
function servedSchema(
  document: ServedDocument,
  path: string,
  method: string,
  status: number,
): JsonSchema {
  const media =
    document.paths[path]?.[method]?.responses[String(status)]?.content[CT];
  if (media === undefined) {
    throw new Error(
      `${method.toUpperCase()} ${path} declares no ${CT} ${String(status)}`,
    );
  }
  const ref = media.schema['$ref'];
  if (typeof ref !== 'string') {
    return media.schema;
  }
  const prefix = '#/components/schemas/';
  const target = ref.startsWith(prefix)
    ? document.components?.schemas?.[ref.slice(prefix.length)]
    : undefined;
  if (target === undefined) {
    throw new Error(`unresolvable ${ref}`);
  }
  return target;
}

describe('real error responses validate against the served 3.1 schemas', () => {
  let server: RunningServer;
  let document: ServedDocument;

  beforeAll(async () => {
    server = await startServer(app);
    const res = await server.fetch('/doc');
    expect(res.status).toBe(200);
    document = (await res.json()) as ServedDocument;
  });
  afterAll(async () => {
    await server.close();
  });

  it.each([
    ['/orders/locked', 401, 'UNAUTHORIZED'],
    ['/orders/bad', 400, 'BAD_REQUEST'],
    ['/orders/garbled', 400, 'MALFORMED_JSON'],
    ['/orders/missing', 404, 'NOT_FOUND'],
    ['/orders/stale', 409, 'ORDER_CONFLICT'],
  ] as const)(
    'GET %s returns %i matching the served schema',
    async (path, status, code) => {
      const res = await server.fetch(path);
      expect(res.status).toBe(status);
      expect(res.headers.get('content-type')).toBe(CT);
      const body = await res.json();
      expect(body).toMatchObject({ status, code, instance: path });
      // For 400 the schema is the merged anyOf; the branch with this `code` matches.
      const schema = servedSchema(document, '/orders/{id}', 'get', status);
      expect(compileWithAjv(schema)(body)).toEqual([]);
    },
  );

  it('POST /orders returns a 403 matching the served schema', async () => {
    const res = await server.fetch('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-actor': 'guest' },
      body: JSON.stringify({ email: 'ada@example.com', quantity: 2 }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toBe(CT);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      detail: FORBIDDEN_DESCRIPTION,
    });
    const schema = servedSchema(document, '/orders', 'post', 403);
    expect(compileWithAjv(schema)(body)).toEqual([]);
  });

  it('a valid body passes the request validator', async () => {
    const res = await server.fetch('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com', quantity: 2 }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'ord_1' });
  });

  it('an invalid body yields a real 422 matching the served validation schema', async () => {
    const res = await server.fetch('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', quantity: -1 }),
    });
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toBe(CT);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 422,
      code: ban.validationKey,
      location: 'body',
    });
    // Body issues carry RFC 6901 pointers (SPEC 7.1.3, 8.3).
    // @ref https://www.rfc-editor.org/rfc/rfc6901#section-5
    const pointers = body.errors.map(
      (entry: { pointer: string }) => entry.pointer,
    );
    expect(pointers.toSorted()).toEqual(['/email', '/quantity']);
    const schema = servedSchema(document, '/orders', 'post', 422);
    expect(compileWithAjv(schema)(body)).toEqual([]);
    expect(compileWithAjv(validationSchema(ban))(body)).toEqual([]);
  });
});
