/**
 * One mapping from any thrown value to a safe HTTP error response: { success: false, code, error, … }.
 *
 * - Expected failures carry their status and a message written for the user (HttpError, the domain errors
 *   that already exist in this codebase: TenancyError, MeetingError, InvalidIdError, ZodError, and any error
 *   object with a numeric 4xx `status`).
 * - Body-parser failures (malformed JSON, body too large, unsupported charset) become 400 / 413 / 415.
 * - Everything else is a 500 with a generic message. Stack traces, error messages and causes of 5xx
 *   errors never reach the client; they are logged on the server with the request id.
 */

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>, public headers?: Record<string, string>) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message = 'Invalid request.', code = 'invalid_input', details?: Record<string, unknown>) => new HttpError(400, code, message, details);
export const unauthorized = (message = 'Sign in to continue.', code = 'unauthorized') => new HttpError(401, code, message);
export const forbidden = (message = 'You don\'t have permission to do this.', code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (message = 'Not found.', code = 'not_found') => new HttpError(404, code, message);
export const conflict = (message = 'This conflicts with the current state.', code = 'conflict') => new HttpError(409, code, message);
export const tooManyRequests = (retryAfterSeconds: number, message = 'Too many requests. Please wait a moment and try again.', code = 'rate_limited') =>
  new HttpError(429, code, message, { retryAfter: retryAfterSeconds }, { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) });
export const serviceUnavailable = (message = 'This service isn\'t available right now.', code = 'service_unavailable') => new HttpError(503, code, message);

export interface ErrorResponse {
  status: number;
  body: { success: false; code: string; error: string; [k: string]: unknown };
  headers?: Record<string, string>;
  /** Unexpected (5xx): log the full error server-side. */
  unexpected: boolean;
}

const GENERIC_500 = 'Something went wrong on our side. Please try again.';
/** 5xx statuses an error may choose deliberately (with a safe message), e.g. 501/502/503/504. */
const DELIBERATE_5XX = new Set([501, 502, 503, 504]);

export function toErrorResponse(err: unknown): ErrorResponse {
  const e = err as any;

  if (e instanceof HttpError) {
    const safe = e.status < 500 || DELIBERATE_5XX.has(e.status);
    return {
      status: e.status,
      body: { success: false, code: safe ? e.code : 'server_error', error: safe ? e.message : GENERIC_500, ...(safe && e.details ? e.details : {}) },
      headers: e.headers,
      unexpected: !safe,
    };
  }

  // body-parser (express.json / urlencoded)
  if (e && typeof e.type === 'string') {
    if (e.type === 'entity.parse.failed') return { status: 400, body: { success: false, code: 'invalid_json', error: 'The request body isn\'t valid JSON.' }, unexpected: false };
    if (e.type === 'entity.too.large') return { status: 413, body: { success: false, code: 'payload_too_large', error: 'The request is too large.' }, unexpected: false };
    if (e.type === 'charset.unsupported' || e.type === 'encoding.unsupported') return { status: 415, body: { success: false, code: 'unsupported_media_type', error: 'Unsupported request encoding.' }, unexpected: false };
    if (e.type === 'request.aborted') return { status: 400, body: { success: false, code: 'request_aborted', error: 'The request was interrupted.' }, unexpected: false };
  }

  if (e?.name === 'ZodError' && Array.isArray(e.issues)) {
    const i = e.issues[0];
    return { status: 400, body: { success: false, code: 'invalid_input', field: i?.path?.join('.') || undefined, error: i?.message || 'Invalid input.' }, unexpected: false };
  }

  if (e?.name === 'InvalidIdError' || (e?.constructor?.name === 'InvalidIdError')) {
    return { status: 400, body: { success: false, code: 'invalid_id', error: 'Invalid id.' }, unexpected: false };
  }

  // Domain errors (TenancyError, MeetingError, …) and older code that throws { status, code, message }.
  const status = typeof e?.status === 'number' ? e.status : typeof e?.statusCode === 'number' ? e.statusCode : undefined;
  if (status && status >= 400 && status < 500) {
    const extra = e?.details && typeof e.details === 'object' ? e.details : {};
    return { status, body: { success: false, code: typeof e.code === 'string' ? e.code : 'bad_request', error: typeof e.message === 'string' && e.message ? e.message : 'Bad request.', ...extra }, unexpected: false };
  }

  return { status: 500, body: { success: false, code: 'server_error', error: GENERIC_500 }, unexpected: true };
}
