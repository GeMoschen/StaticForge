import { HttpErrorResponse } from '@angular/common/http';

/** The parts of an RFC 9457 problem the forms show (spec §20.1). */
export interface ProblemInfo {
  status: number;
  code?: string;
  detail: string;
  /** The request member the problem is about (`400`/`409` on one field). */
  field?: string;
  /** One message per broken rule (e.g. the password policy). */
  errors: string[];
}

/** Reads a failed request's problem document; a network or unknown error gets a generic message. */
export function problemOf(err: unknown, fallback = 'Something went wrong.'): ProblemInfo {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as
      | { detail?: string; title?: string; code?: string; field?: string; errors?: unknown }
      | null
      | undefined;
    if (body && typeof body === 'object') {
      return {
        status: err.status,
        code: body.code,
        detail: body.detail ?? body.title ?? fallback,
        field: body.field,
        errors: Array.isArray(body.errors) ? body.errors.filter((e): e is string => typeof e === 'string') : [],
      };
    }
    return { status: err.status, detail: fallback, errors: [] };
  }
  return { status: 0, detail: fallback, errors: [] };
}
