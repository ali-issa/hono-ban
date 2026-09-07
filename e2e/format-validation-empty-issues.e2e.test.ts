import type { ErrorFormat, IssueLocation } from 'hono-ban';

import type { RunningServer } from './support/server';

import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createBan } from 'hono-ban';
import { googleApi } from 'hono-ban/formats/google-api';
import { jsonApi } from 'hono-ban/formats/json-api';
import { plain } from 'hono-ban/formats/plain';
import { problemDetails } from 'hono-ban/formats/problem-details';
import { stripe } from 'hono-ban/formats/stripe';

import { compileWithAjv } from './support/ajv';
import { startServer } from './support/server';

/**
 * `ban.validation([], { location })` over HTTP for every built-in format
 * (SPEC 7.2.2, 7.6.2, 7.4). An empty issue list is legal, and each body
 * must still validate against the format's own `validationSchema`: JSON:API
 * renders one summary error object because `errors` needs at least one,
 * Google API omits `BadRequest` because proto3 JSON has no empty repeated
 * field, and the others render an empty `errors` array or no `param`.
 */

const LOCATIONS: ReadonlyArray<IssueLocation> = ['body', 'query', 'header'];
const SCHEMA_CONTEXT = {
  docsBaseUrl: 'https://errors.example.com',
  dialect: 'draft-2020-12',
} as const;

const FORMATS: ReadonlyArray<{ name: string; format: ErrorFormat }> = [
  { name: 'problemDetails', format: problemDetails() },
  { name: 'jsonApi', format: jsonApi() },
  { name: 'plain', format: plain() },
  { name: 'googleApi', format: googleApi({ domain: 'orders.example.com' }) },
  { name: 'stripe', format: stripe() },
];

describe.each(FORMATS)('$name renders an empty issue list', ({ format }) => {
  const ban = createBan({ format, docsBaseUrl: SCHEMA_CONTEXT.docsBaseUrl });
  const app = new Hono();
  app.onError(ban.onError());
  for (const location of LOCATIONS) {
    app.get(`/${location}`, () => {
      throw ban.validation([], { location });
    });
  }
  let server: RunningServer | undefined;
  beforeAll(async () => {
    server = await startServer(app);
  });
  afterAll(async () => {
    await server?.close();
  });
  const validate = compileWithAjv(
    format.validationSchema(ban.catalog.VALIDATION_FAILED, SCHEMA_CONTEXT),
  );

  it.each(LOCATIONS)(
    'as a 422 that matches validationSchema (%s)',
    async (location) => {
      if (server === undefined) {
        throw new Error('server not started');
      }
      const response = await server.fetch(`/${location}`);
      expect(response.status).toBe(422);
      const body: unknown = await response.json();
      expect(validate(body)).toEqual([]);
      expect(JSON.stringify(body)).toContain('Request validation failed');
    },
  );
});
