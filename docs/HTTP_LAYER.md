# HTTP layer

`src/server/http/` holds the request handling shared by every API route (wired in `server.ts`):

| Piece | What it does |
|---|---|
| `requestContext()` | `X-Request-Id` on every response (a well-formed incoming id is kept, otherwise a UUID); `req.id` |
| `requestLogger()` | One JSON log line per `/api` request: method, path **without the query string**, status, duration, user and organization ids |
| `apiRateLimit()` | Per-IP ceiling for `/api` (`API_RATE_LIMIT_PER_MINUTE`, default 600). Webhooks, the health check and the public calendar API are exempt; routers keep their own stricter limits (lead capture, sign-in links, AI, payments) |
| `validateBody(zodSchema)` / `validate(schema, 'query')` | 400 `invalid_input` with the failing `field`, before the handler runs |
| `notFoundHandler()` | JSON 404 for unknown `/api` paths |
| `errorHandler()` | Last middleware: any thrown or forwarded error becomes `{ success: false, code, error, requestId }` |
| `installAsyncErrorForwarding()` | Express 4 doesn't catch rejected promises from async route handlers; this makes them reach `errorHandler` instead of hanging |
| `logger` (`logger.ts`) | Structured JSON logs (`LOG_LEVEL`, `LOG_FORMAT=pretty`); keys that look sensitive (password, token, secret, authorization, cookie, api key, email, phone…) are redacted |

## Errors (`errors.ts`)
Throw `HttpError` (or the helpers `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`,
`tooManyRequests(retryAfterSeconds)`, `serviceUnavailable`). `toErrorResponse()` maps everything in one place:

| Error | Response |
|---|---|
| `HttpError` 4xx, or deliberate 501/502/503/504 | its status, code and message (+ `Retry-After` for 429) |
| Malformed JSON / body too large / bad encoding | 400 `invalid_json` / 413 `payload_too_large` / 415 |
| `ZodError` | 400 `invalid_input` with `field` |
| `InvalidIdError` | 400 `invalid_id` |
| `TenancyError`, `MeetingError`, legacy `{ status: 4xx, code, message }` | that status/code/message |
| Anything else (incl. `HttpError` 500) | **500 `server_error` with a generic message**; the error and stack go only to the server log with the request id |

The existing `sendError(res, err, tag)` (used by most routers) now uses the same mapping, so old and new routes
answer the same way. Authentication (401) and permissions (403) stay in `guard()`, `requireTenant`,
`requirePermission` and `requireAccess`.

## Writing a route
```ts
router.post('/things', requireAccess('deals', 'create'), validateBody(ThingSchema), async (req, res) => {
  const thing = await repo.get(req.body.id);
  if (!thing) throw notFound('That thing doesn’t exist.');
  res.status(201).json({ success: true, thing });
});
```
Tests: `npm run test:http`.
