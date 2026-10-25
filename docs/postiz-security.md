# Postiz Integration Security Architecture

## 1. Overview
This document outlines the multi-user security architecture, cryptographic protections, OAuth 2.0 implementation, and credential management for the **Postiz Public API v1** integration within the Omnichannel CRM.

Official Documentation Reference:
- Postiz Public API v1: [https://docs.postiz.com/public-api](https://docs.postiz.com/public-api)
- Base API Endpoint: `https://api.postiz.com/public/v1`

---

## 2. Cryptographic Storage & Key Derivation (AES-256-GCM)

All Postiz OAuth access tokens, refresh tokens, and direct API keys are encrypted at rest using **AES-256-GCM** (Galois/Counter Mode), providing both confidentiality and cryptographic authenticity verification.

### Encryption Specifications:
- **Algorithm**: `aes-256-gcm`
- **Key Derivation**: 256-bit derived key sourced from sovereign `ENCRYPTION_KEY` environment variable.
- **Initialization Vector (IV)**: 128-bit (16-byte) cryptographically secure pseudorandom bytes generated per encryption operation (`crypto.randomBytes(16)`).
- **Authentication Tag**: 128-bit (16-byte) GCM authentication tag generated during ciphertext finalization (`cipher.getAuthTag()`).
- **Tamper Detection**: Any modification of the ciphertext, IV, or authentication tag causes GCM decryption to fail immediately, preventing replay attacks or bit-flipping attacks.

```typescript
// Token Vault Record Schema
interface PostizCredentialRecord {
  userId: string;
  encryptedAccessToken: string;
  iv: string;
  authTag: string;
  encryptedRefreshToken?: string;
  refreshIv?: string;
  refreshAuthTag?: string;
  status: 'active' | 'revoked' | 'expired' | 'disconnected';
  expiresAt?: number;
  authType: 'oauth' | 'api_key';
}
```

---

## 3. OAuth 2.0 Authorization Flow & State Security

The integration utilizes standard **OAuth 2.0 Authorization Code Grant**:
1. **Authorization URL**:
   `https://platform.postiz.com/oauth/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri={REDIRECT_URI}&state={STATE}`
2. **Cryptographic State Parameter**:
   - 24-byte random hex string generated on each initiation.
   - Bound to the requesting `userId` and `redirectUri` with a 10-minute expiration window.
   - Single-use consumption prevents Cross-Site Request Forgery (CSRF) and OAuth code replay attacks.
3. **Token Exchange**:
   - `POST https://api.postiz.com/oauth/token`
   - Payload: `grant_type: 'authorization_code'`, `code`, `client_id`, `client_secret`, `redirect_uri`.
   - The received `access_token` and `refresh_token` are encrypted before persistence in Firestore or the secure vault. Plaintext tokens are never written to disk or logs.

---

## 4. Token Revocation & Graceful Reconnection

When Postiz responds with HTTP `401 Unauthorized` or `403 Forbidden` (indicating the user has revoked access or the token has expired):
1. The backend automatically marks the user's stored credential as `status: 'revoked'`.
2. The user interface displays a prominent warning banner with the revocation reason.
3. The UI provides a 1-click **"Reconnect to Postiz"** button to restart authorization without disrupting existing draft posts.
4. If a Postiz webhook sends `integration.revoked` or `channel.disconnected`, the affected channel is flagged and disabled in the UI.

---

## 5. Webhook Security

Postiz webhooks received at `/api/postiz/webhook` are verified using HMAC-SHA256:
- The raw request body buffer is compared against the `x-postiz-signature` header using `crypto.timingSafeEqual` to avoid timing side-channel attacks.
- Invalid signatures are rejected with HTTP 401 in production environments.

---

## 6. Multi-Tenant User Isolation

- Every API endpoint strictly resolves and enforces the current session's `userId` via authenticated headers (`x-user-id`) or session tokens.
- Cross-tenant access to credentials, channels, or scheduled posts is prohibited.
- Media uploads are proxied through backend endpoints, preventing direct leakage of user tokens to client browsers.
