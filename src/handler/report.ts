import type { BanError } from '../core/ban-error';
import type { ErrorReport } from '../core/types';

export interface ReportInput {
  readonly error: BanError;
  readonly thrown: unknown;
  readonly handled: boolean;
  readonly handlerFailure: unknown;
  readonly requestId: string | undefined;
  readonly traceId: string | undefined;
  readonly spanId: string | undefined;
  readonly method: string;
  readonly path: string;
}

export function buildReport(input: ReportInput): ErrorReport {
  const { error } = input;
  return {
    id: error.id,
    status: error.status,
    code: error.code,
    error,
    cause: input.thrown === error ? error.cause : input.thrown,
    handled: input.handled,
    handlerFailure: input.handlerFailure,
    context: {
      requestId: input.requestId,
      traceId: input.traceId,
      spanId: input.spanId,
      method: input.method,
      path: input.path,
    },
  };
}
