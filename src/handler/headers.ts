/**
 * Header handling for `ban.onError()` (SPEC 6.9): the merge order, the
 * construction-time checks on header options, and the last-resort headers
 * of the fallback (SPEC 6.4).
 * @packageDocumentation
 */
import { DEFAULT_CACHE_CONTROL } from '../internal/constants';

const SET_COOKIE = 'set-cookie';
const CACHE_CONTROL = 'cache-control';

/**
 * Header precedence (SPEC 6.9): `Cache-Control: no-store` as the floor, then
 * options, then the error's, then ours. `Set-Cookie` is the one header whose
 * values never combine: iteration yields each cookie separately, so `set()`
 * would keep only the last one. Cookies are appended instead, from both
 * sources.
 * @ref https://fetch.spec.whatwg.org/#concept-header-list-sort-and-combine
 * @ref https://fetch.spec.whatwg.org/#dom-headers-getsetcookie
 */
export function mergeHeaders(
  base: HeadersInit | undefined,
  rendered: Headers,
  errorIdHeader: string | false,
  id: string,
): Headers {
  const headers = new Headers(base);
  if (!headers.has(CACHE_CONTROL)) {
    headers.set(CACHE_CONTROL, DEFAULT_CACHE_CONTROL);
  }
  rendered.forEach((value, name) => {
    if (name !== SET_COOKIE) {
      headers.set(name, value);
    }
  });
  for (const cookie of rendered.getSetCookie()) {
    headers.append(SET_COOKIE, cookie);
  }
  if (errorIdHeader !== false) {
    headers.set(errorIdHeader, id);
  }
  return headers;
}

/**
 * `Headers` rejects an invalid field name or value with a `TypeError`
 * (Fetch, "validate" in the `Headers` constructor and `set()`). Checked once
 * at construction so a misconfigured `errorIdHeader`, `requestIdHeader`, or
 * `headers` fails at startup: inside the handler the same `TypeError` would
 * surface in the header merge both fallback tiers share (SPEC 6.4) and every
 * response, not one, would be affected.
 * @ref https://fetch.spec.whatwg.org/#dom-headers-set
 * @ref https://fetch.spec.whatwg.org/#concept-headers-fill
 */
export function assertHeaderName(option: string, name: string | false): void {
  if (name === false) {
    return;
  }
  try {
    new Headers().set(name, 'x');
  } catch {
    throw new TypeError(`${option} "${name}" is not a valid HTTP header name`);
  }
}

export function assertHeadersInit(init: HeadersInit | undefined): void {
  try {
    void new Headers(init);
  } catch (cause) {
    throw new TypeError('headers holds an invalid header name or value', {
      cause,
    });
  }
}

/**
 * Third tier of the fallback (SPEC 6.4): the merge itself failed, which
 * only happens when `options.headers` changed or threw after construction,
 * so the response carries only the members the handler owns. The error id
 * header name was validated at construction, so `set()` cannot throw here.
 */
export function lastResortHeaders(
  base: HeadersInit | undefined,
  errorIdHeader: string | false,
  id: string,
): Headers {
  try {
    return mergeHeaders(
      base,
      new Headers({ 'Content-Type': 'application/json' }),
      errorIdHeader,
      id,
    );
  } catch {
    const headers = new Headers({
      'Content-Type': 'application/json',
      [CACHE_CONTROL]: DEFAULT_CACHE_CONTROL,
    });
    if (errorIdHeader !== false) {
      headers.set(errorIdHeader, id);
    }
    return headers;
  }
}
