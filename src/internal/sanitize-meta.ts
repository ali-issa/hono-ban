import { PROTO_KEYS } from './constants';

/**
 * Shallow copy of own enumerable string keys with prototype-pollution keys
 * removed (ADR 0007). Runs once per render, before any format sees `meta`.
 */
export function sanitizeMeta(
  meta: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(meta)) {
    if (!PROTO_KEYS.has(key)) {
      out[key] = meta[key];
    }
  }
  return out;
}
