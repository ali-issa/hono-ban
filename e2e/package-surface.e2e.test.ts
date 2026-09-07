import { Hono } from 'hono';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * Package surface. Every subpath in SPEC section 1 must resolve through the
 * published `exports` map at runtime and export what the SPEC lists. The
 * imports below are value imports on purpose: a missing dist file or a wrong
 * `exports` entry fails here before any feature test runs.
 */
import * as root from 'hono-ban';
import * as googleApi from 'hono-ban/formats/google-api';
import * as jsonApi from 'hono-ban/formats/json-api';
import * as plain from 'hono-ban/formats/plain';
import * as problemDetails from 'hono-ban/formats/problem-details';
import * as stripe from 'hono-ban/formats/stripe';
import * as openapi from 'hono-ban/openapi';
import * as otel from 'hono-ban/otel';
import * as standardSchema from 'hono-ban/standard-schema';
import * as testing from 'hono-ban/testing';
import * as valibot from 'hono-ban/valibot';
import * as zod from 'hono-ban/zod';

import { startServer } from './support/server';

/** Sorted export names, so lists compare independent of module order. */
function names(module: object): Array<string> {
  return Object.keys(module).toSorted();
}

function sorted(list: Array<string>): Array<string> {
  return list.toSorted();
}

describe('package surface', () => {
  it('root exports the SPEC section 1 values', () => {
    expect(names(root)).toEqual(
      sorted([
        'BUILTIN_CATALOG',
        'BanError',
        'FACTORY_NAMES',
        'assert',
        'bearerChallenge',
        'createBan',
        'defineFormat',
        'isBanError',
        'locationFromTarget',
        'nameFromPath',
        'parseTraceparent',
        'pointerFromPath',
        'problemDetails',
      ]),
    );
  });

  it('format subpaths export their factory and content type', () => {
    expect(names(problemDetails)).toEqual(
      sorted(['PROBLEM_DETAILS_CONTENT_TYPE', 'problemDetails']),
    );
    expect(names(jsonApi)).toEqual(
      sorted(['JSON_API_CONTENT_TYPE', 'jsonApi']),
    );
    expect(names(plain)).toEqual(sorted(['PLAIN_CONTENT_TYPE', 'plain']));
    expect(names(googleApi)).toEqual(
      sorted(['GOOGLE_API_CONTENT_TYPE', 'googleApi']),
    );
    expect(names(stripe)).toEqual(sorted(['STRIPE_CONTENT_TYPE', 'stripe']));
    expect(problemDetails.PROBLEM_DETAILS_CONTENT_TYPE).toBe(
      'application/problem+json',
    );
    expect(jsonApi.JSON_API_CONTENT_TYPE).toBe('application/vnd.api+json');
    expect(plain.PLAIN_CONTENT_TYPE).toBe('application/json');
    expect(googleApi.GOOGLE_API_CONTENT_TYPE).toBe('application/json');
    expect(stripe.STRIPE_CONTENT_TYPE).toBe('application/json');
  });

  it('validator subpaths export hooks and converters', () => {
    expect(names(zod)).toEqual(
      sorted(['defaultHook', 'fromZodError', 'hook', 'toIssues']),
    );
    expect(names(valibot)).toEqual(
      sorted(['fromValibotIssues', 'hook', 'toIssues']),
    );
    expect(names(standardSchema)).toEqual(
      sorted(['fromIssues', 'hook', 'toIssues']),
    );
  });

  it('openapi, otel and testing subpaths export their helpers', () => {
    expect(names(openapi)).toEqual(
      sorted([
        'errorResponse',
        'errorResponses',
        'errorSchema',
        'validationResponse',
        'validationSchema',
      ]),
    );
    expect(names(otel)).toEqual(['traceIdFromOtel']);
    expect(names(testing)).toEqual(
      sorted(['assertFormatConformance', 'expectBanError', 'renderError']),
    );
  });

  it('root problemDetails is the same module as the subpath', () => {
    expect(root.problemDetails).toBe(problemDetails.problemDetails);
  });
});

describe('built package over HTTP', () => {
  const ban = root.createBan();
  const app = new Hono();
  app.onError(ban.onError());
  app.get('/missing', () => {
    throw ban.notFound('Order 42 does not exist');
  });
  const server = startServer(app);

  afterAll(async () => {
    await (await server).close();
  });

  it('serves a Problem Details response from a real server', async () => {
    const res = await (await server).fetch('/missing');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const body = await res.json();
    expect(body).toMatchObject({
      status: 404,
      title: 'Not Found',
      detail: 'Order 42 does not exist',
      code: 'NOT_FOUND',
      instance: '/missing',
    });
  });
});
