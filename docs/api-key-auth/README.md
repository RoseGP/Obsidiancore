# Master API key for the Firebase Functions and Cloudflare Workers APIs

One 256-bit key protects server-to-server APIs. It's sent as `x-api-key: <key>` or `Authorization: Bearer <key>`,
compared in constant time, and never logged. **Never put it in browser code or any `VITE_*` variable**:
anything shipped to a browser is public. For browser-facing features use per-user auth (the CRM's Firebase
sign-in) or scoped keys (the embeddable calendar's `pk_` keys).

## 1. Generate the key (writes it into `.env`)

```bash
npm run key:generate                     # creates/replaces MASTER_API_KEY in .env (mode 600, git-ignored)
npm run key:generate -- --local-secrets  # also functions/.secret.local and .dev.vars for the emulators
npm run key:generate -- --rotate         # new key; the old one is kept as MASTER_API_KEY_PREVIOUS
```
The script prints a fingerprint, not the key. One-off alternative: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## 2. Store the secret

Commands below read the key from `.env` without printing it.

**Firebase (Cloud Secret Manager):**
```bash
grep '^MASTER_API_KEY=' .env | cut -d= -f2- | tr -d '\n' | firebase functions:secrets:set MASTER_API_KEY --data-file=-
firebase deploy --only functions:api        # the function binds the secret: onRequest({ secrets: [MASTER_API_KEY] })
firebase functions:secrets:access MASTER_API_KEY | shasum -a 256 | cut -c1-12   # compare with the script's fingerprint
```
Local emulator: `functions/.secret.local` (written by `--local-secrets`), then `cd functions && npm run serve`.

**Cloudflare (Wrangler secrets):**
```bash
grep '^MASTER_API_KEY=' .env | cut -d= -f2- | tr -d '\n' | npx wrangler secret put MASTER_API_KEY -c wrangler.api.toml
npx wrangler deploy -c wrangler.api.toml
```
Local: `.dev.vars` (written by `--local-secrets`), then `npx wrangler dev -c wrangler.api.toml`.
For an existing Worker, wrap its handler: `export default { fetch: withApiKey(handler) }` (src/workers/authMiddleware.ts).

**Your own server** (calling these APIs): put the key in that server's secret store / environment, e.g. `MASTER_API_KEY`.

## 3. Call the protected endpoint

```js
// Server-side only (Node 18+, Workers, Next.js route handlers…)
const res = await fetch('https://<region>-<project>.cloudfunctions.net/api/api/v1/health', {
  // or 'https://obsidian-crm-api.<your-subdomain>.workers.dev/api/v1/health'
  headers: { 'x-api-key': process.env.MASTER_API_KEY },      // or: Authorization: `Bearer ${process.env.MASTER_API_KEY}`
});
if (res.status === 401) throw new Error((await res.json()).error.message);
console.log(await res.json()); // { status: 'ok', service: 'obsidian-crm-api', time: '…' }
```
```bash
curl -H "x-api-key: $MASTER_API_KEY" https://…/api/v1/health
```

Responses: `200` with the body above; `401 { "error": { "code": "missing_api_key" | "invalid_api_key", "message" } }`
plus `WWW-Authenticate: Bearer realm="api"`; `503 { "error": { "code": "server_misconfigured" } }` if the secret isn't set
(the API fails closed).

## 4. Rotation without downtime
1. `npm run key:generate -- --rotate` (new `MASTER_API_KEY`, old one as `MASTER_API_KEY_PREVIOUS`).
2. Set both secrets. Cloudflare: `wrangler secret put MASTER_API_KEY_PREVIOUS` (read automatically). Firebase: set
   `MASTER_API_KEY_PREVIOUS` and add it to `secrets` in functions/src/api.ts (it isn't bound by default because deploys
   fail when a bound secret doesn't exist).
3. Deploy, move every client to the new key, then delete the previous secret and deploy again.

## 5. Limits of a single master key
- Anyone holding it has full access, and you can't tell callers apart. If more than one system calls the API,
  give each its own key so one can be revoked alone.
- Add rate limiting in front: Cloudflare WAF rate-limiting rules for Workers; Firebase App Check doesn't apply to
  server-to-server calls, so use API Gateway / Cloud Armor or per-key limits in the app.
- If the key leaks: rotate immediately (step 4) and review logs.
