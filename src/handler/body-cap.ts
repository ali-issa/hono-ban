import type { Renderer } from '../core/ban-error';
import type { RenderOptions } from '../formats/context';

import { BanError } from '../core/ban-error';
import { TRUNCATED_DETAIL_LENGTH } from '../internal/constants';
import { safeStringify } from '../internal/json';

const MAX_UTF8_BYTES_PER_CHAR = 3;
const encoder = new TextEncoder();

/**
 * Serializes the body, or re-renders a minimal variant of the same error when
 * the serialized body exceeds `max` bytes (SPEC 6.8). `transform` is the
 * handler's `transform` option bound to the error and context; it runs on the
 * minimal body too, so a redaction applied to the first body is not undone.
 */
export function capBody(
  body: unknown,
  error: BanError,
  options: RenderOptions,
  render: Renderer,
  max: number,
  transform: (body: unknown) => unknown,
): string {
  const text = safeStringify(body);
  // A UTF-16 unit never encodes to more than 3 bytes, so short strings skip encoding.
  if (
    text.length * MAX_UTF8_BYTES_PER_CHAR <= max ||
    encoder.encode(text).byteLength <= max
  ) {
    return text;
  }
  const init = error.toInit();
  const minimal = new BanError({
    ...init,
    meta: {},
    issues: undefined,
    detail: init.detail?.slice(0, TRUNCATED_DETAIL_LENGTH),
  });
  // The stack is the one remaining member a request can inflate (deep
  // recursion), so the minimal render never carries it.
  const rendered = render(minimal, {
    ...options,
    includeStack: false,
    truncated: true,
  });
  return safeStringify(transform(rendered.body));
}
