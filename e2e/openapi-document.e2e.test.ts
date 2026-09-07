import type { JsonSchema, SchemaDialect } from 'hono-ban';

import type { RunningServer } from './support/server';

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { PROBLEM_DETAILS_CONTENT_TYPE } from 'hono-ban/formats/problem-details';
import {
  errorResponse,
  errorResponses,
  errorSchema,
  validationResponse,
  validationSchema,
} from 'hono-ban/openapi';

import { startServer } from './support/server';

/**
 * OpenAPI helpers (SPEC 9) in documents served by `@hono/zod-openapi`.
 * Proves that `errorResponse`, `errorResponses`, and `validationResponse`
 * drop into `createRoute({ responses })` verbatim, that same-status keys
 * merge into `anyOf`, that the 3.1 document spells constants with `const`
 * while a `{ dialect: 'openapi-3.0' }` build uses `enum` (SPEC 7, 7.1.4),
 * and that unknown references throw `RangeError`. The sibling
 * `openapi-responses` suite validates real error bodies against these
 * served schemas.
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
const INFO = { title: 'Orders', version: '1.0.0' };
/** Keys and statuses mixed; BAD_REQUEST and MALFORMED_JSON share 400. */
const ERROR_REFS = [
  401,
  'NOT_FOUND',
  'ORDER_CONFLICT',
  'BAD_REQUEST',
  'MALFORMED_JSON',
];
const FORBIDDEN_DESCRIPTION = 'Guests may not place orders';
const OPENAPI_30 = { dialect: 'openapi-3.0' } as const;

const Order = z.object({ id: z.string() });
const OrderInput = z.object({
  email: z.email(),
  quantity: z.number().int().positive(),
});

/** One app per dialect; only its document is read here, never its routes. */
function buildApp(dialect: SchemaDialect): OpenAPIHono {
  const app = new OpenAPIHono();
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
        ...errorResponses(ban, ERROR_REFS, { dialect }),
      },
    }),
    (c) => c.json({ id: c.req.valid('param').id }, 200),
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
          dialect,
          description: FORBIDDEN_DESCRIPTION,
        }),
        422: validationResponse(ban, { dialect }),
      },
    }),
    (c) => c.json({ id: 'ord_1' }, 201),
  );
  return app;
}

/** The slice of a served OpenAPI document these tests read. */
interface ServedResponse {
  readonly description: string;
  readonly content: Readonly<Record<string, { readonly schema: JsonSchema }>>;
}
interface Operation {
  readonly responses: Record<string, ServedResponse>;
}
interface ServedDocument {
  readonly openapi: string;
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
}

/**
 * Responses Object of one operation, keyed by status code string.
 * @ref https://spec.openapis.org/oas/v3.1.0#responses-object
 */
function responsesOf(
  document: ServedDocument,
  path: string,
  method: string,
): Record<string, ServedResponse> {
  const operation = document.paths[path]?.[method];
  if (operation === undefined) {
    throw new Error(`${method.toUpperCase()} ${path} is not in the document`);
  }
  return operation.responses;
}

/** Schema of the Problem Details media type; `toEqual` proves it is inline. */
function schemaOf(response: ServedResponse | undefined): JsonSchema {
  const media = response?.content[CT];
  if (media === undefined) {
    throw new Error(`response has no ${CT} content`);
  }
  return media.schema;
}

