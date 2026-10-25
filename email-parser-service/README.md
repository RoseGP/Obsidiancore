# Email Parser Service (Cloudflare Workers)

A production-ready Cloudflare Workers microservice written in TypeScript for RFC 822 / MIME email parsing using **`postal-mime`** with **`nodejs_compat`** flags enabled.

---

## Features

- **High-Performance Parsing**: Decodes multipart MIME emails (plain text, HTML, CC/BCC, custom headers, attachments, nested parts) via `postal-mime`.
- **Node.js Standard Library Compatibility**: Configured with `"compatibility_flags": ["nodejs_compat"]` to support buffer, stream, and crypto standards within Cloudflare Workers V8 isolates.
- **Dual Interface**:
  - **HTTP REST API**: `POST /parse` for parsing raw `.eml` uploads, binary streams, or JSON bodies.
  - **Email Routing Inbound Handler**: `email(message, env, ctx)` handler for direct Cloudflare Email Routing bindings.
- **CORS Support**: Ready for frontend invocations across environments.

---

## Configuration (`wrangler.jsonc` / `wrangler.toml`)

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "email-parser-service",
  "main": "src/index.ts",
  "compatibility_date": "2024-09-23",
  "compatibility_flags": [
    "nodejs_compat"
  ],
  "observability": {
    "enabled": true
  }
}
```

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Local Development
```bash
npm run dev
```

### 3. Run Tests
```bash
npm test
```

### 4. Deploy to Cloudflare Edge
```bash
npm run deploy
```

---

## API Usage

### Parse Raw Email via HTTP POST
```bash
curl -X POST http://localhost:8787/parse \
  -H "Content-Type: message/rfc822" \
  --data-binary @sample-email.eml
```

Or with JSON:
```bash
curl -X POST http://localhost:8787/parse \
  -H "Content-Type: application/json" \
  -d '{"raw": "From: sender@example.com\r\nTo: user@example.com\r\nSubject: Test\r\n\r\nHello World"}'
```
