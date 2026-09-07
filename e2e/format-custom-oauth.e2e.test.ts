import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bearerChallenge, createBan, defineFormat } from 'hono-ban';
import { assertFormatConformance } from 'hono-ban/testing';

import { compileWithAjv, schemaErrors } from './support/ajv';
import { startServer } from './support/server';

/**
 * The README's "Define your own format" example: OAuth 2.0 token endpoint
 * errors (RFC 6749 section 5.2) as a `defineFormat` format, served over HTTP
 * and checked against its own schema. The catalog `code` is the OAuth error
 * code, `detail` is `error_description`, and `type` is `error_uri`. Keep the
 * definition identical to the README by hand; this file is what proves it.
 * @ref https://www.rfc-editor.org/rfc/rfc6749#section-5.2
 */

const oauth = defineFormat({
  name: 'oauth',
  contentType: 'application/json',
  render: (error) => ({
    error: error.code,
    ...(error.detail === undefined ? {} : { error_description: error.detail }),
    ...(error.type === undefined ? {} : { error_uri: error.type }),
  }),
  schema: (definition, ctx) => ({
    type: 'object',
    required: ['error'],
    properties: {
      error:
        ctx.dialect === 'openapi-3.0'
          ? { enum: [definition.code] }
          : { const: definition.code },
      error_description: { type: 'string' },
      error_uri: { type: 'string', format: 'uri-reference' },
    },
    additionalProperties: false,
  }),
});

const token = createBan({
  format: oauth,
  validationKey: 'INVALID_REQUEST',
  errors: {
    INVALID_REQUEST: {
      status: 400,
      code: 'invalid_request',
      title: 'Invalid Request',
    },
    INVALID_CLIENT: {
      status: 401,
      code: 'invalid_client',
      title: 'Invalid Client',
    },
    INVALID_GRANT: {
      status: 400,
      code: 'invalid_grant',
      title: 'Invalid Grant',
    },
  },
});

const app = new Hono();
app.onError(token.onError());
app.post('/token', (c) => {
  const auth = c.req.header('authorization');
  if (auth === undefined) {
    // RFC 6749 5.2: invalid_client MUST answer 401 with a challenge matching
    // the client authentication scheme the request used.
    throw token.INVALID_CLIENT({
      headers: { 'WWW-Authenticate': 'Basic realm="token"' },
    });
  }
  throw token.INVALID_GRANT('The refresh token has expired', {
    type: 'https://auth.example.com/errors/invalid_grant',
  });
});
app.get('/resource', () => {
  throw token.INVALID_REQUEST({
    headers: {
      'WWW-Authenticate': bearerChallenge({ error: 'invalid_request' }),
    },
  });
});

let server: RunningServer;

beforeAll(async () => {
  server = await startServer(app);
});

afterAll(async () => {
  await server.close();
});

describe('OAuth 2.0 token errors through defineFormat (RFC 6749 5.2)', () => {
  it('renders error, error_description and error_uri from code, detail and type', async () => {
    const res = await server.fetch('/token', {
      method: 'POST',
      headers: { authorization: 'Basic Y2xpZW50OnNlY3JldA==' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/json');
    // The RFC's example response carries no-store; the handler's default matches.
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual({
      error: 'invalid_grant',
      error_description: 'The refresh token has expired',
      error_uri: 'https://auth.example.com/errors/invalid_grant',
    });
    const schema = oauth.schema(token.catalog.INVALID_GRANT, {
      docsBaseUrl: undefined,
      dialect: 'draft-2020-12',
    });
    expect(schemaErrors(schema, body)).toEqual([]);
  });

  it('answers invalid_client with 401 and the challenge the app supplies', async () => {
    const res = await server.fetch('/token', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Basic realm="token"');
    expect(await res.json()).toEqual({ error: 'invalid_client' });
  });

  it('pairs with bearerChallenge for resource requests', async () => {
    const res = await server.fetch('/resource');
    expect(res.status).toBe(400);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_request"',
    );
    expect(await res.json()).toEqual({ error: 'invalid_request' });
  });

  it('passes conformance for every catalog entry in both dialects', () => {
    expect(() => {
      assertFormatConformance(oauth, token.catalog, {
        compile: compileWithAjv,
      });
    }).not.toThrow();
    expect(
      oauth.schema(token.catalog.INVALID_GRANT, {
        docsBaseUrl: undefined,
        dialect: 'openapi-3.0',
      }),
    ).toMatchObject({ properties: { error: { enum: ['invalid_grant'] } } });
  });
});
