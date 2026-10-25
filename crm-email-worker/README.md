# CRM Email Worker (Cloudflare Email Routing + PostalMime)

A high-performance Cloudflare Worker for parsing and ingesting inbound RFC822/MIME emails into your CRM system via **Cloudflare Email Routing** and **PostalMime**.

---

## 🚀 Features

- **Automated Inbound Ingestion**: Listens to Cloudflare Email Routing events (`email(message, env, ctx)`).
- **MIME Parsing**: Uses `postal-mime` to extract text body, HTML body, sender headers (`From`, `To`, `CC`, `BCC`, `Reply-To`, `References`, `In-Reply-To`), and attachments.
- **R2 Storage Integration**: Optional automatic archiving of raw `.eml` files and attachment binaries to Cloudflare R2 storage buckets.
- **D1 SQLite Database**: Indexes email records into Cloudflare D1 for quick search, threading, and retrieval.
- **Webhook Dispatch**: Streams structured JSON payloads to your CRM webhook endpoint (`/api/inbound-email`) with HMAC/Secret verification.
- **Diagnostic HTTP Endpoints**: Provides `/health` check and `/api/parse-eml` test endpoint for manual verification.

---

## 🛠️ Quick Start & Setup

### 1. Install Dependencies
```bash
cd crm-email-worker
npm install
```

### 2. Configure `wrangler.toml`
Edit `wrangler.toml` with your target CRM Webhook URL and optional Cloudflare bindings:

```toml
name = "crm-email-worker"
main = "src/index.js"
compatibility_date = "2026-08-15"

[vars]
CRM_WEBHOOK_URL = "https://your-crm-domain.com/api/inbound-email"
CRM_WEBHOOK_SECRET = "your_secure_webhook_secret_key"
```

### 3. Test Locally
Run the unit test to verify MIME parsing:
```bash
npm test
```

### 4. Deploy to Cloudflare Workers
```bash
npx wrangler deploy
```

### 5. Link in Cloudflare Dashboard
1. Go to your **Cloudflare Dashboard** -> **Email Routing** -> **Routing Rules**.
2. Create a custom address (e.g. `support@yourdomain.com`, `inbox@yourdomain.com`, or catch-all `*@yourdomain.com`).
3. Set the **Action** to **Send to a Worker** and select `crm-email-worker`.
