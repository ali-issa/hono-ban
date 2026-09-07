import { EXTENSION_NAME_PATTERN } from '../internal/constants';
import { isPlainRecord } from '../internal/json';

/**
 * Spreads `meta` into RFC 9457 extension members (ADR 0008). Keys that do not
 * satisfy the naming recommendation in section 4 are kept under a single
 * `meta` member so nothing the caller provided is lost. The caller drops
 * reserved names afterwards, so standard and library members always win.
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-3.2
 * @ref https://www.rfc-editor.org/rfc/rfc9457#section-4
 */
export function flattenMeta(
  meta: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const members: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  let hasRest = false;
  for (const key of Object.keys(meta)) {
    if (EXTENSION_NAME_PATTERN.test(key)) {
      members[key] = meta[key];
    } else {
      rest[key] = meta[key];
      hasRest = true;
    }
  }
  if (hasRest) {
    const existing = members['meta'];
    members['meta'] = isPlainRecord(existing) ? { ...existing, ...rest } : rest;
  }
  return members;
}