describe('OpenAPI 3.1 document', () => {
  const app = buildApp('draft-2020-12');
  // doc() always runs the 3.0 generator; doc31() is the documented 3.1 endpoint.
  // @ref https://github.com/honojs/middleware/tree/main/packages/zod-openapi#openapi-v31
  app.doc31('/doc', { openapi: '3.1.0', info: INFO });
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

  it('emits the helper Response Objects verbatim, keyed by status', () => {
    expect(document.openapi).toBe('3.1.0');
    const responses = responsesOf(document, '/orders/{id}', 'get');
    expect(Object.keys(responses).toSorted()).toEqual([
      '200',
      '400',
      '401',
      '404',
      '409',
    ]);
    expect(responses['404']).toEqual(errorResponse(ban, 404));
    expect(responses['409']?.description).toBe(
      'The order changed underneath you',
    );
    // Content is keyed by the format's content type (SPEC 9).
    expect(Object.keys(responses['401']?.content ?? {})).toEqual([
      ban.format.contentType,
    ]);
    expect(ban.format.contentType).toBe(CT);
  });

  it('merges two keys on one status into anyOf with an " or " description', () => {
    const shared = responsesOf(document, '/orders/{id}', 'get')['400'];
    expect(shared?.description).toBe('Bad Request or Malformed JSON');
    expect(schemaOf(shared)).toEqual({
      anyOf: [
        errorSchema(ban, 'BAD_REQUEST'),
        errorSchema(ban, 'MALFORMED_JSON'),
      ],
    });
  });

  it('spells constant members with const in 3.1', () => {
    // @ref https://spec.openapis.org/oas/v3.1.0#schema-object (JSON Schema 2020-12)
    const schema = schemaOf(
      responsesOf(document, '/orders/{id}', 'get')['404'],
    );
    expect(schema).toEqual(errorSchema(ban, 404));
    expect(schema['properties']).toMatchObject({
      status: { const: 404 },
      title: { const: 'Not Found' },
      code: { const: 'NOT_FOUND' },
    });
  });

  it('honours the description override and documents validation bodies', () => {
    const responses = responsesOf(document, '/orders', 'post');
    expect(responses['403']?.description).toBe(FORBIDDEN_DESCRIPTION);
    expect(schemaOf(responses['403'])).toEqual(errorSchema(ban, 'FORBIDDEN'));
    expect(responses['422']).toEqual(validationResponse(ban));
    expect(responses['422']?.description).toBe('Validation Failed');
    expect(schemaOf(responses['422'])['required']).toContain('errors');
  });
});

describe('OpenAPI 3.0 document', () => {
  const app = buildApp(OPENAPI_30.dialect);
  app.doc('/doc30', { openapi: '3.0.0', info: INFO });
  let server: RunningServer;
  let document: ServedDocument;

  beforeAll(async () => {
    server = await startServer(app);
    const res = await server.fetch('/doc30');
    expect(res.status).toBe(200);
    document = (await res.json()) as ServedDocument;
  });
  afterAll(async () => {
    await server.close();
  });

  it('spells the same constant members with enum, never const', () => {
    // 3.0 Schema Objects predate `const`; a single-value `enum` is the equivalent.
    // @ref https://spec.openapis.org/oas/v3.0.3#schema-object
    expect(document.openapi).toBe('3.0.0');
    const responses = responsesOf(document, '/orders/{id}', 'get');
    const schema = schemaOf(responses['404']);
    expect(schema).toEqual(errorSchema(ban, 404, OPENAPI_30));
    expect(schema['properties']).toMatchObject({
      status: { enum: [404] },
      title: { enum: ['Not Found'] },
      code: { enum: ['NOT_FOUND'] },
    });
    expect(JSON.stringify(responses)).not.toContain('"const"');
  });

  it('keeps the anyOf grouping and the validation schema in the 3.0 dialect', () => {
    const shared = responsesOf(document, '/orders/{id}', 'get')['400'];
    expect(shared?.description).toBe('Bad Request or Malformed JSON');
    expect(schemaOf(shared)).toEqual({
      anyOf: [
        errorSchema(ban, 'BAD_REQUEST', OPENAPI_30),
        errorSchema(ban, 'MALFORMED_JSON', OPENAPI_30),
      ],
    });
    const validation = responsesOf(document, '/orders', 'post')['422'];
    expect(schemaOf(validation)).toEqual(validationSchema(ban, OPENAPI_30));
  });
});

describe('unknown references', () => {
  it.each(['NOPE', 'CUSTOM', 499, 418])('%j throws RangeError', (ref) => {
    expect(() => errorSchema(ban, ref)).toThrow(RangeError);
    expect(() => errorResponse(ban, ref)).toThrow(RangeError);
  });

  it('errorResponses with one unknown status throws RangeError', () => {
    // 418 is deliberately absent from the catalog (SPEC 3).
    expect(() => errorResponses(ban, [404, 418])).toThrow(RangeError);
  });
});
