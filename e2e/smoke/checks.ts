/**
 * Runtime-neutral assertions over the smoke app (SPEC 14.2). `dispatch` is
 * `app.request()` inside Bun or Deno, or Miniflare's `dispatchFetch()` for
 * workerd, so only the response surface every runtime shares is used here.
 * This module imports nothing: the Node harness for workerd loads it without
 * pulling the worker's dependencies into the host process.
 */

export const DOCS_BASE_URL = 'https://errors.example.com';

interface ResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

interface DispatchInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export type Dispatch = (
  path: string,
  init?: DispatchInit,
) => Promise<ResponseLike>;

export interface SmokeResult {
  readonly runtime: string;
  readonly passed: number;
  readonly failures: ReadonlyArray<string>;
}

type Json = Record<string, unknown>;
type Check = (dispatch: Dispatch) => Promise<void>;

const PROBLEM_JSON = 'application/problem+json';
// @ref https://www.rfc-editor.org/rfc/rfc9562#name-uuid-format
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

class CheckFailure extends Error {
  override readonly name: string = 'CheckFailure';
}

function check(condition: boolean, message: string): void {
  if (!condition) {
    throw new CheckFailure(message);
  }
}

function equal(actual: unknown, expected: unknown, what: string): void {
  check(
    actual === expected,
    `${what}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
  );
}

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, what: string): Json {
  if (!isJson(value)) {
    throw new CheckFailure(`${what} is not a JSON object`);
  }
  return value;
}

function list(value: unknown, what: string): Array<unknown> {
  if (!Array.isArray(value)) {
    throw new CheckFailure(`${what} is not an array`);
  }
  return value;
}

async function json(res: ResponseLike): Promise<Json> {
  const parsed: unknown = JSON.parse(await res.text());
  return object(parsed, 'body');
}

function member(value: unknown, key: string): unknown {
  return isJson(value) ? value[key] : undefined;
}

/** Fetches a Problem Details response and checks the parts every one shares. */
async function problem(
  dispatch: Dispatch,
  path: string,
  status: number,
  init?: DispatchInit,
): Promise<{ res: ResponseLike; body: Json }> {
  const res = await dispatch(path, init);
  equal(res.status, status, `${path} status`);
  equal(res.headers.get('content-type'), PROBLEM_JSON, `${path} content-type`);
  equal(res.headers.get('cache-control'), 'no-store', `${path} Cache-Control`);
  const body = await json(res);
  equal(res.headers.get('x-error-id'), body['id'], `${path} X-Error-Id`);
  return { res, body };
}

/** Posts an invalid order and checks the 422 every validator hook must produce. */
async function invalidOrder(dispatch: Dispatch, path: string): Promise<void> {
  const { body } = await problem(dispatch, path, 422, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nope', quantity: 0 }),
  });
  equal(body['code'], 'VALIDATION_FAILED', `${path} code`);
  equal(body['location'], 'body', `${path} location`);
  const pointers = list(body['errors'], 'errors')
    .map((entry) => String(member(entry, 'pointer')))
    .toSorted();
  equal(JSON.stringify(pointers), '["/email","/quantity"]', `${path} pointers`);
}

const CHECKS: Readonly<Record<string, Check>> = {
  'catalog error as Problem Details': async (dispatch) => {
    const { body } = await problem(dispatch, '/orders/missing', 404);
    equal(body['type'], `${DOCS_BASE_URL}/NOT_FOUND`, 'type');
    equal(body['title'], 'Not Found', 'title');
    equal(body['code'], 'NOT_FOUND', 'code');
    equal(body['detail'], 'Order 42 does not exist', 'detail');
    equal(body['instance'], '/orders/missing', 'instance');
    const id = body['id'];
    check(typeof id === 'string' && UUID_PATTERN.test(id), 'id is a UUID');
  },
  'custom entry with meta and headers': async (dispatch) => {
    const { res, body } = await problem(dispatch, '/orders/conflict', 409);
    equal(body['code'], 'ORDER_CONFLICT', 'code');
    equal(body['title'], 'Order Conflict', 'title');
    equal(body['orderId'], 42, 'flattened meta.orderId');
    equal(res.headers.get('retry-after'), '30', 'Retry-After');
  },
  'validation through the Zod hook': async (dispatch) => {
    await invalidOrder(dispatch, '/orders');
  },
  'validation through the Valibot hook': async (dispatch) => {
    await invalidOrder(dispatch, '/orders/valibot');
  },
  'validation through the Standard Schema hook': async (dispatch) => {
    await invalidOrder(dispatch, '/orders/standard');
  },
  'HTTPException from hono/bearer-auth': async (dispatch) => {
    const { res, body } = await problem(dispatch, '/secure/orders', 401);
    check(
      (res.headers.get('www-authenticate') ?? '').startsWith('Bearer'),
      'WWW-Authenticate kept',
    );
    equal(body['code'], 'UNAUTHORIZED', 'code');
  },
  'bearerChallenge builds the WWW-Authenticate value': async (dispatch) => {
    const { res, body } = await problem(dispatch, '/scoped', 403);
    equal(
      res.headers.get('www-authenticate'),
      'Bearer realm="api", scope="orders:write", error="insufficient_scope"',
      'WWW-Authenticate',
    );
    equal(body['code'], 'FORBIDDEN', 'code');
  },
  'unknown Error hidden behind a constant 500': async (dispatch) => {
    const res = await dispatch('/boom');
    equal(res.status, 500, 'status');
    const text = await res.text();
    check(!text.includes('secret'), 'server internals do not leak');
    const parsed: unknown = JSON.parse(text);
    const body = object(parsed, 'body');
    equal(body['detail'], 'An unexpected error occurred', 'detail');
    equal(body['code'], 'INTERNAL_SERVER_ERROR', 'code');
  },
  'report shares the id with the response': async (dispatch) => {
    const { body } = await problem(dispatch, '/orders/missing', 404);
    const stored = await json(await dispatch(`/reports/${String(body['id'])}`));
    equal(stored['found'], true, 'report found');
    equal(stored['handled'], true, 'handled');
    equal(stored['status'], 404, 'report status');
  },
  'JSON:API format': async (dispatch) => {
    const res = await dispatch('/json-api/missing');
    equal(res.status, 404, 'status');
    equal(
      res.headers.get('content-type'),
      'application/vnd.api+json',
      'content-type',
    );
    const [first] = list((await json(res))['errors'], 'errors');
    check(first !== undefined, 'one error object');
    equal(member(first, 'status'), '404', 'status member');
    equal(member(first, 'code'), 'NOT_FOUND', 'code');
    equal(
      member(member(first, 'links'), 'type'),
      `${DOCS_BASE_URL}/NOT_FOUND`,
      'links.type',
    );
  },
  'plain format': async (dispatch) => {
    const res = await dispatch('/plain/missing');
    equal(res.status, 404, 'status');
    equal(res.headers.get('content-type'), 'application/json', 'content-type');
    const body = await json(res);
    equal(body['status'], 404, 'status member');
    equal(body['code'], 'NOT_FOUND', 'code');
  },
  'Google API format': async (dispatch) => {
    const res = await dispatch('/google-api/missing');
    equal(res.status, 404, 'status');
    equal(res.headers.get('content-type'), 'application/json', 'content-type');
    const error = object((await json(res))['error'], 'error');
    equal(error['code'], 404, 'error.code');
    equal(error['status'], 'NOT_FOUND', 'error.status');
    equal(error['message'], 'Order 42 does not exist', 'error.message');
    const [info] = list(error['details'], 'details');
    equal(
      member(info, '@type'),
      'type.googleapis.com/google.rpc.ErrorInfo',
      'ErrorInfo first',
    );
    equal(member(info, 'reason'), 'NOT_FOUND', 'reason');
    equal(member(info, 'domain'), 'smoke.example.com', 'domain');
  },
  'Stripe format': async (dispatch) => {
    const res = await dispatch('/stripe/missing');
    equal(res.status, 404, 'status');
    equal(res.headers.get('content-type'), 'application/json', 'content-type');
    const error = object((await json(res))['error'], 'error');
    equal(error['code'], 'not_found', 'code');
    equal(error['type'], 'invalid_request_error', 'type');
    equal(error['doc_url'], `${DOCS_BASE_URL}/NOT_FOUND`, 'doc_url');
    equal(error['message'], 'Order 42 does not exist', 'message');
  },
  'OpenAPI helpers': async (dispatch) => {
    const responses = await json(await dispatch('/openapi'));
    equal(
      JSON.stringify(Object.keys(responses).toSorted()),
      '["404","409","422"]',
      'statuses',
    );
    const schemaOf = (status: string): unknown =>
      member(
        member(member(responses[status], 'content'), PROBLEM_JSON),
        'schema',
      );
    equal(
      JSON.stringify(member(member(schemaOf('404'), 'properties'), 'code')),
      '{"const":"NOT_FOUND"}',
      '404 code const',
    );
    const required = list(member(schemaOf('422'), 'required'), '422 required');
    check(required.includes('errors'), '422 requires errors');
  },
  'renderError from hono-ban/testing': async (dispatch) => {
    const res = await dispatch('/rendered');
    equal(res.status, 410, 'status');
    equal(res.headers.get('content-type'), PROBLEM_JSON, 'content-type');
    const body = await json(res);
    equal(body['code'], 'GONE', 'code');
    equal(body['instance'], '/rendered', 'instance');
  },
};

/** Runs every check and collects failures so one report covers them all. */
export async function runChecks(dispatch: Dispatch): Promise<SmokeResult> {
  const runtime = await (await dispatch('/runtime')).text();
  const failures: Array<string> = [];
  let passed = 0;
  for (const [name, run] of Object.entries(CHECKS)) {
    try {
      await run(dispatch);
      passed += 1;
    } catch (error) {
      failures.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { runtime, passed, failures };
}

/** Prints the outcome; throws on failure so the process exits non-zero everywhere. */
export function report(result: SmokeResult): void {
  const total = result.passed + result.failures.length;
  if (result.failures.length === 0) {
    console.log(`hono-ban smoke: ${total} checks passed on ${result.runtime}`);
    return;
  }
  for (const failure of result.failures) {
    console.error(`FAIL ${failure}`);
  }
  throw new Error(
    `hono-ban smoke: ${result.failures.length} of ${total} checks failed on ${result.runtime}`,
  );
}
