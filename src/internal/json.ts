/**
 * `JSON.stringify` that never fails on `bigint`. Cycles still throw; the
 * handler treats that as a handler failure (SPEC 6.4).
 */
export function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key: string, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
