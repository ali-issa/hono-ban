/**
 * Shared constants. Every value here is named in `docs/SPEC.md` section 13.
 * @packageDocumentation
 */

export const UNEXPECTED_DETAIL = 'An unexpected error occurred';
export const VALIDATION_DETAIL = 'Request validation failed';
/**
 * The exact message Hono's built-in validator uses when JSON parsing fails.
 * @ref https://github.com/honojs/hono/blob/main/src/validator/validator.ts
 */
export const MALFORMED_JSON_MESSAGE = 'Malformed JSON in request body';
export const DEFAULT_REQUEST_ID_HEADER = 'X-Request-Id';
export const DEFAULT_ERROR_ID_HEADER = 'X-Error-Id';
/**
 * `Cache-Control` the handler adds when neither the options nor the error
 * supply one (SPEC 6.9, ADR 0012). 404, 405, 410, 414, and 501 are
 * heuristically cacheable, and every body carries an occurrence id, so a
 * shared cache could replay one client's error to another; a 429 MUST NOT be
 * stored at all.
 * @ref https://www.rfc-editor.org/rfc/rfc9110#section-15.1
 * @ref https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.5
 * @ref https://www.rfc-editor.org/rfc/rfc6585#section-4
 */
export const DEFAULT_CACHE_CONTROL = 'no-store';
export const DEFAULT_MAX_BODY_BYTES = 65_536;
export const TRUNCATED_DETAIL_LENGTH = 1024;
export const REQUEST_ID_PATTERN: RegExp = /^[A-Za-z0-9._-]{1,128}$/u;
/**
 * `version "-" trace-id "-" parent-id "-" trace-flags`, lowercase hex only.
 * @ref https://www.w3.org/TR/trace-context/#traceparent-header-field-values
 */
export const TRACEPARENT_PATTERN: RegExp =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})/u;
export const TRACEPARENT_LENGTH = 55;
/**
 * RFC 9457 section 4 (the paragraph after the definition requirements):
 * extension member names SHOULD start with a letter, use only
 * ALPHA / DIGIT / "_", and be at least three characters long.
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-4
 */
export const EXTENSION_NAME_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9_]{2,}$/u;
/**
 * Headers that describe a response body. `ban.from()` drops them when it
 * adopts the headers of an `HTTPException` response whose body it discards:
 * a stale `Content-Length` truncates the rendered JSON on the wire and a stale
 * `Content-Encoding` makes clients decompress plain text.
 * @ref https://www.rfc-editor.org/rfc/rfc9110#section-8.3 (Content-Type, then 8.4, 8.6, 8.7)
 * @ref https://www.rfc-editor.org/rfc/rfc9110#section-14.4 (Content-Range)
 * @ref https://www.rfc-editor.org/rfc/rfc9112#section-6.1 (Transfer-Encoding)
 */
export const BODY_HEADERS: ReadonlySet<string> = new Set([
  'content-type',
  'content-length',
  'content-encoding',
  'content-location',
  'content-range',
  'transfer-encoding',
]);
export const PROTO_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);
