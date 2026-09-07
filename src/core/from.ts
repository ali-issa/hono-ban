import type { BanError } from './ban-error';
import type { BanCore } from './internal';

import { HTTPException } from 'hono/http-exception';

import {
  BODY_HEADERS,
  MALFORMED_JSON_MESSAGE,
  UNEXPECTED_DETAIL,
} from '../internal/constants';
import { isBanError } from './ban-error';

const BAD_REQUEST = 400;
const RANGE_NOT_SATISFIABLE = 416;
const CONTENT_RANGE = 'content-range';

/**
 * The exception's body is discarded, so the headers describing it go with it
 * (SPEC 5.5): kept, a `Content-Length` sized for the old body truncates the
 * rendered JSON and a `Content-Encoding` makes clients decompress plain text.
 * `Content-Range` is the one that changes meaning with the status: on a 416
 * it carries the selected representation's complete length (an asterisk, a
 * slash, and the length), not a description of the body, so it stays.
 * @ref https://www.rfc-editor.org/rfc/rfc9110#section-14.4
 * @ref https://www.rfc-editor.org/rfc/rfc9110#section-15.5.17
 */
function withoutBodyHeaders(
  source: Headers | undefined,
  status: number,
): Headers | undefined {
  if (source === undefined) {
    return undefined;
  }
  const headers = new Headers(source);
  const keepContentRange = status === RANGE_NOT_SATISFIABLE;
  for (const name of BODY_HEADERS) {
    if (!(keepContentRange && name === CONTENT_RANGE)) {
      headers.delete(name);
    }
  }
  return headers;
}

/**
 * Hono middleware writes `HTTPException.message` for clients, so it is kept as
 * `detail`; `res` headers (for example `WWW-Authenticate` from
 * `hono/bearer-auth`) are preserved, except those describing the discarded
 * body (SPEC 5.5).
 * @ref https://hono.dev/docs/api/exception
 */
function fromHttpException(core: BanCore, error: HTTPException): BanError {
  const status = error.status;
  const definition =
    status === BAD_REQUEST && error.message === MALFORMED_JSON_MESSAGE
      ? core.definition('MALFORMED_JSON')
      : core.byStatus.get(status);
  const detail = error.message === '' ? undefined : error.message;
  const headers = withoutBodyHeaders(error.res?.headers, status);
  if (definition === undefined) {
    return core.custom({
      status,
      title: 'Error',
      detail,
      headers,
      cause: error,
    });
  }
  return core.build(definition, { detail, headers, cause: error });
}

export function createFrom(core: BanCore): (value: unknown) => BanError {
  return (value: unknown): BanError => {
    if (isBanError(value)) {
      return value;
    }
    if (value instanceof HTTPException) {
      return fromHttpException(core, value);
    }
    return core.build(core.definition('INTERNAL_SERVER_ERROR'), {
      detail: UNEXPECTED_DETAIL,
      cause: value,
    });
  };
}
