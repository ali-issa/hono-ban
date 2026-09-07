import { REQUEST_ID_PATTERN } from '../internal/constants';

/**
 * Echoes a client request id only when it is safe to log and render
 * (SPEC 6.5). Never fabricates one: the error id is the correlation key.
 */
export function readRequestId(value: string | undefined): string | undefined {
  return value !== undefined && REQUEST_ID_PATTERN.test(value)
    ? value
    : undefined;
}
